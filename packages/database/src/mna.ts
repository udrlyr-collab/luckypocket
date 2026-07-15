import type { Pool, PoolClient } from "pg";

type Campaign = {
  id: string; company_id: string; stock_id: string; attacker_user_id: string; defender_user_id: string | null;
  status: "tendering" | "proxy_vote" | "resolved" | "failed" | "cancelled"; offer_price: string; committed_cash: string;
  attacker_score: string; defender_score: string; tender_ends_at: Date; proxy_ends_at: Date;
};

export async function advanceDueMnaCampaigns(pool: Pool, now = new Date()): Promise<{ advanced: number; resolved: number }> {
  const tenderDue = await pool.query<{ id: string }>("SELECT id FROM mna_campaigns WHERE status = 'tendering' AND tender_ends_at <= $1 ORDER BY tender_ends_at LIMIT 100", [now]);
  let advanced = 0;
  for (const campaign of tenderDue.rows) {
    const changed = await pool.query("UPDATE mna_campaigns SET status = 'proxy_vote', updated_at = now() WHERE id = $1 AND status = 'tendering'", [campaign.id]);
    if (changed.rowCount === 1) {
      await pool.query("INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('mna_campaign', $1, 'mna.proxy_vote_started', jsonb_build_object('campaignId', $1::text))", [campaign.id]);
      advanced += 1;
    }
  }
  const proxyDue = await pool.query<{ id: string }>("SELECT id FROM mna_campaigns WHERE status = 'proxy_vote' AND proxy_ends_at <= $1 ORDER BY proxy_ends_at LIMIT 100", [now]);
  let resolved = 0;
  for (const campaign of proxyDue.rows) {
    await resolveMnaCampaign(pool, campaign.id);
    resolved += 1;
  }
  return { advanced, resolved };
}

export async function resolveMnaCampaign(pool: Pool, campaignId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<Campaign>(
      "SELECT * FROM mna_campaigns WHERE id = $1 AND status IN ('tendering','proxy_vote') FOR UPDATE",
      [campaignId],
    );
    const campaign = required(result.rows[0], "MNA_CAMPAIGN_NOT_ACTIVE");
    const stock = required((await client.query<{ total_shares: string }>("SELECT total_shares FROM stocks WHERE id = $1 FOR UPDATE", [campaign.stock_id])).rows[0], "MNA_STOCK_MISSING");
    const totalShares = BigInt(stock.total_shares);
    const attackerHolding = await holdingQuantity(client, campaign.attacker_user_id, campaign.stock_id);
    const defenderHolding = campaign.defender_user_id ? await holdingQuantity(client, campaign.defender_user_id, campaign.stock_id) : 0n;
    const tenders = await client.query<{ id: string; shareholder_user_id: string; quantity: string }>(
      "SELECT id, shareholder_user_id, quantity FROM mna_tender_offers WHERE campaign_id = $1 AND status = 'reserved' ORDER BY created_at FOR UPDATE",
      [campaign.id],
    );
    const tenderQuantity = tenders.rows.reduce((sum, row) => sum + BigInt(row.quantity), 0n);
    const tenderCost = tenderQuantity * BigInt(campaign.offer_price);
    const supports = await client.query<{ side: "attacker" | "defender"; votes: string }>(
      "SELECT side, sum(voting_rights_snapshot)::bigint AS votes FROM mna_supports WHERE campaign_id = $1 GROUP BY side",
      [campaign.id],
    );
    const attackerSupport = BigInt(supports.rows.find((row) => row.side === "attacker")?.votes ?? "0");
    const defenderSupport = BigInt(supports.rows.find((row) => row.side === "defender")?.votes ?? "0");
    const prospectiveShares = attackerHolding + tenderQuantity;
    const attackerPower = prospectiveShares + attackerSupport + BigInt(campaign.attacker_score);
    const defenderPower = defenderHolding + defenderSupport + BigInt(campaign.defender_score);
    const funded = tenderCost <= BigInt(campaign.committed_cash);
    const success = funded && prospectiveShares * 2n > totalShares && attackerPower > defenderPower;

    if (success) {
      for (const tender of tenders.rows) await settleTender(client, campaign, tender);
      await client.query(
        "UPDATE users SET cash = cash - $2, reserved_cash = reserved_cash - $3, updated_at = now() WHERE id = $1 AND cash >= $2 AND reserved_cash >= $3",
        [campaign.attacker_user_id, tenderCost.toString(), campaign.committed_cash],
      );
      await client.query("UPDATE companies SET controlled_by_user_id = $2, controlled_at = now(), updated_at = now() WHERE id = $1", [campaign.company_id, campaign.attacker_user_id]);
    } else {
      await releaseReservations(client, campaign, tenders.rows);
    }
    const resultJson = {
      success, funded, tenderQuantity: tenderQuantity.toString(), tenderCost: tenderCost.toString(),
      prospectiveShares: prospectiveShares.toString(), totalShares: totalShares.toString(),
      attackerPower: attackerPower.toString(), defenderPower: defenderPower.toString(),
    };
    await client.query(
      `UPDATE mna_campaigns SET status = $2::mna_campaign_status, spent_cash = $3, resolved_at = now(),
         winner_user_id = $4, result = $5::jsonb, updated_at = now() WHERE id = $1`,
      [campaign.id, success ? "resolved" : "failed", success ? tenderCost.toString() : "0", success ? campaign.attacker_user_id : campaign.defender_user_id, JSON.stringify(resultJson)],
    );
    await client.query(
      `INSERT INTO corporate_events (company_id, event_type, title, description, created_by_user_id, metadata)
       VALUES ($1, 'mna_result', $2, $3, $4, $5::jsonb)`,
      [campaign.company_id, success ? "적대적 M&A 성공" : "적대적 M&A 방어", success ? "경영권이 이전되었습니다." : "기존 경영권이 방어되었습니다.", campaign.attacker_user_id, JSON.stringify(resultJson)],
    );
    await client.query(
      "INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('mna_campaign', $1, $2, $3::jsonb)",
      [campaign.id, success ? "mna.resolved" : "mna.failed", JSON.stringify({ campaignId: campaign.id, ...resultJson })],
    );
    await client.query("COMMIT");
    return resultJson;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function settleTender(client: PoolClient, campaign: Campaign, tender: { id: string; shareholder_user_id: string; quantity: string }) {
  const quantity = BigInt(tender.quantity);
  const sellerHolding = required((await client.query<{ quantity: string; cost_basis: string }>("SELECT quantity, cost_basis FROM holdings WHERE user_id = $1 AND stock_id = $2 FOR UPDATE", [tender.shareholder_user_id, campaign.stock_id])).rows[0], "MNA_TENDER_HOLDING_MISSING");
  const before = BigInt(sellerHolding.quantity);
  if (before < quantity) throw new Error("MNA_TENDER_HOLDING_INVARIANT");
  const costRemoval = BigInt(sellerHolding.cost_basis) * quantity / before;
  const payment = BigInt(campaign.offer_price) * quantity;
  await client.query("UPDATE holdings SET quantity = quantity - $3, reserved_quantity = reserved_quantity - $3, cost_basis = cost_basis - $4, realized_pnl = realized_pnl + $5, updated_at = now() WHERE user_id = $1 AND stock_id = $2", [tender.shareholder_user_id, campaign.stock_id, quantity.toString(), costRemoval.toString(), (payment - costRemoval).toString()]);
  await client.query("UPDATE users SET cash = cash + $2, updated_at = now() WHERE id = $1", [tender.shareholder_user_id, payment.toString()]);
  await client.query(
    `INSERT INTO holdings (user_id, stock_id, quantity, cost_basis) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, stock_id) DO UPDATE SET quantity = holdings.quantity + EXCLUDED.quantity,
       cost_basis = holdings.cost_basis + EXCLUDED.cost_basis, updated_at = now()`,
    [campaign.attacker_user_id, campaign.stock_id, quantity.toString(), payment.toString()],
  );
  await client.query("UPDATE mna_tender_offers SET status = 'settled', settled_amount = $2, updated_at = now() WHERE id = $1", [tender.id, payment.toString()]);
}

async function releaseReservations(client: PoolClient, campaign: Campaign, tenders: Array<{ id: string; shareholder_user_id: string; quantity: string }>) {
  await client.query("UPDATE users SET reserved_cash = reserved_cash - $2, updated_at = now() WHERE id = $1", [campaign.attacker_user_id, campaign.committed_cash]);
  for (const tender of tenders) {
    await client.query("UPDATE holdings SET reserved_quantity = reserved_quantity - $3, updated_at = now() WHERE user_id = $1 AND stock_id = $2", [tender.shareholder_user_id, campaign.stock_id, tender.quantity]);
    await client.query("UPDATE mna_tender_offers SET status = 'released', updated_at = now() WHERE id = $1", [tender.id]);
  }
}

async function holdingQuantity(client: PoolClient, userId: string, stockId: string): Promise<bigint> {
  const row = await client.query<{ quantity: string }>("SELECT quantity FROM holdings WHERE user_id = $1 AND stock_id = $2", [userId, stockId]);
  return BigInt(row.rows[0]?.quantity ?? "0");
}
function required<T>(value: T | undefined, message: string): T { if (value === undefined) throw new Error(message); return value; }

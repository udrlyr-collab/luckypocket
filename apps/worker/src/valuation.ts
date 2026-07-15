import { calculateTrackedEtfPrice } from "@market-dominion/domain";
import type { Pool } from "pg";

export async function runValuationCycle(pool: Pool): Promise<{ cycleId: string; sourceCycleId: string | null; users: number; etfs: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('valuation-cycle'))");
    const prior = await client.query<{ id: string }>("SELECT id FROM valuation_cycles WHERE status='completed' ORDER BY completed_at DESC LIMIT 1");
    const sourceCycleId = prior.rows[0]?.id ?? null;
    const cycle = await client.query<{ id: string }>("INSERT INTO valuation_cycles (source_cycle_id) VALUES ($1) RETURNING id", [sourceCycleId]);
    const cycleId = cycle.rows[0]!.id;
    const snapshots = await client.query(
      `INSERT INTO user_valuation_snapshots (cycle_id,user_id,cash,eligible_asset_value,total_asset_value)
       SELECT $1,u.id,u.cash,
              u.cash
              + COALESCE((SELECT sum(h.quantity*s.current_price) FROM holdings h JOIN stocks s ON s.id=h.stock_id WHERE h.user_id=u.id AND s.asset_type='common'),0)
              + COALESCE((SELECT sum(GREATEST(0, p.margin + CASE WHEN p.side='long' THEN (s.current_price-p.entry_price)*p.quantity ELSE (p.entry_price-s.current_price)*p.quantity END - p.accrued_borrow_fee)) FROM leverage_positions p JOIN stocks s ON s.id=p.stock_id WHERE p.user_id=u.id AND p.status IN ('open','closing') AND s.asset_type='common'),0),
              u.cash
              + COALESCE((SELECT sum(h.quantity*s.current_price) FROM holdings h JOIN stocks s ON s.id=h.stock_id WHERE h.user_id=u.id),0)
              + COALESCE((SELECT sum(GREATEST(0, p.margin + CASE WHEN p.side='long' THEN (s.current_price-p.entry_price)*p.quantity ELSE (p.entry_price-s.current_price)*p.quantity END - p.accrued_borrow_fee)) FROM leverage_positions p JOIN stocks s ON s.id=p.stock_id WHERE p.user_id=u.id AND p.status IN ('open','closing')),0)
       FROM users u WHERE u.is_active=true AND u.is_system=false RETURNING id`, [cycleId],
    );
    let etfCount = 0;
    if (sourceCycleId) {
      const products = await client.query<{ stock_id: string; tracked_user_id: string; base_eligible_asset_value: string; base_price: string; source_value: string }>(
        `SELECT ep.stock_id,ep.tracked_user_id,ep.base_eligible_asset_value,ep.base_price,uv.eligible_asset_value AS source_value
         FROM etf_products ep JOIN stocks s ON s.id=ep.stock_id
         JOIN user_valuation_snapshots uv ON uv.user_id=ep.tracked_user_id AND uv.cycle_id=$1
         WHERE ep.is_active=true AND s.asset_type='user_etf'`, [sourceCycleId],
      );
      for (const product of products.rows) {
        const price = calculateTrackedEtfPrice({ currentCycleId: cycleId, sourceCycleId, sourceEligibleAssetValue: BigInt(product.source_value), baseEligibleAssetValue: BigInt(product.base_eligible_asset_value), basePrice: BigInt(product.base_price) });
        await client.query(
          `INSERT INTO etf_valuations (cycle_id,source_cycle_id,stock_id,tracked_user_id,source_eligible_asset_value,calculated_price)
           VALUES ($1,$2,$3,$4,$5,$6)`, [cycleId, sourceCycleId, product.stock_id, product.tracked_user_id, product.source_value, price.toString()],
        );
        await client.query("UPDATE stocks SET reference_price=$2,updated_at=now() WHERE id=$1", [product.stock_id, price.toString()]);
        await client.query("INSERT INTO outbox_events (aggregate_type,aggregate_id,event_type,payload) VALUES ('stock',$1,'etf.valued',jsonb_build_object('stockId',$1::text,'cycleId',$2::text,'sourceCycleId',$3::text,'price',$4::text))", [product.stock_id, cycleId, sourceCycleId, price.toString()]);
        etfCount += 1;
      }
    }
    await client.query("UPDATE valuation_cycles SET status='completed',completed_at=now() WHERE id=$1", [cycleId]);
    await client.query("COMMIT");
    return { cycleId, sourceCycleId, users: snapshots.rowCount ?? 0, etfs: etfCount };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AccessTokenGuard, CurrentUser, type AccessPrincipal } from "./auth.guard.js";
import { DatabaseService } from "./database.service.js";
import { PortfolioService } from "./portfolio.js";

const createSchema = z.object({
  companyId: z.uuid(), idempotencyKey: z.uuid(), offerPrice: z.coerce.bigint().positive(), committedCash: z.coerce.bigint().positive(),
  tenderDurationMinutes: z.number().int().min(10).max(10_080).default(1_440),
  proxyDurationMinutes: z.number().int().min(10).max(10_080).default(1_440),
});
const tenderSchema = z.object({ quantity: z.coerce.bigint().positive() });
const supportSchema = z.object({ side: z.enum(["attacker", "defender"]) });
const actionSchema = z.object({
  idempotencyKey: z.uuid(),
  side: z.enum(["attacker", "defender"]),
  actionType: z.enum(["add_cash", "friendly_shareholder", "proxy_solicitation", "competing_tender", "buyback", "white_knight", "friendly_stake", "dividend_increase", "rights_issue", "poison_pill", "asset_sale"]),
  cashAmount: z.coerce.bigint().nonnegative().default(0n),
  offerPrice: z.coerce.bigint().positive().optional(),
});

@Injectable()
export class MnaService {
  constructor(private readonly database: DatabaseService, private readonly portfolio: PortfolioService) {}

  async list() {
    const result = await this.database.pool.query(
      `SELECT mc.*, c.name AS company_name, s.symbol, au.nickname AS attacker_nickname, du.nickname AS defender_nickname
       FROM mna_campaigns mc JOIN companies c ON c.id = mc.company_id JOIN stocks s ON s.id = mc.stock_id
       JOIN users au ON au.id = mc.attacker_user_id LEFT JOIN users du ON du.id = mc.defender_user_id
       ORDER BY mc.created_at DESC LIMIT 500`,
    );
    return result.rows;
  }

  async detail(campaignId: string) {
    const campaign = await this.database.pool.query("SELECT * FROM mna_campaigns WHERE id = $1", [campaignId]);
    if (!campaign.rows[0]) throw new NotFoundException("M&A 캠페인을 찾을 수 없습니다.");
    const [tenders, supports, actions] = await Promise.all([
      this.database.pool.query("SELECT * FROM mna_tender_offers WHERE campaign_id = $1 ORDER BY created_at", [campaignId]),
      this.database.pool.query("SELECT * FROM mna_supports WHERE campaign_id = $1 ORDER BY created_at", [campaignId]),
      this.database.pool.query("SELECT * FROM mna_actions WHERE campaign_id = $1 ORDER BY created_at", [campaignId]),
    ]);
    return { ...campaign.rows[0], tenders: tenders.rows, supports: supports.rows, actions: actions.rows };
  }

  async create(userId: string, input: unknown) {
    const value = parse(createSchema, input);
    const existing = await this.database.pool.query("SELECT * FROM mna_campaigns WHERE attacker_user_id = $1 AND idempotency_key = $2", [userId, value.idempotencyKey]);
    if (existing.rows[0]) return existing.rows[0];
    const portfolio = await this.portfolio.get(userId);
    const assetSnapshot = BigInt(portfolio.totalEvaluatedAsset);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const companyResult = await client.query<{
        id: string; controlled_by_user_id: string | null; stock_id: string; total_shares: string; current_price: string;
      }>("SELECT c.id, c.controlled_by_user_id, s.id AS stock_id, s.total_shares, s.current_price FROM companies c JOIN stocks s ON s.company_id = c.id WHERE c.id = $1 FOR UPDATE OF c, s", [value.companyId]);
      const company = companyResult.rows[0];
      if (!company) throw new NotFoundException("기업을 찾을 수 없습니다.");
      const ownership = await quantity(client, userId, company.stock_id);
      if (ownership * 5n < BigInt(company.total_shares)) throw new ForbiddenException("지분 20% 이상이 필요합니다.");
      if (value.offerPrice < BigInt(company.current_price)) throw new BadRequestException("공개매수 가격은 현재가 이상이어야 합니다.");
      if (BigInt(portfolio.availableCash) < value.committedCash) throw new BadRequestException("사용 가능한 현금이 부족합니다.");
      const reserved = await client.query("UPDATE users SET reserved_cash = reserved_cash + $2, updated_at = now() WHERE id = $1 AND cash - reserved_cash >= $2 RETURNING id", [userId, value.committedCash.toString()]);
      if (reserved.rowCount !== 1) throw new BadRequestException("M&A 약정 현금을 예약할 수 없습니다.");
      const defenderOwnership = company.controlled_by_user_id ? await quantity(client, company.controlled_by_user_id, company.stock_id) : 0n;
      const tenderEndsAt = new Date(Date.now() + value.tenderDurationMinutes * 60_000);
      const proxyEndsAt = new Date(tenderEndsAt.getTime() + value.proxyDurationMinutes * 60_000);
      const baseScore = ownership + assetSnapshot / value.offerPrice / 100n;
      const inserted = await client.query(
        `INSERT INTO mna_campaigns
           (company_id, stock_id, attacker_user_id, idempotency_key, defender_user_id, offer_price, committed_cash,
            attacker_asset_snapshot, attacker_ownership_snapshot, defender_ownership_snapshot, attacker_score, tender_ends_at, proxy_ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [company.id, company.stock_id, userId, value.idempotencyKey, company.controlled_by_user_id, value.offerPrice.toString(), value.committedCash.toString(), assetSnapshot.toString(), ownership.toString(), defenderOwnership.toString(), baseScore.toString(), tenderEndsAt, proxyEndsAt],
      );
      await client.query(
        "INSERT INTO corporate_events (company_id, event_type, title, description, created_by_user_id, volatility_impact_bps, metadata) VALUES ($1, 'mna_declared', '적대적 M&A 선언', '공개매수와 위임장 경쟁이 시작되었습니다.', $2, 300, jsonb_build_object('offerPrice', $3::text))",
        [company.id, userId, value.offerPrice.toString()],
      );
      await client.query("COMMIT");
      return inserted.rows[0];
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  async tender(userId: string, campaignId: string, input: unknown) {
    const { quantity: tenderQuantity } = parse(tenderSchema, input);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const campaign = await activeCampaign(client, campaignId, "tendering");
      if (campaign.attacker_user_id === userId) throw new BadRequestException("공격자는 자신의 공개매수에 응할 수 없습니다.");
      const totalReserved = BigInt((await client.query<{ total: string }>("SELECT COALESCE(sum(quantity),0)::bigint AS total FROM mna_tender_offers WHERE campaign_id = $1 AND status = 'reserved'", [campaignId])).rows[0]?.total ?? "0");
      if ((totalReserved + tenderQuantity) * BigInt(campaign.offer_price) > BigInt(campaign.committed_cash)) throw new BadRequestException("남은 공개매수 약정 현금이 부족합니다.");
      const reserved = await client.query("UPDATE holdings SET reserved_quantity = reserved_quantity + $3, updated_at = now() WHERE user_id = $1 AND stock_id = $2 AND quantity - reserved_quantity >= $3 RETURNING id", [userId, campaign.stock_id, tenderQuantity.toString()]);
      if (reserved.rowCount !== 1) throw new BadRequestException("공개매수에 예약할 수 있는 주식이 부족합니다.");
      const inserted = await client.query("INSERT INTO mna_tender_offers (campaign_id, shareholder_user_id, quantity) VALUES ($1, $2, $3) RETURNING *", [campaignId, userId, tenderQuantity.toString()]);
      await client.query("COMMIT"); return inserted.rows[0];
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async support(userId: string, campaignId: string, input: unknown) {
    const { side } = parse(supportSchema, input);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const campaign = await activeCampaign(client, campaignId);
      const votes = await quantity(client, userId, campaign.stock_id);
      if (votes <= 0n) throw new ForbiddenException("의결권이 없습니다.");
      const inserted = await client.query("INSERT INTO mna_supports (campaign_id, user_id, side, voting_rights_snapshot) VALUES ($1, $2, $3::mna_side, $4) RETURNING *", [campaignId, userId, side, votes.toString()]);
      await client.query("COMMIT"); return inserted.rows[0];
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async action(userId: string, campaignId: string, input: unknown) {
    const value = parse(actionSchema, input);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const prior = await client.query("SELECT * FROM mna_actions WHERE actor_user_id = $1 AND idempotency_key = $2", [userId, value.idempotencyKey]);
      if (prior.rows[0]) { await client.query("COMMIT"); return prior.rows[0]; }
      const campaign = await activeCampaign(client, campaignId);
      if (value.side === "attacker" && campaign.attacker_user_id !== userId) throw new ForbiddenException("공격자만 실행할 수 있습니다.");
      if (value.side === "defender" && campaign.defender_user_id !== userId) throw new ForbiddenException("방어자만 실행할 수 있습니다.");
      let score = 0n;
      if (value.actionType === "add_cash") {
        if (value.side !== "attacker" || value.cashAmount <= 0n) throw new BadRequestException("공격자 현금 추가 금액이 필요합니다.");
        const reserved = await client.query("UPDATE users SET reserved_cash = reserved_cash + $2, updated_at = now() WHERE id = $1 AND cash - reserved_cash >= $2 RETURNING id", [userId, value.cashAmount.toString()]);
        if (reserved.rowCount !== 1) throw new BadRequestException("추가 현금을 예약할 수 없습니다.");
        await client.query("UPDATE mna_campaigns SET committed_cash = committed_cash + $2, attacker_score = attacker_score + $3, updated_at = now() WHERE id = $1", [campaignId, value.cashAmount.toString(), (value.cashAmount / BigInt(campaign.offer_price)).toString()]);
        score = value.cashAmount / BigInt(campaign.offer_price);
      } else if (value.actionType === "competing_tender") {
        if (value.side !== "attacker" || !value.offerPrice || value.offerPrice <= BigInt(campaign.offer_price)) throw new BadRequestException("더 높은 경쟁 공개매수 가격이 필요합니다.");
        const tendered = BigInt((await client.query<{ quantity: string }>("SELECT COALESCE(sum(quantity),0)::bigint AS quantity FROM mna_tender_offers WHERE campaign_id = $1 AND status = 'reserved'", [campaignId])).rows[0]?.quantity ?? "0");
        if (tendered * value.offerPrice > BigInt(campaign.committed_cash)) throw new BadRequestException("새 공개매수 가격을 충당할 약정 현금이 부족합니다.");
        score = max(1n, value.offerPrice - BigInt(campaign.offer_price));
        await client.query("UPDATE mna_campaigns SET offer_price = $2, attacker_score = attacker_score + $3, updated_at = now() WHERE id = $1", [campaignId, value.offerPrice.toString(), score.toString()]);
      } else {
        const votes = await quantity(client, userId, campaign.stock_id);
        score = max(1n, votes / 10n) + (value.cashAmount > 0n ? value.cashAmount / BigInt(campaign.offer_price) : 0n);
        if (value.cashAmount > 0n) {
          const paid = await client.query("UPDATE users SET cash = cash - $2, updated_at = now() WHERE id = $1 AND cash - reserved_cash >= $2 RETURNING id", [userId, value.cashAmount.toString()]);
          if (paid.rowCount !== 1) throw new BadRequestException("방어 액션 현금이 부족합니다.");
          await client.query("UPDATE companies SET cash = cash + $2, updated_at = now() WHERE id = $1", [campaign.company_id, value.cashAmount.toString()]);
        }
        await client.query(`UPDATE mna_campaigns SET ${value.side === "attacker" ? "attacker_score" : "defender_score"} = ${value.side === "attacker" ? "attacker_score" : "defender_score"} + $2, updated_at = now() WHERE id = $1`, [campaignId, score.toString()]);
      }
      const inserted = await client.query(
        "INSERT INTO mna_actions (campaign_id, actor_user_id, idempotency_key, side, action_type, cash_amount, score_delta, parameters) VALUES ($1, $2, $3, $4::mna_side, $5, $6, $7, $8::jsonb) RETURNING *",
        [campaignId, userId, value.idempotencyKey, value.side, value.actionType, value.cashAmount.toString(), score.toString(), JSON.stringify({ offerPrice: value.offerPrice?.toString() })],
      );
      await client.query("COMMIT"); return inserted.rows[0];
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}

@Controller("mna")
export class MnaController {
  constructor(private readonly mna: MnaService) {}
  @Get() list() { return this.mna.list(); }
  @Get(":id") detail(@Param("id", new ParseUUIDPipe()) id: string) { return this.mna.detail(id); }
  @Post() @UseGuards(AccessTokenGuard) create(@CurrentUser() user: AccessPrincipal, @Body() body: unknown) { return this.mna.create(user.userId, body); }
  @Post(":id/tenders") @UseGuards(AccessTokenGuard) tender(@CurrentUser() user: AccessPrincipal, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) { return this.mna.tender(user.userId, id, body); }
  @Post(":id/support") @UseGuards(AccessTokenGuard) support(@CurrentUser() user: AccessPrincipal, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) { return this.mna.support(user.userId, id, body); }
  @Post(":id/actions") @UseGuards(AccessTokenGuard) action(@CurrentUser() user: AccessPrincipal, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) { return this.mna.action(user.userId, id, body); }
}

type CampaignRow = { id: string; company_id: string; stock_id: string; attacker_user_id: string; defender_user_id: string | null; status: string; offer_price: string; committed_cash: string };
async function activeCampaign(client: { query: <T>(text: string, values?: unknown[]) => Promise<{ rows: T[] }> }, id: string, status?: string): Promise<CampaignRow> {
  const result = await client.query<CampaignRow>("SELECT * FROM mna_campaigns WHERE id = $1 AND status IN ('tendering','proxy_vote') FOR UPDATE", [id]);
  const campaign = result.rows[0];
  if (!campaign || (status && campaign.status !== status)) throw new BadRequestException("현재 단계에서 실행할 수 없습니다.");
  return campaign;
}
async function quantity(client: { query: <T>(text: string, values?: unknown[]) => Promise<{ rows: T[] }> }, userId: string, stockId: string): Promise<bigint> { const result = await client.query<{ quantity: string }>("SELECT quantity FROM holdings WHERE user_id = $1 AND stock_id = $2", [userId, stockId]); return BigInt(result.rows[0]?.quantity ?? "0"); }
function parse<T>(schema: z.ZodType<T>, input: unknown): T { const result = schema.safeParse(input); if (!result.success) throw new BadRequestException({ message: "M&A 입력이 올바르지 않습니다.", issues: result.error.issues }); return result.data; }
function max(left: bigint, right: bigint): bigint { return left > right ? left : right; }

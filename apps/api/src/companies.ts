import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AccessTokenGuard, CurrentUser, type AccessPrincipal } from "./auth.guard.js";
import { DatabaseService } from "./database.service.js";

const actionTypes = [
  "set_dividend", "invest_rd", "invest_marketing", "invest_capex", "repay_debt", "borrow",
  "buyback_proposal", "rights_issue_proposal", "sell_division", "enter_business", "replace_ceo", "cost_cutting",
] as const;

const actionSchema = z.object({
  idempotencyKey: z.uuid(),
  actionType: z.enum(actionTypes),
  amount: z.coerce.bigint().nonnegative().optional(),
  rateBps: z.number().int().min(0).max(10_000).optional(),
  businessName: z.string().trim().min(2).max(60).optional(),
}).superRefine((value, context) => {
  if (["invest_rd", "invest_marketing", "invest_capex", "repay_debt", "borrow", "enter_business"].includes(value.actionType) && (!value.amount || value.amount <= 0n)) {
    context.addIssue({ code: "custom", message: "이 경영 액션에는 양수 amount가 필요합니다." });
  }
  if (value.actionType === "set_dividend" && value.rateBps === undefined) context.addIssue({ code: "custom", message: "배당률이 필요합니다." });
  if (value.actionType === "enter_business" && !value.businessName) context.addIssue({ code: "custom", message: "신사업 이름이 필요합니다." });
});

type CompanyRow = {
  id: string; name: string; cash: string; debt: string; revenue: string; operating_profit: string; net_profit: string; book_value: string;
  growth_rate_bps: number; brand_value: string; technology_score: number; risk_score: number; dividend_rate_bps: number;
  controlled_by_user_id: string | null; total_shares: string; current_price: string; reference_price: string; stock_id: string; symbol: string;
};

type ManagementResponse = {
  companyId: string;
  actionType: typeof actionTypes[number];
  eventId?: string;
  currentPriceUnchanged: string;
  referencePrice: string;
  state: {
    cash: string; debt: string; revenue: string; operatingProfit: string; netProfit: string; bookValue: string;
    growthRateBps: number; brandValue: string; technologyScore: number; riskScore: number; dividendRateBps: number;
  };
};

@Injectable()
export class CompanyService {
  constructor(private readonly database: DatabaseService) {}

  async list() {
    const result = await this.database.pool.query(
      `SELECT c.id, c.name, c.status, sec.name AS sector, s.id AS stock_id, s.symbol, s.current_price, s.reference_price,
              s.current_price * s.total_shares AS market_cap, c.revenue, c.operating_profit, c.net_profit,
              c.growth_rate_bps, c.brand_value, c.technology_score, c.risk_score, c.controlled_by_user_id
       FROM companies c JOIN sectors sec ON sec.id = c.sector_id JOIN stocks s ON s.company_id = c.id
       ORDER BY s.symbol`,
    );
    return result.rows;
  }

  async detail(companyId: string, viewerUserId?: string) {
    const company = await this.company(companyId);
    const shareholders = await this.database.pool.query(
      `SELECT h.user_id, u.nickname, h.quantity,
              (h.quantity * 10000 / s.total_shares)::int AS ownership_bps,
              h.quantity AS voting_rights
       FROM holdings h JOIN users u ON u.id = h.user_id JOIN stocks s ON s.id = h.stock_id
       WHERE h.stock_id = $1 AND h.quantity > 0
       ORDER BY h.quantity DESC LIMIT 20`,
      [company.stock_id],
    );
    const events = await this.database.pool.query(
      "SELECT * FROM corporate_events WHERE company_id = $1 ORDER BY starts_at DESC LIMIT 100",
      [companyId],
    );
    const viewer = viewerUserId
      ? shareholders.rows.find((row) => row.user_id === viewerUserId) ?? { quantity: "0", ownership_bps: 0, voting_rights: "0" }
      : null;
    return { ...company, shareholders: shareholders.rows, viewer, events: events.rows };
  }

  async execute(userId: string, companyId: string, input: unknown): Promise<ManagementResponse> {
    const value = parse(actionSchema, input);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const prior = await client.query<{ result: ManagementResponse }>(
        "SELECT result FROM management_actions WHERE executed_by_user_id = $1 AND idempotency_key = $2",
        [userId, value.idempotencyKey],
      );
      if (prior.rows[0]) {
        await client.query("COMMIT");
        return prior.rows[0].result;
      }
      const companyResult = await client.query<CompanyRow>(
        `SELECT c.*, s.id AS stock_id, s.symbol, s.total_shares, s.current_price, s.reference_price
         FROM companies c JOIN stocks s ON s.company_id = c.id WHERE c.id = $1 FOR UPDATE OF c, s`,
        [companyId],
      );
      const company = companyResult.rows[0];
      if (!company) throw new NotFoundException("기업을 찾을 수 없습니다.");
      const holding = await client.query<{ quantity: string }>("SELECT quantity FROM holdings WHERE user_id = $1 AND stock_id = $2", [userId, company.stock_id]);
      const ownership = BigInt(holding.rows[0]?.quantity ?? "0");
      const controls = company.controlled_by_user_id === userId || ownership * 2n > BigInt(company.total_shares);
      if (!controls) throw new ForbiddenException("지배권을 확보한 사용자만 경영 액션을 실행할 수 있습니다.");
      if (!company.controlled_by_user_id) await client.query("UPDATE companies SET controlled_by_user_id = $2, controlled_at = now() WHERE id = $1", [company.id, userId]);

      const state = {
        cash: BigInt(company.cash), debt: BigInt(company.debt), revenue: BigInt(company.revenue),
        operatingProfit: BigInt(company.operating_profit), netProfit: BigInt(company.net_profit), bookValue: BigInt(company.book_value),
        growthRateBps: company.growth_rate_bps, brandValue: BigInt(company.brand_value), technologyScore: company.technology_score,
        riskScore: company.risk_score, dividendRateBps: company.dividend_rate_bps,
      };
      const amount = value.amount ?? 0n;
      let fairValueImpactBps = 0;
      let demandImpactBps = 0;
      let liquidityImpactBps = 0;
      let volatilityImpactBps = 0;
      let title: string = value.actionType;
      switch (value.actionType) {
        case "set_dividend":
          state.dividendRateBps = value.rateBps!; demandImpactBps = Math.floor(value.rateBps! / 10); title = "배당 정책 변경"; break;
        case "invest_rd":
          spend(state, amount); state.technologyScore = clampInt(state.technologyScore + scoreImpact(amount, state.revenue), 0, 1000); state.growthRateBps += scoreImpact(amount, state.revenue) * 20; fairValueImpactBps = 150; title = "R&D 투자"; break;
        case "invest_marketing":
          spend(state, amount); state.brandValue += amount; state.growthRateBps += scoreImpact(amount, state.revenue) * 10; demandImpactBps = 200; title = "마케팅 투자"; break;
        case "invest_capex":
          spend(state, amount); state.bookValue += amount; state.growthRateBps += scoreImpact(amount, state.revenue) * 8; fairValueImpactBps = 100; title = "설비 투자"; break;
        case "repay_debt": {
          const repayment = min(amount, state.debt); spend(state, repayment); state.debt -= repayment; state.riskScore = clampInt(state.riskScore - scoreImpact(repayment, max(1n, state.debt + repayment)), 0, 1000); fairValueImpactBps = 100; title = "부채 상환"; break;
        }
        case "borrow":
          state.cash += amount; state.debt += amount; state.riskScore = clampInt(state.riskScore + scoreImpact(amount, max(1n, state.bookValue)), 0, 1000); volatilityImpactBps = 100; title = "신규 차입"; break;
        case "buyback_proposal": demandImpactBps = 250; liquidityImpactBps = -100; title = "자사주 매입 제안"; break;
        case "rights_issue_proposal": demandImpactBps = -150; liquidityImpactBps = 200; title = "증자 제안"; break;
        case "sell_division": {
          const proceeds = max(1n, state.bookValue / 20n); state.cash += proceeds; state.bookValue -= min(state.bookValue, proceeds); state.brandValue -= min(state.brandValue, proceeds / 2n); fairValueImpactBps = -100; title = "사업부 매각"; break;
        }
        case "enter_business":
          spend(state, amount); state.growthRateBps += scoreImpact(amount, state.revenue) * 15; state.riskScore = clampInt(state.riskScore + 20, 0, 1000); volatilityImpactBps = 200; title = `신사업 진출: ${value.businessName}`; break;
        case "replace_ceo": state.riskScore = clampInt(state.riskScore - 10, 0, 1000); volatilityImpactBps = 100; title = "CEO 교체"; break;
        case "cost_cutting": state.operatingProfit += max(0n, state.revenue / 100n); state.netProfit += max(0n, state.revenue / 200n); state.brandValue = state.brandValue * 99n / 100n; state.riskScore = clampInt(state.riskScore + 5, 0, 1000); title = "비용 절감"; break;
      }
      state.growthRateBps = clampInt(state.growthRateBps, -10_000, 100_000);
      const referencePrice = fairValue(state, BigInt(company.total_shares));
      await client.query(
        `UPDATE companies SET cash = $2, debt = $3, revenue = $4, operating_profit = $5, net_profit = $6, book_value = $7,
           growth_rate_bps = $8, brand_value = $9, technology_score = $10, risk_score = $11, dividend_rate_bps = $12, updated_at = now()
         WHERE id = $1`,
        [company.id, state.cash.toString(), state.debt.toString(), state.revenue.toString(), state.operatingProfit.toString(), state.netProfit.toString(), state.bookValue.toString(), state.growthRateBps, state.brandValue.toString(), state.technologyScore, state.riskScore, state.dividendRateBps],
      );
      await client.query("UPDATE stocks SET reference_price = $2, updated_at = now() WHERE id = $1", [company.stock_id, referencePrice.toString()]);
      const event = await client.query<{ id: string }>(
        `INSERT INTO corporate_events
           (company_id, event_type, title, description, fair_value_impact_bps, demand_impact_bps, liquidity_impact_bps, volatility_impact_bps, created_by_user_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, jsonb_build_object('amount', $10::text)) RETURNING id`,
        [company.id, value.actionType, title, `${title} 경영 결정`, fairValueImpactBps, demandImpactBps, liquidityImpactBps, volatilityImpactBps, userId, amount.toString()],
      );
      const eventId = event.rows[0]?.id;
      if (!eventId) throw new Error("Corporate event insert returned no row");
      const response: ManagementResponse = {
        companyId: company.id, actionType: value.actionType, eventId,
        currentPriceUnchanged: company.current_price, referencePrice: referencePrice.toString(),
        state: { ...state, cash: state.cash.toString(), debt: state.debt.toString(), revenue: state.revenue.toString(), operatingProfit: state.operatingProfit.toString(), netProfit: state.netProfit.toString(), bookValue: state.bookValue.toString(), brandValue: state.brandValue.toString() },
      };
      await client.query(
        `INSERT INTO management_actions (company_id, executed_by_user_id, idempotency_key, action_type, amount, parameters, result)
         VALUES ($1, $2, $3, $4::management_action_type, $5, $6::jsonb, $7::jsonb)`,
        [company.id, userId, value.idempotencyKey, value.actionType, amount.toString(), JSON.stringify({ rateBps: value.rateBps, businessName: value.businessName }), JSON.stringify(response)],
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async company(companyId: string) {
    const result = await this.database.pool.query(
      `SELECT c.*, sec.name AS sector, s.id AS stock_id, s.symbol, s.total_shares, s.free_float_shares,
              s.treasury_shares, s.current_price, s.reference_price, s.is_trading_halted
       FROM companies c JOIN sectors sec ON sec.id = c.sector_id JOIN stocks s ON s.company_id = c.id WHERE c.id = $1`,
      [companyId],
    );
    if (!result.rows[0]) throw new NotFoundException("기업을 찾을 수 없습니다.");
    return result.rows[0];
  }
}

@Controller("companies")
export class CompanyController {
  constructor(private readonly companies: CompanyService) {}
  @Get() list() { return this.companies.list(); }
  @Get(":id") detail(@Param("id", new ParseUUIDPipe()) id: string) { return this.companies.detail(id); }
  @Post(":id/actions") @UseGuards(AccessTokenGuard)
  execute(@CurrentUser() user: AccessPrincipal, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) { return this.companies.execute(user.userId, id, body); }
}

function fairValue(state: { bookValue: bigint; netProfit: bigint; brandValue: bigint; technologyScore: number; riskScore: number; growthRateBps: number }, shares: bigint): bigint {
  const enterprise = max(1n, state.bookValue + state.netProfit * 10n + state.brandValue + BigInt(state.technologyScore) * 100_000_000n);
  const growthFactor = BigInt(clampInt(10_000 + Math.floor(state.growthRateBps / 2) - state.riskScore * 5, 3_000, 30_000));
  return max(1n, enterprise * growthFactor / 10_000n / max(1n, shares));
}
function spend(state: { cash: bigint }, amount: bigint) { if (amount > state.cash) throw new BadRequestException("기업 현금이 부족합니다."); state.cash -= amount; }
function scoreImpact(amount: bigint, base: bigint): number { return Number(min(50n, amount * 100n / max(1n, base))); }
function parse<T>(schema: z.ZodType<T>, input: unknown): T { const result = schema.safeParse(input); if (!result.success) throw new BadRequestException({ message: "경영 액션 입력이 올바르지 않습니다.", issues: result.error.issues }); return result.data; }
function clampInt(value: number, low: number, high: number): number { return Math.max(low, Math.min(value, high)); }
function min(left: bigint, right: bigint): bigint { return left < right ? left : right; }
function max(left: bigint, right: bigint): bigint { return left > right ? left : right; }

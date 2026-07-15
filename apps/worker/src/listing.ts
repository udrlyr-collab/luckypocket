import { canEnterDelistingReview } from "@market-dominion/domain";
import type { Pool } from "pg";

type Row = {
  stock_id: string; company_id: string;
  listing_status: "normal" | "warning" | "distress_review" | "delisting_review" | "halted" | "delisted";
  listing_review_ends_at: Date | null; current_price: string; total_shares: string;
  reports: Array<{ cash: string; debt: string; book_value: string; net_profit: string }>;
};

export async function runListingReviewCycle(pool: Pool, now = new Date()): Promise<{ warning: number; review: number; recovered: number; delisted: number }> {
  const result = await pool.query<Row>(
    `SELECT s.id stock_id,c.id company_id,s.listing_status,s.listing_review_ends_at,s.current_price,s.total_shares,
            COALESCE((SELECT jsonb_agg(x ORDER BY x.published_at DESC) FROM
              (SELECT cash,debt,book_value,net_profit,published_at FROM financial_reports WHERE company_id=c.id ORDER BY published_at DESC LIMIT 2)x),'[]'::jsonb) reports
     FROM stocks s JOIN companies c ON c.id=s.company_id
     WHERE s.asset_type='common' AND s.listing_status<>'delisted'`,
  );
  let warning = 0, review = 0, recovered = 0, delisted = 0;
  for (const row of result.rows) {
    if (row.reports.length < 2) continue;
    const bad = row.reports.map(isDistressed), severe = bad[0] && bad[1];
    const marketCap = BigInt(row.current_price) * BigInt(row.total_shares);
    const eligibleForDelisting = canEnterDelistingReview(marketCap);
    if (row.listing_status === "normal" && bad[0] && !severe) {
      await set(pool, row.stock_id, "warning", "최근 재무 악화", null, false); warning += 1;
    } else if (["normal", "warning"].includes(row.listing_status) && severe) {
      await set(pool, row.stock_id, "distress_review", "2개 연속 재무 기준 미달", plusDays(now, 7), false); review += 1;
    } else if (row.listing_status === "warning" && !bad[0]) {
      await set(pool, row.stock_id, "normal", null, null, false); recovered += 1;
    } else if (row.listing_status === "distress_review" && due(row, now)) {
      if (!severe) {
        await set(pool, row.stock_id, "normal", null, null, false); recovered += 1;
      } else if (eligibleForDelisting) {
        await set(pool, row.stock_id, "delisting_review", "재무 미회복 및 시가총액 50억원 미만", plusDays(now, 7), true); review += 1;
      } else {
        await set(pool, row.stock_id, "distress_review", "재무 미회복·시가총액 상장폐지 기준 이상", plusDays(now, 7), false); review += 1;
      }
    } else if (row.listing_status === "delisting_review" && due(row, now)) {
      if (!severe) {
        await set(pool, row.stock_id, "normal", null, null, false); recovered += 1;
      } else if (!eligibleForDelisting) {
        await set(pool, row.stock_id, "distress_review", "시가총액 50억원 이상 회복", plusDays(now, 7), false); recovered += 1;
      } else {
        await set(pool, row.stock_id, "delisted", "상장폐지 심사 기간 내 재무 및 시가총액 기준 미회복", null, true);
        await pool.query("UPDATE companies SET status='delisted',updated_at=now() WHERE id=$1", [row.company_id]);
        delisted += 1;
      }
    }
  }
  return { warning, review, recovered, delisted };
}

function isDistressed(report: { cash: string; debt: string; book_value: string; net_profit: string }): boolean {
  const cash = BigInt(report.cash), debt = BigInt(report.debt), book = BigInt(report.book_value), profit = BigInt(report.net_profit);
  return cash <= 0n || debt > max(1n, book * 2n) || profit < 0n;
}
function due(row: Row, now: Date): boolean { return row.listing_review_ends_at !== null && new Date(row.listing_review_ends_at).getTime() <= now.getTime(); }
function plusDays(now: Date, days: number): Date { return new Date(now.getTime() + days * 86_400_000); }
async function set(pool: Pool, id: string, status: string, reason: string | null, end: Date | null, halted: boolean): Promise<void> {
  await pool.query("UPDATE stocks SET listing_status=$2::listing_status,listing_status_reason=$3,listing_review_ends_at=$4,is_trading_halted=$5,updated_at=now() WHERE id=$1", [id, status, reason, end, halted]);
}
function max(a: bigint, b: bigint): bigint { return a > b ? a : b; }

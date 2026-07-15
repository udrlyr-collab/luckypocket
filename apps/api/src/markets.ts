import { BadRequestException, Controller, Get, Injectable, NotFoundException, Param, ParseIntPipe, Query } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";

const intervals = {
  "1m": "1 minute",
  "5m": "5 minutes",
  "15m": "15 minutes",
  "1h": "1 hour",
  "4h": "4 hours",
  "1d": "1 day",
} as const;

@Injectable()
export class MarketService {
  constructor(private readonly database: DatabaseService) {}

  async listStocks(page: number, pageSize: number, search?: string) {
    if (page < 1 || pageSize < 1 || pageSize > 100) throw new BadRequestException("pagination 값이 올바르지 않습니다.");
    const query = search?.trim() || null;
    const offset = (page - 1) * pageSize;
    const result = await this.database.pool.query(
      `SELECT s.id, s.symbol, c.name, sec.name AS sector, c.status,
              s.current_price, s.previous_close, s.total_shares,
              s.current_price * s.total_shares AS market_cap,
              s.is_trading_halted, s.listing_status, s.listing_status_reason, s.listing_review_ends_at,
              count(*) OVER()::int AS total_count
       FROM stocks s
       JOIN companies c ON c.id = s.company_id
       JOIN sectors sec ON sec.id = c.sector_id
       WHERE ($1::text IS NULL OR s.symbol ILIKE '%' || $1 || '%' OR c.name ILIKE '%' || $1 || '%')
       ORDER BY s.symbol ASC
       LIMIT $2 OFFSET $3`,
      [query, pageSize, offset],
    );
    return { page, pageSize, total: result.rows[0]?.total_count ?? 0, items: result.rows.map(({ total_count: _total, ...row }) => row) };
  }

  async stock(symbol: string) {
    const result = await this.database.pool.query(
      `SELECT s.*, c.name, c.description, c.status AS company_status,
              c.cash AS company_cash, c.debt, c.revenue, c.operating_profit, c.net_profit, c.book_value,
              c.controlled_by_user_id,
              sec.name AS sector,
              s.current_price * s.total_shares AS market_cap,
              COALESCE((
                SELECT jsonb_agg(shareholder ORDER BY (shareholder->>'quantity')::bigint DESC)
                FROM (
                  SELECT jsonb_build_object('userId', h.user_id, 'nickname', u.nickname, 'quantity', h.quantity,
                    'ownershipBps', h.quantity * 10000 / s.total_shares) AS shareholder
                  FROM holdings h JOIN users u ON u.id = h.user_id
                  WHERE h.stock_id = s.id AND h.quantity * 20 >= s.total_shares
                ) disclosed
              ), '[]'::jsonb) AS top_shareholders
       FROM stocks s JOIN companies c ON c.id = s.company_id JOIN sectors sec ON sec.id = c.sector_id
       WHERE s.symbol = $1`,
      [normalizeSymbol(symbol)],
    );
    if (!result.rows[0]) throw new NotFoundException("종목을 찾을 수 없습니다.");
    return result.rows[0];
  }

  async orderBook(symbol: string, depth: number) {
    if (depth < 1 || depth > 100) throw new BadRequestException("호가 depth는 1~100이어야 합니다.");
    const stock = await this.stockIdentity(symbol);
    const result = await this.database.pool.query<{ side: "buy" | "sell"; price: string; quantity: string; order_count: number }>(
      `WITH levels AS (
         SELECT side, limit_price AS price,
                sum(quantity - filled_quantity)::bigint AS quantity,
                count(*)::int AS order_count
         FROM orders
         WHERE stock_id = $1 AND type = 'limit' AND status IN ('pending', 'open', 'partially_filled')
         GROUP BY side, limit_price
       ), ranked AS (
         SELECT *, row_number() OVER (PARTITION BY side ORDER BY
           CASE WHEN side = 'buy' THEN price END DESC,
           CASE WHEN side = 'sell' THEN price END ASC
         ) AS rank
         FROM levels
       )
       SELECT side, price, quantity, order_count FROM ranked WHERE rank <= $2`,
      [stock.id, depth],
    );
    const bids = result.rows.filter((row) => row.side === "buy").sort((a, b) => compareBigInt(BigInt(b.price), BigInt(a.price)));
    const asks = result.rows.filter((row) => row.side === "sell").sort((a, b) => compareBigInt(BigInt(a.price), BigInt(b.price)));
    return {
      stockId: stock.id,
      symbol: stock.symbol,
      currentPrice: stock.current_price,
      bids: bids.map(level),
      asks: asks.map(level),
      spread: bids[0] && asks[0] ? (BigInt(asks[0].price) - BigInt(bids[0].price)).toString() : null,
    };
  }

  async recentTrades(symbol: string, limit: number) {
    if (limit < 1 || limit > 500) throw new BadRequestException("limit은 1~500이어야 합니다.");
    const stock = await this.stockIdentity(symbol);
    const result = await this.database.pool.query(
      "SELECT id, sequence, price, quantity, created_at FROM trades WHERE stock_id = $1 ORDER BY sequence DESC LIMIT $2",
      [stock.id, limit],
    );
    return { stockId: stock.id, symbol: stock.symbol, items: result.rows };
  }

  async candles(symbol: string, intervalKey: string, limit: number) {
    const duration = intervals[intervalKey as keyof typeof intervals];
    if (!duration) throw new BadRequestException("지원하지 않는 캔들 interval입니다.");
    if (limit < 1 || limit > 2_000) throw new BadRequestException("limit은 1~2000이어야 합니다.");
    const stock = await this.stockIdentity(symbol);
    const result = await this.database.pool.query(
      `WITH buckets AS (
         SELECT date_bin($2::interval, opened_at, timestamptz '1970-01-01 00:00:00+00') AS opened_at,
                opened_at AS source_time, open, high, low, close, volume
         FROM candles WHERE stock_id = $1 AND interval = '1m'
       )
       SELECT opened_at,
              (array_agg(open ORDER BY source_time ASC))[1] AS open,
              max(high) AS high,
              min(low) AS low,
              (array_agg(close ORDER BY source_time DESC))[1] AS close,
              sum(volume)::bigint AS volume
       FROM buckets GROUP BY opened_at ORDER BY opened_at DESC LIMIT $3`,
      [stock.id, duration, limit],
    );
    return { stockId: stock.id, symbol: stock.symbol, interval: intervalKey, items: result.rows.reverse() };
  }

  private async stockIdentity(symbol: string): Promise<{ id: string; symbol: string; current_price: string }> {
    const result = await this.database.pool.query<{ id: string; symbol: string; current_price: string }>(
      "SELECT id, symbol, current_price FROM stocks WHERE symbol = $1",
      [normalizeSymbol(symbol)],
    );
    if (!result.rows[0]) throw new NotFoundException("종목을 찾을 수 없습니다.");
    return result.rows[0];
  }
}

@Controller("stocks")
export class MarketController {
  constructor(private readonly markets: MarketService) {}

  @Get() list(@Query("page", new ParseIntPipe({ optional: true })) page = 1, @Query("pageSize", new ParseIntPipe({ optional: true })) pageSize = 50, @Query("search") search?: string) {
    return this.markets.listStocks(page, pageSize, search);
  }

  @Get(":symbol") stock(@Param("symbol") symbol: string) { return this.markets.stock(symbol); }
  @Get(":symbol/order-book") orderBook(@Param("symbol") symbol: string, @Query("depth", new ParseIntPipe({ optional: true })) depth = 20) { return this.markets.orderBook(symbol, depth); }
  @Get(":symbol/trades") trades(@Param("symbol") symbol: string, @Query("limit", new ParseIntPipe({ optional: true })) limit = 100) { return this.markets.recentTrades(symbol, limit); }
  @Get(":symbol/candles") candles(@Param("symbol") symbol: string, @Query("interval") interval = "1m", @Query("limit", new ParseIntPipe({ optional: true })) limit = 500) { return this.markets.candles(symbol, interval, limit); }
}

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(normalized)) throw new BadRequestException("종목 코드가 올바르지 않습니다.");
  return normalized;
}

function level(row: { price: string; quantity: string; order_count: number }) {
  return { price: row.price, quantity: row.quantity, orderCount: row.order_count };
}

function compareBigInt(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

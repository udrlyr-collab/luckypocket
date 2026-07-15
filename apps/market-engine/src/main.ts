import { LimitOrderBook } from "@market-dominion/domain";
import { auditLedgerConsistency, createDatabase } from "@market-dominion/database";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { matchOrder } from "./matching.js";

const books = new Map<string, LimitOrderBook>();

export function orderBookFor(symbol: string): LimitOrderBook {
  let book = books.get(symbol);
  if (!book) {
    book = new LimitOrderBook(symbol);
    books.set(symbol, book);
  }
  return book;
}

if (process.env.NODE_ENV !== "test") await start();

async function start(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!redisUrl) throw new Error("REDIS_URL is required");
  const { pool } = createDatabase(databaseUrl);
  const ledgerIssues = await auditLedgerConsistency(pool);
  if (ledgerIssues.length > 0) throw new Error(`LEDGER_RECONCILIATION_FAILED:${ledgerIssues.length}`);
  const connection = { url: redisUrl };
  const queue = new Queue("market-orders", { connection });
  const heartbeat = new Redis(redisUrl, { maxRetriesPerRequest: null });
  await heartbeat.set("service:market-engine:heartbeat", Date.now().toString(), "EX", 20);
  const heartbeatTimer = setInterval(() => { void heartbeat.set("service:market-engine:heartbeat", Date.now().toString(), "EX", 20); }, 5_000);
  const worker = new Worker<{ orderId: string; stockId: string }>(
    "market-orders",
    async (job) => {
      const result = await matchOrder(pool, job.data.orderId, job.data.stockId);
      if (result.trades > 0) {
        const triggered = await pool.query<{ id: string; stock_id: string }>(
          `SELECT o.id, o.stock_id
           FROM orders o JOIN stocks s ON s.id = o.stock_id
           WHERE o.stock_id = $1 AND o.type = 'stop' AND o.status = 'pending'
             AND ((o.side = 'buy' AND s.current_price >= o.stop_price)
               OR (o.side = 'sell' AND s.current_price <= o.stop_price))`,
          [job.data.stockId],
        );
        for (const order of triggered.rows) {
          await queue.add("match", { orderId: order.id, stockId: order.stock_id }, matchingJobOptions(order.id));
        }
      }
      return result;
    },
    { connection, concurrency: Math.max(1, Number(process.env.MATCHING_CONCURRENCY ?? 4)) },
  );

  const pending = await pool.query<{ id: string; stock_id: string }>(
    "SELECT id, stock_id FROM orders WHERE status IN ('pending', 'open', 'partially_filled') ORDER BY sequence ASC LIMIT 100000",
  );
  for (const order of pending.rows) {
    await queue.add("match", { orderId: order.id, stockId: order.stock_id }, matchingJobOptions(order.id));
  }

  worker.on("failed", (job, error) => {
    process.stderr.write(JSON.stringify({ level: "error", event: "matching_job_failed", jobId: job?.id, message: error.message }) + "\n");
  });
  process.stdout.write(JSON.stringify({ level: "info", event: "market_engine_ready", recoveredOrders: pending.rowCount ?? 0 }) + "\n");

  const shutdown = async () => {
    clearInterval(heartbeatTimer);
    await heartbeat.del("service:market-engine:heartbeat");
    await heartbeat.quit();
    await worker.close();
    await queue.close();
    await pool.end();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function matchingJobOptions(orderId: string) {
  return {
    jobId: orderId,
    attempts: 10,
    backoff: { type: "exponential" as const, delay: 250 },
    removeOnComplete: true,
    removeOnFail: 10_000,
  };
}

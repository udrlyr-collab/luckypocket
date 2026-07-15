import { Queue, Worker } from "bullmq";
import { advanceDueMnaCampaigns, auditLedgerConsistency, createDatabase } from "@market-dominion/database";
import { Redis } from "ioredis";
import type { Pool } from "pg";
import { pruneExpiredMarketMakerQuotes, refreshDueMarketMakers } from "./market-maker.js";
import { runRiskCycle } from "./risk.js";
import { refreshMarketState } from "./market-state.js";
import { runStrategyCycle } from "./strategies.js";
import { runValuationCycle } from "./valuation.js";
import { runIpoCycle } from "./ipo.js";
import { runListingReviewCycle } from "./listing.js";
import { runCorporateCycle } from "./corporate.js";
import { runStabilityCycle } from "./stability.js";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  process.stdout.write("worker ready; REDIS_URL required to consume jobs\n");
} else {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const { pool } = createDatabase(databaseUrl);
  const ledgerIssues = await auditLedgerConsistency(pool);
  if (ledgerIssues.length > 0) throw new Error(`LEDGER_RECONCILIATION_FAILED:${ledgerIssues.length}`);
  const publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const connection = { url: redisUrl };
  const marketOrderQueue = new Queue("market-orders", { connection });
  await publisher.set("service:worker:heartbeat", Date.now().toString(), "EX", 20);
  const heartbeatTimer = setInterval(() => { void publisher.set("service:worker:heartbeat", Date.now().toString(), "EX", 20); }, 5_000);
  const worker = new Worker("market-jobs", async (job) => ({ id: job.id, name: job.name }), { connection });
  let stopping = false;
  void relayOutbox(pool, publisher, () => stopping);
  void marketMakerLoop(pool, marketOrderQueue, () => stopping);
  void marketMakerCleanupLoop(pool, () => stopping);
  void riskLoop(pool, marketOrderQueue, () => stopping);
  void marketStateLoop(pool, () => stopping);
  void mnaLoop(pool, () => stopping);
  void strategyLoop(pool, marketOrderQueue, () => stopping);
  void valuationLoop(pool, () => stopping);
  void ipoLoop(pool, () => stopping);
  void listingLoop(pool, () => stopping);
  void corporateLoop(pool, () => stopping);
  void stabilityLoop(pool, () => stopping);
  const shutdown = async () => {
    stopping = true;
    clearInterval(heartbeatTimer);
    await publisher.del("service:worker:heartbeat");
    await worker.close();
    await marketOrderQueue.close();
    await publisher.quit();
    await pool.end();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function stabilityLoop(pool: Pool, isStopping: () => boolean): Promise<void> {
  while (!isStopping()) {
    try { await runStabilityCycle(pool); }
    catch (error) { process.stderr.write(JSON.stringify({ level: "error", event: "stability_cycle_failed", message: error instanceof Error ? error.message : String(error) }) + "\n"); }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

async function corporateLoop(pool: Pool, isStopping: () => boolean): Promise<void> {
  while (!isStopping()) {
    try { await runCorporateCycle(pool); }
    catch (error) { process.stderr.write(JSON.stringify({ level: "error", event: "corporate_cycle_failed", message: error instanceof Error ? error.message : String(error) }) + "\n"); }
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

async function listingLoop(pool: Pool, isStopping: () => boolean): Promise<void> {
  while (!isStopping()) {
    try { await runListingReviewCycle(pool); }
    catch (error) { process.stderr.write(JSON.stringify({ level: "error", event: "listing_review_failed", message: error instanceof Error ? error.message : String(error) }) + "\n"); }
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

async function ipoLoop(pool: Pool, isStopping: () => boolean): Promise<void> {
  while (!isStopping()) {
    try { await runIpoCycle(pool); }
    catch (error) { process.stderr.write(JSON.stringify({ level: "error", event: "ipo_cycle_failed", message: error instanceof Error ? error.message : String(error) }) + "\n"); }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

async function valuationLoop(pool: Pool, isStopping: () => boolean): Promise<void> {
  while (!isStopping()) {
    try { await runValuationCycle(pool); }
    catch (error) { process.stderr.write(JSON.stringify({ level: "error", event: "valuation_cycle_failed", message: error instanceof Error ? error.message : String(error) }) + "\n"); }
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

async function strategyLoop(pool: Pool, queue: Queue, isStopping: () => boolean): Promise<void> {
  while (!isStopping()) {
    try { await runStrategyCycle(pool, queue); }
    catch (error) { process.stderr.write(JSON.stringify({ level: "error", event: "strategy_cycle_failed", message: error instanceof Error ? error.message : String(error) }) + "\n"); }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function mnaLoop(pool: Pool, isStopping: () => boolean): Promise<void> {
  while (!isStopping()) {
    try { await advanceDueMnaCampaigns(pool); }
    catch (error) { process.stderr.write(JSON.stringify({ level: "error", event: "mna_cycle_failed", message: error instanceof Error ? error.message : String(error) }) + "\n"); }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

async function marketStateLoop(pool: Pool, isStopping: () => boolean): Promise<void> {
  while (!isStopping()) {
    try { await refreshMarketState(pool); }
    catch (error) { process.stderr.write(JSON.stringify({ level: "error", event: "market_state_refresh_failed", message: error instanceof Error ? error.message : String(error) }) + "\n"); }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

async function riskLoop(pool: Pool, queue: Queue, isStopping: () => boolean): Promise<void> {
  while (!isStopping()) {
    try {
      const result = await runRiskCycle(pool);
      for (const order of result.liquidationOrders) {
        await queue.add("match", { orderId: order.orderId, stockId: order.stockId }, {
          jobId: order.orderId,
          attempts: 20,
          backoff: { type: "exponential", delay: 250 },
          removeOnComplete: true,
          removeOnFail: 10_000,
        });
      }
    } catch (error) {
      process.stderr.write(JSON.stringify({ level: "error", event: "risk_cycle_failed", message: error instanceof Error ? error.message : String(error) }) + "\n");
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

async function marketMakerLoop(pool: Pool, queue: Queue, isStopping: () => boolean): Promise<void> {
  while (!isStopping()) {
    try {
      const orderIds = await refreshDueMarketMakers(pool, 20);
      for (const order of orderIds) {
        await queue.add("match", order, {
          jobId: order.orderId,
          attempts: 10,
          backoff: { type: "exponential", delay: 250 },
          removeOnComplete: true,
          removeOnFail: 10_000,
        });
      }
    } catch (error) {
      process.stderr.write(JSON.stringify({ level: "error", event: "market_maker_refresh_failed", message: error instanceof Error ? error.message : String(error) }) + "\n");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function marketMakerCleanupLoop(pool: Pool, isStopping: () => boolean): Promise<void> {
  while (!isStopping()) {
    try { await pruneExpiredMarketMakerQuotes(pool); }
    catch (error) { process.stderr.write(JSON.stringify({ level: "error", event: "market_maker_cleanup_failed", message: error instanceof Error ? error.message : String(error) }) + "\n"); }
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

async function relayOutbox(pool: Pool, publisher: Redis, isStopping: () => boolean): Promise<void> {
  while (!isStopping()) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string; event_type: string; payload: unknown }>(
        `SELECT id, event_type, payload
         FROM outbox_events
         WHERE processed_at IS NULL
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 100`,
      );
      for (const event of result.rows) {
        await publisher.publish("market:events", JSON.stringify({ eventId: event.id, eventType: event.event_type, payload: event.payload }));
        await client.query("UPDATE outbox_events SET processed_at = now(), attempts = attempts + 1 WHERE id = $1", [event.id]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      process.stderr.write(JSON.stringify({ level: "error", event: "outbox_relay_failed", message: error instanceof Error ? error.message : String(error) }) + "\n");
    } finally {
      client.release();
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

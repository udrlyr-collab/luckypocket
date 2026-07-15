import { Controller, Get, Injectable, OnModuleDestroy, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { AccessTokenGuard, AdminGuard } from "./auth.guard.js";
import { DatabaseService } from "./database.service.js";
import { MarketGateway } from "./market.gateway.js";

@Injectable()
export class HealthService implements OnModuleDestroy {
  readonly #redis: Redis;
  readonly #marketQueue: Queue;
  constructor(private readonly database: DatabaseService, private readonly gateway: MarketGateway) {
    const redisUrl = process.env.REDIS_URL; if (!redisUrl) throw new Error("REDIS_URL is required");
    this.#redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2_000 });
    this.#marketQueue = new Queue("market-orders", { connection: { url: redisUrl } });
  }
  basic() { return { status: "ok", service: "api", timestamp: new Date().toISOString() }; }
  async db() { try { await this.database.pool.query("SELECT 1"); return { status: "ok", service: "db" }; } catch { throw new ServiceUnavailableException({ status: "down", service: "db" }); } }
  async redis() { try { const result = await this.#redis.ping(); if (result !== "PONG") throw new Error(); return { status: "ok", service: "redis" }; } catch { throw new ServiceUnavailableException({ status: "down", service: "redis" }); } }
  async heartbeat(service: "market-engine" | "worker") { const raw = await this.#redis.get(`service:${service}:heartbeat`); const ageMs = raw ? Date.now() - Number(raw) : Number.POSITIVE_INFINITY; if (!Number.isFinite(ageMs) || ageMs > 20_000) throw new ServiceUnavailableException({ status: "down", service, ageMs: Number.isFinite(ageMs) ? ageMs : null }); return { status: "ok", service, ageMs }; }
  async status() {
    const [openOrders, recentTrades, failedJobs, market, worker] = await Promise.all([
      this.database.pool.query("SELECT count(*)::int count FROM orders WHERE status IN ('pending','open','partially_filled')"),
      this.database.pool.query("SELECT count(*)::int count FROM trades WHERE created_at>=now()-interval '5 minutes'"),
      this.#marketQueue.getFailedCount(), this.safeHeartbeat("market-engine"), this.safeHeartbeat("worker"),
    ]);
    return { api: "ok", db: "ok", redis: await this.#redis.ping(), marketEngine: market, worker, openOrders: openOrders.rows[0]?.count ?? 0, recentTrades: recentTrades.rows[0]?.count ?? 0, failedJobs, websocketConnections: this.gateway.connectionCount() };
  }
  async onModuleDestroy() { await this.#marketQueue.close(); await this.#redis.quit(); }
  private async safeHeartbeat(service: "market-engine" | "worker") { try { return await this.heartbeat(service); } catch { return { status: "down", service }; } }
}

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}
  @Get() basic() { return this.health.basic(); }
  @Get("db") db() { return this.health.db(); }
  @Get("redis") redis() { return this.health.redis(); }
  @Get("market-engine") engine() { return this.health.heartbeat("market-engine"); }
}

@Controller("admin/status") @UseGuards(AccessTokenGuard, AdminGuard)
export class AdminStatusController { constructor(private readonly health: HealthService) {} @Get() status() { return this.health.status(); } }

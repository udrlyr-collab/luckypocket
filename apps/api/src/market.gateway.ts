import { BadRequestException, OnModuleDestroy } from "@nestjs/common";
import { OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Redis } from "ioredis";
import jwt from "jsonwebtoken";
import type { Namespace, Socket } from "socket.io";
import { DatabaseService } from "./database.service.js";

@WebSocketGateway({ namespace: "/market", cors: { origin: allowedOrigins(), credentials: true } })
export class MarketGateway implements OnGatewayInit, OnModuleDestroy {
  @WebSocketServer()
  server!: Namespace;
  readonly #subscriber: Redis;

  constructor(private readonly database: DatabaseService) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL is required");
    this.#subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const raw = typeof client.handshake.auth?.token === "string" ? client.handshake.auth.token : client.handshake.headers.authorization;
      const token = raw?.startsWith("Bearer ") ? raw.slice(7) : raw;
      const secret = process.env.JWT_SECRET;
      if (!token || !secret || secret.length < 32) throw new Error("WS_AUTH_MISSING");
      const payload = jwt.verify(token, secret, { algorithms: ["HS256"], issuer: "market-dominion", audience: "market-dominion-web" });
      if (typeof payload === "string" || typeof payload.sub !== "string") throw new Error("WS_AUTH_INVALID");
      const user = await this.database.pool.query("SELECT id FROM users WHERE id=$1 AND is_active=true AND is_system=false", [payload.sub]);
      if (!user.rows[0]) throw new Error("WS_USER_INACTIVE");
      client.data.userId = payload.sub;
    } catch {
      client.emit("auth:error", { code: "UNAUTHORIZED" });
      client.disconnect(true);
    }
  }

  connectionCount(): number { return this.server?.sockets?.size ?? 0; }

  async afterInit(): Promise<void> {
    await this.#subscriber.subscribe("market:events");
    this.#subscriber.on("message", (_channel: string, raw: string) => {
      try {
        const event = JSON.parse(raw) as { eventType?: string; payload?: { stockId?: string } };
        const stockId = event.payload?.stockId;
        if (typeof stockId === "string") {
          const target = this.server.to(`stock:${stockId}`);
          for (const name of publicEventNames(event.eventType)) target.emit(name, event.payload);
        } else if (event.eventType === "market.regime_changed") {
          this.server.emit("market:snapshot", event.payload);
        }
      } catch {
        // Invalid internal messages are ignored and remain observable in Redis/server logs.
      }
    });
  }

  @SubscribeMessage("stock.subscribe")
  subscribeStock(client: Socket, stockId: unknown): { subscribed: string } {
    if (typeof stockId !== "string" || !/^[0-9a-f-]{36}$/i.test(stockId)) throw new BadRequestException("stockId가 올바르지 않습니다.");
    void client.join(`stock:${stockId}`);
    return { subscribed: stockId };
  }

  @SubscribeMessage("stock.unsubscribe")
  unsubscribeStock(client: Socket, stockId: unknown): { unsubscribed: string } {
    if (typeof stockId !== "string" || !/^[0-9a-f-]{36}$/i.test(stockId)) throw new BadRequestException("stockId가 올바르지 않습니다.");
    void client.leave(`stock:${stockId}`);
    return { unsubscribed: stockId };
  }

  publishQuote(symbol: string, payload: unknown): void {
    this.server.to(`quote:${symbol}`).emit("quote", payload);
  }

  async onModuleDestroy(): Promise<void> {
    await this.#subscriber.quit();
  }
}

function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((value) => value.trim()).filter(Boolean);
}

function publicEventNames(eventType: string | undefined): string[] {
  if (!eventType) return ["market:snapshot"];
  if (eventType === "trade.executed") return [eventType, "stock:trade", "stock:quote", "stock:orderbook", "stock:candle"];
  if (eventType.startsWith("order.")) return [eventType, "order:updated"];
  if (eventType.startsWith("position.")) return [eventType, "position:updated"];
  if (eventType.startsWith("mna.")) return [eventType, "mna:updated"];
  if (eventType.startsWith("strategy.")) return [eventType, "strategy:updated"];
  if (eventType.startsWith("dividend.") || eventType.startsWith("ipo.")) return [eventType, "company:event"];
  return [eventType];
}

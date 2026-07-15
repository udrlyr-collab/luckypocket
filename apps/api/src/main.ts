import "reflect-metadata";
import { Module, RequestMethod } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { MarketGateway } from "./market.gateway.js";
import { AuthController, AuthService } from "./auth.js";
import { DatabaseService } from "./database.service.js";
import { OrderController, OrderQueue, OrderService } from "./orders.js";
import { MarketController, MarketService } from "./markets.js";
import { PortfolioController, PortfolioService } from "./portfolio.js";
import { LeverageController, LeverageService } from "./leverage.js";
import { CompanyController, CompanyService } from "./companies.js";
import { MnaController, MnaService } from "./mna.js";
import { StrategyController, StrategyService } from "./strategies.js";
import { AdminController, AdminService } from "./admin.js";
import { AdminStatusController, HealthController, HealthService } from "./health.js";
import { LeaderboardController, MarketOverviewController, NewsController, NotificationController, ProfileController, PublicService, SettingsController } from "./public.js";
import { IpoController, IpoService } from "./ipo.js";

@Module({
  imports: [ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 120 }])],
  controllers: [HealthController, AdminStatusController, AuthController, OrderController, MarketController, MarketOverviewController, PortfolioController, LeverageController, CompanyController, MnaController, StrategyController, AdminController, NewsController, LeaderboardController, ProfileController, SettingsController, NotificationController, IpoController],
  providers: [DatabaseService, MarketGateway, HealthService, AuthService, OrderQueue, OrderService, MarketService, PortfolioService, LeverageService, CompanyService, MnaService, StrategyService, AdminService, PublicService, IpoService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class AppModule {}

const app = await NestFactory.create(AppModule, { cors: false });
app.use(helmet());
app.use((request: { headers: Record<string, string | string[] | undefined>; method: string; originalUrl: string; principal?: { userId: string }; requestId?: string }, response: { statusCode: number; setHeader(name: string, value: string): void; once(event: string, listener: () => void): void }, next: () => void) => {
  const supplied = request.headers["x-request-id"];
  const requestId = typeof supplied === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(supplied) ? supplied : randomUUID();
  const started = Date.now(); request.requestId = requestId; response.setHeader("X-Request-Id", requestId);
  response.once("finish", () => process.stdout.write(JSON.stringify({ level: "info", event: "http_request", request_id: requestId, user_id: request.principal?.userId ?? null, method: request.method, path: request.originalUrl.split("?")[0], status: response.statusCode, duration_ms: Date.now() - started }) + "\n"));
  next();
});
app.getHttpAdapter().getInstance().set("trust proxy", 1);
app.enableCors({ origin: allowedOrigins(), credentials: true, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] });
app.setGlobalPrefix("api", { exclude: [
  { path: "health", method: RequestMethod.GET }, { path: "health/db", method: RequestMethod.GET },
  { path: "health/redis", method: RequestMethod.GET }, { path: "health/market-engine", method: RequestMethod.GET },
] });
await app.listen(Number(process.env.PORT ?? 4000), "0.0.0.0");

function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((value) => value.trim()).filter(Boolean);
}

import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { config } from "./config.js";
import { db } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { bonusCodesRouter } from "./routes/bonusCodes.js";
import { gamesRouter } from "./routes/games.js";
import { logsRouter } from "./routes/logs.js";
import { meRouter } from "./routes/me.js";
import { profileRouter } from "./routes/profile.js";
import { rankingsRouter } from "./routes/rankings.js";
import { transferRouter } from "./routes/transfer.js";
import { adminRouter } from "./routes/admin.js";
import { bankruptcyRouter } from "./routes/bankruptcy.js";
import { serverNotificationsRouter } from "./routes/serverNotifications.js";
import { serverStatsRouter } from "./routes/serverStats.js";
import { mineRouter } from "./routes/mine.js";
import { stocksRouter } from "./routes/stocks.js";
import { initStockMarket, tickStockMarket } from "./services/stockService.js";

const app = express();
if (config.trustProxy) app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: config.isProduction
      ? {
          directives: {
            "script-src": ["'self'"],
            "style-src": ["'self'", "'unsafe-inline'"],
            "img-src": ["'self'", "data:"],
          },
        }
      : false,
  }),
);
app.use(
  cors({
    origin: config.isProduction ? config.clientUrl : ["http://localhost:5173", config.clientUrl],
  }),
);
app.use(express.json({ limit: "32kb" }));
app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use(
  "/api/bonus-code",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use(
  "/api/transfer",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use(
  "/api/mine/click",
  rateLimit({
    windowMs: 1000,
    limit: 8, // Allow slight burst but generally restrict fast clicking
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "조금 천천히 캐볼까요?" }
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "haengun-pocket" });
});
app.use("/api/auth", authRouter);
app.use("/api/bonus-code", bonusCodesRouter);
app.use("/api/me", meRouter);
app.use("/api/games", gamesRouter);
app.use("/api/logs", logsRouter);
app.use("/api/rankings", rankingsRouter);
app.use("/api/leaderboard", rankingsRouter);
app.use("/api/profile", profileRouter);
app.use("/api/transfer", transferRouter);
app.use("/api/admin", adminRouter);
app.use("/api/bankruptcy", bankruptcyRouter);
app.use("/api/server/notifications", serverNotificationsRouter);
app.use("/api/server/stats", serverStatsRouter);
app.use("/api/mine", mineRouter);
app.use("/api/stocks", stocksRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({ message: "요청한 API를 찾을 수 없어요." });
});

if (config.isProduction) {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.resolve(currentDir, "../dist");
  app.use(express.static(distPath, { maxAge: "1d", index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    return res.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  const status = Number(error.status) || 500;
  if (status >= 500) console.error(error);
  return res.status(status).json({
    message: status >= 500 ? "서버에서 문제가 발생했어요. 잠시 후 다시 시도해 주세요." : error.message,
  });
});

const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(`행운주머니 server listening on http://127.0.0.1:${config.port}`);
  
  // Initialize stock market
  try {
    initStockMarket(db);
    setInterval(() => tickStockMarket(db), 10000);
    console.log("주식 시장 틱 타이머(10초)가 시작되었습니다.");
  } catch (err) {
    console.error("주식 시장 초기화 실패:", err);
  }
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

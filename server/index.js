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
import { seasonsRouter } from "./routes/seasons.js";
import { initStockMarket, tickStockMarket } from "./services/stockService.js";
import { readClientAssetVersion } from "./services/clientVersionService.js";
import { runJackpotDraw } from "./services/jackpotService.js";

const app = express();
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(currentDir, "../dist");
const clientAssetVersion = readClientAssetVersion(path.join(distPath, "index.html"));
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
app.get("/api/version", (_req, res) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.json({ version: clientAssetVersion });
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
app.use("/api/seasons", seasonsRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({ message: "요청한 API를 찾을 수 없어요." });
});

if (config.isProduction) {
  app.use(express.static(distPath, { maxAge: "1d", index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
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

  // Initialize jackpot scheduler
  function scheduleNextJackpot() {
    const now = new Date();
    // next midnight KST
    // KST is UTC+9, so midnight KST is 15:00 UTC.
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const nextMidnightKst = new Date(kstNow);
    nextMidnightKst.setUTCHours(24, 0, 0, 0); // Next day 00:00:00
    
    const msUntilMidnight = nextMidnightKst.getTime() - kstNow.getTime();
    console.log(`다음 잭팟 추첨까지 ${Math.floor(msUntilMidnight / 1000 / 60)}분 남았습니다.`);
    
    setTimeout(() => {
      console.log("자정 잭팟 추첨을 시작합니다...");
      try {
        const result = runJackpotDraw(db);
        console.log("잭팟 추첨 결과:", result);
      } catch (e) {
        console.error("잭팟 추첨 오류:", e);
      }
      scheduleNextJackpot(); // Schedule the next one
    }, msUntilMidnight);
  }
  scheduleNextJackpot();
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

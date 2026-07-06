import { Router } from "express";
import { db, publicUser } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { recordAssetEvent } from "../services/assetEventService.js";
import { findUserByNickname, validateNickname } from "../services/nicknameService.js";
import { delistStock } from "../services/stockService.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);
adminRouter.use((req, res, next) => {
  if (req.user.username !== "admin" && !req.user.isAdmin) {
    return res.status(403).json({ message: "관리자 권한이 필요해요." });
  }
  return next();
});

adminRouter.get("/users/search", (req, res) => {
  const query = String(req.query.q || "").trim();
  if (!query) return res.json({ users: [] });
  const pattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const users = db
    .prepare(
      `SELECT * FROM users
       WHERE username LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR nickname LIKE ? ESCAPE '\\' COLLATE NOCASE
       ORDER BY id ASC
       LIMIT 20`,
    )
    .all(pattern, pattern)
    .map(publicUser);
  return res.json({ users });
});

adminRouter.post("/users/:userId/nickname", (req, res, next) => {
  try {
    const validation = validateNickname(req.body.newNickname);
    if (validation.error) {
      return res.status(400).json({
        message: validation.error === "사용할 수 없는 단어가 포함되어 있어요."
          ? validation.error
          : `${validation.error} 다른 닉네임을 입력해주세요.`,
      });
    }
    const targetId = Number(req.params.userId);
    if (!Number.isSafeInteger(targetId) || targetId < 1) {
      return res.status(400).json({ message: "대상 사용자를 확인해주세요." });
    }

    const forceChange = db.transaction(() => {
      const admin = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      if (!admin || admin.username !== "admin") {
        const error = new Error("관리자 권한이 필요해요.");
        error.status = 403;
        throw error;
      }
      const target = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
      if (!target) {
        const error = new Error("대상 사용자를 찾을 수 없어요.");
        error.status = 404;
        throw error;
      }
      const existing = findUserByNickname(db, validation.nickname);
      if (existing) {
        const error = new Error("이미 사용 중인 닉네임이에요.");
        error.status = 409;
        throw error;
      }
      db.prepare(
        `UPDATE users
         SET nickname = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      ).run(validation.nickname, target.id);
      const log = db
        .prepare(
          `INSERT INTO admin_logs
           (admin_user_id, target_user_id, action_type, before_value, after_value)
           VALUES (?, ?, 'force_nickname_change', ?, ?)`,
        )
        .run(admin.id, target.id, target.nickname, validation.nickname);
      recordAssetEvent({
        userId: target.id,
        eventType: "admin_nickname_change",
        amount: 0,
        balanceBefore: target.balance,
        balanceAfter: target.balance,
        sourceType: "admin_log",
        sourceId: log.lastInsertRowid,
        detail: {
          oldNickname: target.nickname,
          newNickname: validation.nickname,
          label: "관리자 닉네임 변경",
        },
      });
      return db.prepare("SELECT * FROM users WHERE id = ?").get(target.id);
    });

    try {
      return res.json({
        message: "대상 사용자의 닉네임을 변경했어요.",
        user: publicUser(forceChange()),
      });
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({ message: "이미 사용 중인 닉네임이에요." });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

adminRouter.post("/users/:userId/balance", (req, res, next) => {
  try {
    const targetId = Number(req.params.userId);
    const newBalance = Number(req.body.balance);
    if (!Number.isSafeInteger(targetId) || targetId < 1) {
      return res.status(400).json({ message: "대상 사용자를 확인해주세요." });
    }
    if (isNaN(newBalance) || newBalance < 0) {
      return res.status(400).json({ message: "올바른 잔액을 입력해주세요." });
    }

    const forceChange = db.transaction(() => {
      const admin = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      if (!admin || admin.username !== "admin") {
        const error = new Error("관리자 권한이 필요해요.");
        error.status = 403;
        throw error;
      }
      const target = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
      if (!target) {
        const error = new Error("대상 사용자를 찾을 수 없어요.");
        error.status = 404;
        throw error;
      }
      
      db.prepare(
        `UPDATE users
         SET balance = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      ).run(newBalance, target.id);
      
      const log = db
        .prepare(
          `INSERT INTO admin_logs
           (admin_user_id, target_user_id, action_type, before_value, after_value)
           VALUES (?, ?, 'force_balance_change', ?, ?)`
        )
        .run(admin.id, target.id, target.balance.toString(), newBalance.toString());
        
      recordAssetEvent({
        userId: target.id,
        eventType: "admin_balance_adjustment",
        amount: newBalance - target.balance,
        balanceBefore: target.balance,
        balanceAfter: newBalance,
        sourceType: "admin_log",
        sourceId: log.lastInsertRowid,
        detail: {
          label: "관리자 자산 조절"
        },
      });
      return db.prepare("SELECT * FROM users WHERE id = ?").get(target.id);
    });

    return res.json({
      message: "대상 사용자의 자산을 변경했어요.",
      user: publicUser(forceChange()),
    });
  } catch (error) {
    return next(error);
  }
});

adminRouter.post("/stocks/:id/acquire", (req, res, next) => {
  try {
    const stockId = Number(req.params.id);
    if (!Number.isSafeInteger(stockId) || stockId < 1) return res.status(400).json({ message: "잘못된 주식 ID입니다." });

    db.transaction(() => {
      const admin = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      if (!admin || admin.username !== "admin") throw new Error("관리자 권한이 필요해요.");

      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock || stock.status === 'delisted') throw new Error("존재하지 않거나 상장폐지된 종목입니다.");
      if (stock.status === 'acquired' || stock.is_etf) throw new Error("이미 인수된 종목입니다.");

      db.prepare(`
        UPDATE stocks 
        SET status = 'acquired', is_etf = 1, etf_tracking_type = 'owner_asset', 
            owner_user_id = ?, owner_nickname_snapshot = ?,
            etf_base_owner_asset = ?, etf_last_tracked_owner_asset = ?
        WHERE id = ?
      `).run(admin.id, admin.nickname, admin.balance, admin.balance, stock.id);

      db.prepare(
        `INSERT INTO admin_logs (admin_user_id, target_user_id, action_type, before_value, after_value)
         VALUES (?, ?, 'force_stock_acquire', ?, ?)`
      ).run(admin.id, admin.id, stock.status, 'acquired');
    })();
    return res.json({ message: "관리자 권한으로 종목을 강제 인수했습니다." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

adminRouter.post("/stocks/:id/revert", (req, res, next) => {
  try {
    const stockId = Number(req.params.id);
    if (!Number.isSafeInteger(stockId) || stockId < 1) return res.status(400).json({ message: "잘못된 주식 ID입니다." });

    db.transaction(() => {
      const admin = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      if (!admin || admin.username !== "admin") throw new Error("관리자 권한이 필요해요.");

      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock || stock.status !== 'acquired' || !stock.is_etf) throw new Error("ETF 상태가 아닙니다.");

      db.prepare(`
        UPDATE stocks 
        SET status = 'listed', is_etf = 0, etf_tracking_type = NULL, 
            owner_user_id = NULL, owner_nickname_snapshot = NULL,
            etf_base_owner_asset = 0, etf_last_tracked_owner_asset = 0
        WHERE id = ?
      `).run(stock.id);

      db.prepare(
        `INSERT INTO admin_logs (admin_user_id, target_user_id, action_type, before_value, after_value)
         VALUES (?, ?, 'force_stock_revert', ?, ?)`
      ).run(admin.id, admin.id, stock.status, 'listed');
    })();
    return res.json({ message: "종목을 다시 일반 주식으로 되돌렸습니다." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

adminRouter.post("/stocks/:id/delist", (req, res, next) => {
  try {
    const stockId = Number(req.params.id);
    if (!Number.isSafeInteger(stockId) || stockId < 1) return res.status(400).json({ message: "잘못된 주식 ID입니다." });

    db.transaction(() => {
      const admin = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      if (!admin || admin.username !== "admin") throw new Error("관리자 권한이 필요해요.");

      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock || stock.status === 'delisted') throw new Error("이미 상장폐지된 종목입니다.");

      delistStock(db, stock);

      db.prepare(
        `INSERT INTO admin_logs (admin_user_id, target_user_id, action_type, before_value, after_value)
         VALUES (?, ?, 'force_stock_delist', ?, ?)`
      ).run(admin.id, admin.id, stock.status, 'delisted');
    })();
    return res.json({ message: "종목을 강제 상장폐지했습니다." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

adminRouter.post("/impersonate/:id", async (req, res) => {
  const targetId = Number(req.params.id);
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
  if (!target) return res.status(404).json({ message: "유저를 찾을 수 없어요." });

  const { signToken } = await import("../middleware/auth.js");
  const token = signToken(target.id, true);
  target.isAdmin = true;
  res.json({ token, user: publicUser(target) });
});

adminRouter.post("/users/:id/reset", (req, res) => {
  const targetId = Number(req.params.id);
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
  if (!target) return res.status(404).json({ message: "유저를 찾을 수 없어요." });

  try {
    db.transaction(() => {
      db.prepare("DELETE FROM game_logs WHERE user_id = ?").run(targetId);
      db.prepare("DELETE FROM game_sessions WHERE user_id = ?").run(targetId);
      db.prepare("DELETE FROM asset_events WHERE user_id = ?").run(targetId);
      db.prepare("DELETE FROM transfer_logs WHERE sender_user_id = ? OR receiver_user_id = ?").run(targetId, targetId);
      db.prepare("DELETE FROM stock_holdings WHERE user_id = ?").run(targetId);
      db.prepare("DELETE FROM stock_positions WHERE user_id = ?").run(targetId);
      
      const etfs = db.prepare("SELECT * FROM stocks WHERE owner_user_id = ?").all(targetId);
      for (const etf of etfs) {
        delistStock(db, etf);
      }

      db.prepare(`
        UPDATE users SET 
          balance = 5000000, 
          initial_balance = 5000000,
          highest_balance = 5000000,
          total_profit = 0,
          total_bet = 0,
          total_win = 0,
          total_loss = 0,
          bankruptcy_count = 0,
          mine_click_count = 0,
          mine_total_earned = 0
        WHERE id = ?
      `).run(targetId);
      
      recordAssetEvent(targetId, "admin_force_reset", 5000000 - target.balance, target.balance, 5000000);
    })();

    const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
    return res.json({ message: "해당 유저의 모든 기록이 초기화되었습니다.", user: publicUser(updated) });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

adminRouter.post("/stocks/market/close", (req, res) => {
  db.prepare("UPDATE system_config SET value = 'false' WHERE key = 'market_open'").run();
  return res.json({ message: "주식장을 닫았습니다." });
});

adminRouter.post("/stocks/market/open", (req, res) => {
  db.prepare("UPDATE system_config SET value = 'true' WHERE key = 'market_open'").run();
  return res.json({ message: "주식장을 열었습니다." });
});

adminRouter.post("/stocks/:id/suspend", (req, res) => {
  const stockId = Number(req.params.id);
  const stock = db.prepare("SELECT * FROM stocks WHERE id = ? AND status != 'delisted'").get(stockId);
  if (!stock) return res.status(404).json({ message: "해당 주식을 찾을 수 없거나 상장폐지되었습니다." });
  
  db.prepare("UPDATE stocks SET is_trading_suspended = 1 WHERE id = ?").run(stockId);
  return res.json({ message: "해당 주식의 거래를 정지했습니다." });
});

adminRouter.post("/stocks/:id/resume", (req, res) => {
  const stockId = Number(req.params.id);
  const stock = db.prepare("SELECT * FROM stocks WHERE id = ? AND status != 'delisted'").get(stockId);
  if (!stock) return res.status(404).json({ message: "해당 주식을 찾을 수 없거나 상장폐지되었습니다." });
  
  db.prepare("UPDATE stocks SET is_trading_suspended = 0 WHERE id = ?").run(stockId);
  return res.json({ message: "해당 주식의 거래 정지를 해제했습니다." });
});

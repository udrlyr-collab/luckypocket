import { Router } from "express";
import { db, publicUser } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { recordAssetEvent } from "../services/assetEventService.js";
import { findUserByNickname, validateNickname } from "../services/nicknameService.js";
import { delistStock, manuallyAdjustStockPrice } from "../services/stockService.js";
import { calculateUserTotalEvaluatedAsset } from "../services/portfolioValuationService.js";
import { achievementCount } from "../services/achievementService.js";
import { parseAdminResetTargets } from "../services/adminResetPolicy.js";
import {
  parseAdminUserIds,
  resetAdminUsers,
  setAdminUsersBalance,
} from "../services/adminUserManagementService.js";
import {
  isStockMarketOpen,
  setStockMarketOpen,
} from "../services/marketStateService.js";
import { endCurrentSeason } from "../services/seasonService.js";
import {
  getJackpotEntryStats,
  getJackpotPool,
  setJackpotPool,
} from "../services/jackpotService.js";
import { formatWon } from "../utils/formatWon.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);
function hasAdminPrivilege(user) {
  return user?.username === "admin" || user?.isAdmin === true;
}

function publicAdminUser(user) {
  const valuation = calculateUserTotalEvaluatedAsset(db, user.id);
  return {
    ...publicUser(user),
    jackpotTickets: Number(user.jackpot_tickets || 0),
    totalEvaluatedAsset: Math.floor(Number(valuation.totalEvaluatedAsset || 0)),
    achievementCount: achievementCount(db, user.id),
  };
}

adminRouter.use((req, res, next) => {
  if (!hasAdminPrivilege(req.user)) {
    return res.status(403).json({ message: "관리자 권한이 필요해요." });
  }
  return next();
});

adminRouter.get("/users/search", (req, res) => {
  const query = String(req.query.q || "").trim();
  const requestedPage = Number(req.query.page || 1);
  const requestedPageSize = Number(req.query.pageSize || 50);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? requestedPage
    : 1;
  const pageSize = Number.isSafeInteger(requestedPageSize)
    ? Math.min(100, Math.max(10, requestedPageSize))
    : 50;
  const offset = (page - 1) * pageSize;

  let users;
  let total;
  if (query) {
    const pattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    total = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM users
         WHERE username LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR nickname LIKE ? ESCAPE '\\' COLLATE NOCASE`,
      )
      .get(pattern, pattern).count;
    users = db
      .prepare(
        `SELECT * FROM users
         WHERE username LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR nickname LIKE ? ESCAPE '\\' COLLATE NOCASE
         ORDER BY id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(pattern, pattern, pageSize, offset);
  } else {
    total = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    users = db
      .prepare("SELECT * FROM users ORDER BY id ASC LIMIT ? OFFSET ?")
      .all(pageSize, offset);
  }

  return res.json({
    users: users.map(publicAdminUser),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

adminRouter.post("/users/bulk/balance", (req, res) => {
  try {
    const userIds = parseAdminUserIds(req.body?.userIds);
    const newBalance = Number(req.body?.balance);
    if (!Number.isSafeInteger(newBalance) || newBalance < 0) {
      return res.status(400).json({ message: "올바른 정수 잔액을 입력해 주세요." });
    }
    const users = setAdminUsersBalance(db, {
      adminUserId: req.user.id,
      userIds,
      newBalance,
    });
    return res.json({
      message: `${users.length}명의 자산을 변경했어요.`,
      users: users.map(publicAdminUser),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

adminRouter.post("/users/bulk/reset", (req, res) => {
  try {
    const userIds = parseAdminUserIds(req.body?.userIds);
    const resetTargets = parseAdminResetTargets(req.body?.targets);
    const users = resetAdminUsers(db, {
      adminUserId: req.user.id,
      userIds,
      resetTargets,
    });
    return res.json({
      message: `${users.length}명에게 선택한 ${resetTargets.length}개 초기화 항목을 적용했어요.`,
      resetTargets,
      users: users.map(publicAdminUser),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

adminRouter.post("/seasons/end-current", (req, res, next) => {
  if (req.user.username !== "admin") {
    return res.status(403).json({ message: "admin 계정만 시즌을 종료할 수 있어요." });
  }
  try {
    const result = endCurrentSeason(db, req.user);
    return res.json({
      message: `시즌 ${result.endedSeason.season_number}이 종료되고 시즌 ${result.newSeason.season_number}이 시작되었어요.`,
      endedSeason: {
        id: result.endedSeason.id,
        seasonNumber: result.endedSeason.season_number,
      },
      newSeason: {
        id: result.newSeason.id,
        seasonNumber: result.newSeason.season_number,
      },
      top3: result.top3,
      userCount: result.userCount,
    });
  } catch (error) {
    return next(error);
  }
});

adminRouter.get("/jackpot", (_req, res) => {
  const date = db.prepare("SELECT date('now', '+9 hours') AS value").get().value;
  return res.json({
    jackpotPool: getJackpotPool(db),
    ...getJackpotEntryStats(db, date),
  });
});

adminRouter.post("/jackpot", (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    return res.status(400).json({ message: "잭팟 금액은 0원 이상의 정수로 입력해 주세요." });
  }
  const jackpotPool = setJackpotPool(db, amount);
  const date = db.prepare("SELECT date('now', '+9 hours') AS value").get().value;
  return res.json({
    message: `오늘의 잭팟 금액을 ${formatWon(jackpotPool)}으로 설정했어요.`,
    jackpotPool,
    ...getJackpotEntryStats(db, date),
  });
});

adminRouter.post("/jackpot/reset", (_req, res) => {
  const jackpotPool = setJackpotPool(db, 0);
  const date = db.prepare("SELECT date('now', '+9 hours') AS value").get().value;
  return res.json({
    message: "오늘의 잭팟 금액을 0원으로 초기화했어요.",
    jackpotPool,
    ...getJackpotEntryStats(db, date),
  });
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
      if (!admin || !hasAdminPrivilege(req.user)) {
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
        user: publicAdminUser(forceChange()),
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
    if (!Number.isSafeInteger(newBalance) || newBalance < 0) {
      return res.status(400).json({ message: "올바른 정수 잔액을 입력해 주세요." });
    }

    const [updated] = setAdminUsersBalance(db, {
      adminUserId: req.user.id,
      userIds: [targetId],
      newBalance,
    });

    return res.json({
      message: "대상 사용자의 자산을 변경했어요.",
      user: publicAdminUser(updated),
    });
  } catch (error) {
    return next(error);
  }
});

adminRouter.patch("/users/:userId/override", (req, res, next) => {
  try {
    const targetId = Number(req.params.userId);
    if (!Number.isSafeInteger(targetId) || targetId < 1) {
      return res.status(400).json({ message: "대상 사용자를 확인해주세요." });
    }

    const hasBalance = Object.prototype.hasOwnProperty.call(req.body || {}, "balance");
    const hasNickname = Object.prototype.hasOwnProperty.call(req.body || {}, "nickname");
    const hasTickets = Object.prototype.hasOwnProperty.call(req.body || {}, "luckTicketCount");
    if (!hasBalance && !hasNickname && !hasTickets) {
      return res.status(400).json({ message: "변경할 항목을 입력해 주세요." });
    }

    const nextBalance = hasBalance ? Number(req.body.balance) : null;
    const nextTickets = hasTickets ? Number(req.body.luckTicketCount) : null;
    if (hasBalance && (!Number.isSafeInteger(nextBalance) || nextBalance < 0)) {
      return res.status(400).json({ message: "올바른 정수 잔액을 입력해 주세요." });
    }
    if (hasTickets && (!Number.isSafeInteger(nextTickets) || nextTickets < 0)) {
      return res.status(400).json({ message: "행운권 보유량은 0 이상의 정수로 입력해 주세요." });
    }

    let nicknameValidation = null;
    if (hasNickname && String(req.body.nickname || "").trim()) {
      nicknameValidation = validateNickname(req.body.nickname);
      if (nicknameValidation.error) {
        return res.status(400).json({
          message: nicknameValidation.error === "사용할 수 없는 단어가 포함되어 있어요."
            ? nicknameValidation.error
            : `${nicknameValidation.error} 다른 닉네임을 입력해주세요.`,
        });
      }
    }

    const updated = db.transaction(() => {
      const admin = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      if (!admin || !hasAdminPrivilege(req.user)) {
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

      if (nicknameValidation) {
        const existing = findUserByNickname(db, nicknameValidation.nickname);
        if (existing && existing.id !== target.id) {
          const error = new Error("이미 사용 중인 닉네임이에요.");
          error.status = 409;
          throw error;
        }
        if (nicknameValidation.nickname !== target.nickname) {
          db.prepare(
            `UPDATE users
             SET nickname = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?`,
          ).run(nicknameValidation.nickname, target.id);
          const log = db.prepare(
            `INSERT INTO admin_logs
             (admin_user_id, target_user_id, action_type, before_value, after_value)
             VALUES (?, ?, 'force_nickname_change', ?, ?)`,
          ).run(admin.id, target.id, target.nickname, nicknameValidation.nickname);
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
              newNickname: nicknameValidation.nickname,
              label: "관리자 닉네임 변경",
            },
          });
        }
      }

      if (hasBalance && nextBalance !== target.balance) {
        db.prepare(
          `UPDATE users
           SET balance = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        ).run(nextBalance, target.id);
        const log = db.prepare(
          `INSERT INTO admin_logs
           (admin_user_id, target_user_id, action_type, before_value, after_value)
           VALUES (?, ?, 'force_balance_change', ?, ?)`,
        ).run(admin.id, target.id, String(target.balance), String(nextBalance));
        recordAssetEvent({
          userId: target.id,
          eventType: "admin_balance_adjustment",
          amount: nextBalance - target.balance,
          balanceBefore: target.balance,
          balanceAfter: nextBalance,
          sourceType: "admin_log",
          sourceId: log.lastInsertRowid,
          detail: { label: "관리자 자산 조절" },
        });
      }

      if (hasTickets && nextTickets !== Number(target.jackpot_tickets || 0)) {
        db.prepare(
          `UPDATE users
           SET jackpot_tickets = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        ).run(nextTickets, target.id);
        db.prepare(
          `INSERT INTO admin_logs
           (admin_user_id, target_user_id, action_type, before_value, after_value)
           VALUES (?, ?, 'force_jackpot_tickets_change', ?, ?)`,
        ).run(
          admin.id,
          target.id,
          String(target.jackpot_tickets || 0),
          String(nextTickets),
        );
      }

      return db.prepare("SELECT * FROM users WHERE id = ?").get(target.id);
    })();

    return res.json({
      message: "개인 강제 설정을 저장했어요.",
      user: publicAdminUser(updated),
    });
  } catch (error) {
    return next(error);
  }
});

adminRouter.post("/stocks/:stockId/manual-adjust", (req, res) => {
  try {
    const stockId = Number(req.params.stockId);
    if (!Number.isSafeInteger(stockId) || stockId < 1) {
      return res.status(400).json({ message: "조정할 종목을 확인해 주세요." });
    }
    const stock = manuallyAdjustStockPrice(db, {
      adminUserId: req.user.id,
      stockId,
      mode: req.body?.mode,
      direction: req.body?.direction,
      value: req.body?.value,
      reason: req.body?.reason,
    });

    return res.json({
      message: `${stock.name} 주가를 ${formatWon(stock.current_price)}으로 조정했어요.`,
      stock,
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

adminRouter.post("/stocks/:id/acquire", (req, res, next) => {
  try {
    const stockId = Number(req.params.id);
    if (!Number.isSafeInteger(stockId) || stockId < 1) return res.status(400).json({ message: "잘못된 주식 ID입니다." });

    db.transaction(() => {
      const admin = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      if (!admin || !hasAdminPrivilege(req.user)) throw new Error("관리자 권한이 필요해요.");

      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock || stock.status === 'delisted') throw new Error("존재하지 않거나 상장폐지된 종목입니다.");
      if (stock.status === 'acquired' || stock.is_etf) throw new Error("이미 인수된 종목입니다.");
      const ownerAsset = Math.max(
        calculateUserTotalEvaluatedAsset(db, admin.id).totalEvaluatedAsset,
        1,
      );

      db.prepare(`
        UPDATE stocks 
        SET status = 'acquired', is_etf = 1, etf_tracking_type = 'owner_asset', 
            owner_user_id = ?, owner_nickname_snapshot = ?,
            etf_base_price = current_price,
            etf_base_owner_asset = ?, etf_last_tracked_owner_asset = ?
        WHERE id = ?
      `).run(admin.id, admin.nickname, ownerAsset, ownerAsset, stock.id);

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
      if (!admin || !hasAdminPrivilege(req.user)) throw new Error("관리자 권한이 필요해요.");

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
      if (!admin || !hasAdminPrivilege(req.user)) throw new Error("관리자 권한이 필요해요.");

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
  if (!Number.isSafeInteger(targetId) || targetId < 1) {
    return res.status(400).json({ message: "대상 사용자를 확인해 주세요." });
  }
  try {
    const resetTargets = parseAdminResetTargets(req.body?.targets);
    const [updated] = resetAdminUsers(db, {
      adminUserId: req.user.id,
      userIds: [targetId],
      resetTargets,
    });
    return res.json({
      message: `선택한 ${resetTargets.length}개 항목을 초기화했습니다.`,
      resetTargets,
      user: publicAdminUser(updated),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

adminRouter.get("/stocks/market/status", (_req, res) => {
  return res.json({ marketOpen: isStockMarketOpen(db) });
});

adminRouter.post("/stocks/market/close", (_req, res) => {
  setStockMarketOpen(db, false);
  return res.json({ message: "주식장을 닫았습니다.", marketOpen: false });
});

adminRouter.post("/stocks/market/open", (_req, res) => {
  setStockMarketOpen(db, true);
  return res.json({ message: "주식장을 열었습니다.", marketOpen: true });
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

adminRouter.post("/stocks/:id/blue-chip", (req, res) => {
  const stockId = Number(req.params.id);
  const stock = db.prepare("SELECT * FROM stocks WHERE id = ? AND status != 'delisted'").get(stockId);
  const dayOpenPrice = stock
    ? Math.max(1, Math.floor(Number(stock.current_price) || 1))
    : 1;
  const dailyHighLimitPrice = Math.floor(dayOpenPrice * 1.15);
  const dailyLowLimitPrice = Math.max(1, Math.floor(dayOpenPrice * 0.87));
  if (!stock) return res.status(404).json({ message: "해당 주식을 찾을 수 없거나 상장폐지되었습니다." });
  
  db.prepare(`
    UPDATE stocks 
    SET is_bluechip = 1, 
        blue_chip_selected_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 
        blue_chip_selected_by_user_id = ?,
        blue_chip_cancelled_at = NULL,
        blue_chip_day_open_price = ?,
        blue_chip_day_started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        blue_chip_daily_high_limit_price = ?,
        blue_chip_daily_low_limit_price = ?
    WHERE id = ?
  `).run(
    req.user.id,
    dayOpenPrice,
    dailyHighLimitPrice,
    dailyLowLimitPrice,
    stockId,
  );

  db.prepare(`
    INSERT INTO stock_events (stock_id, event_type, title, message)
    VALUES (?, ?, ?, ?)
  `).run(
    stockId,
    "blue_chip_selected",
    "우량주 선정",
    `${stock.name}이 우량주로 선정됐어요. 24시간 등락 제한은 -13% ~ +15%입니다.`,
  );
  
  return res.json({ message: "해당 종목을 우량주로 선정했습니다." });
});

adminRouter.delete("/stocks/:id/blue-chip", (req, res) => {
  const stockId = Number(req.params.id);
  const stock = db.prepare("SELECT * FROM stocks WHERE id = ? AND status != 'delisted'").get(stockId);
  if (!stock) return res.status(404).json({ message: "해당 주식을 찾을 수 없거나 상장폐지되었습니다." });
  
  db.prepare(`
    UPDATE stocks 
    SET is_bluechip = 0, 
        blue_chip_cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') 
    WHERE id = ?
  `).run(stockId);

  db.prepare(`
    INSERT INTO stock_events (stock_id, event_type, title, message)
    VALUES (?, ?, ?, ?)
  `).run(
    stockId,
    "blue_chip_cancelled",
    "우량주 취소",
    `${stock.name}의 우량주 지정이 취소됐어요.`,
  );
  
  return res.json({ message: "해당 종목의 우량주 지정을 취소했습니다." });
});

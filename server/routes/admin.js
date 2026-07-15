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
  buildSeasonRewardPreview,
  checkSeasonRewardConsistency,
  ensureSeasonRewardJob,
  getSeasonRewardJob,
  runSeasonRewardJob,
} from "../services/seasonRewardService.js";
import { rebuildUserAssetSnapshots } from "../services/assetSnapshotService.js";
import {
  catchUpMissingEtfInterest,
  getEtfInterestMissingSummary,
  settleCurrentEtfHourlyInterest,
} from "../services/etfInterestService.js";
import {
  getJackpotEntryStats,
  getJackpotPool,
  setJackpotPool,
  runJackpotDraw,
} from "../services/jackpotService.js";
import {
  getAdminDashboardSummary,
  getLatestEconomyAudit,
  runConsistencyCheck,
  runEconomyAudit,
} from "../services/economyAuditService.js";
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
    assetValuationComplete: valuation.valuationComplete !== false,
    assetValuationErrors: valuation.valuationErrors || [],
    achievementCount: achievementCount(db, user.id),
  };
}

function recordAdminSystemAction(adminUserId, actionType, detail = {}) {
  db.prepare(`
    INSERT INTO admin_logs
      (admin_user_id, target_user_id, action_type, before_value, after_value, reason)
    VALUES (?, ?, ?, NULL, ?, ?)
  `).run(
    adminUserId,
    adminUserId,
    actionType,
    JSON.stringify(detail),
    String(detail.reason || "관리자 시스템 작업").slice(0, 500),
  );
}

adminRouter.use((req, res, next) => {
  if (!hasAdminPrivilege(req.user)) {
    return res.status(403).json({ message: "관리자 권한이 필요해요." });
  }
  return next();
});

adminRouter.get("/dashboard/summary", (_req, res) => {
  return res.json(getAdminDashboardSummary(db));
});

adminRouter.get("/seasons/reward-preview", (_req, res, next) => {
  try {
    return res.json(buildSeasonRewardPreview(db));
  } catch (error) {
    return next(error);
  }
});

adminRouter.post("/seasons/rewards/prepare", (req, res, next) => {
  try {
    const job = ensureSeasonRewardJob(db, { adminUserId: req.user.id });
    recordAdminSystemAction(req.user.id, "season_reward_preview", {
      jobId: job.id,
      seasonId: job.season_id,
      reason: "시즌 ETF 보상 매핑 확정",
    });
    return res.json(job);
  } catch (error) {
    return next(error);
  }
});

adminRouter.post("/seasons/rewards/:jobId/run", (req, res, next) => {
  try {
    const job = getSeasonRewardJob(db, Number(req.params.jobId));
    if (!job) return res.status(404).json({ message: "시즌 보상 작업을 찾을 수 없습니다." });
    const season = db.prepare("SELECT status FROM seasons WHERE id = ?").get(job.season_id);
    if (season?.status !== "ended") {
      return res.status(409).json({ message: "시즌 종료 트랜잭션 안에서만 최초 보상을 실행할 수 있습니다." });
    }
    const result = runSeasonRewardJob(db, job.id);
    recordAdminSystemAction(req.user.id, "season_reward_run", {
      jobId: job.id,
      seasonId: job.season_id,
      status: result.status,
      reason: "시즌 ETF 보상 실행",
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

adminRouter.post("/seasons/rewards/:jobId/retry", (req, res, next) => {
  try {
    const job = getSeasonRewardJob(db, Number(req.params.jobId));
    if (!job) return res.status(404).json({ message: "시즌 보상 작업을 찾을 수 없습니다." });
    const result = runSeasonRewardJob(db, job.id);
    recordAdminSystemAction(req.user.id, "season_reward_retry", {
      jobId: job.id,
      seasonId: job.season_id,
      status: result.status,
      reason: "실패한 시즌 ETF 보상 재시도",
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

adminRouter.get("/seasons/rewards/:jobId/consistency", (req, res, next) => {
  try {
    return res.json(checkSeasonRewardConsistency(db, Number(req.params.jobId)));
  } catch (error) {
    return next(error);
  }
});

adminRouter.post("/assets/snapshots/rebuild", (req, res, next) => {
  try {
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map(Number) : null;
    const result = rebuildUserAssetSnapshots(db, { userIds, apply: true });
    recordAdminSystemAction(req.user.id, "asset_snapshot_rebuilt", {
      valuationCycleId: result.valuationCycleId,
      userCount: result.userCount,
      incompleteCount: result.incompleteCount,
      requestedUserIds: userIds,
      reason: "총평가금액 스냅샷 재계산",
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

adminRouter.post("/etf-interest/settle-current", (req, res, next) => {
  try {
    const result = settleCurrentEtfHourlyInterest(db);
    recordAdminSystemAction(req.user.id, "etf_interest_settle_current", {
      hourKey: result.hourKey,
      eligibleUserCount: result.eligibleUserCount,
      paidCount: result.results.length,
      reason: "현재 시간 ETF 이자 정산",
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

adminRouter.get("/etf-interest/missing", (_req, res, next) => {
  try {
    return res.json(getEtfInterestMissingSummary(db));
  } catch (error) {
    return next(error);
  }
});

adminRouter.post("/etf-interest/catch-up", (req, res, next) => {
  try {
    const result = catchUpMissingEtfInterest(db, { maxHours: req.body?.maxHours || 24 });
    recordAdminSystemAction(req.user.id, "etf_interest_catch_up", {
      maxHours: result.maxHours,
      paidCount: result.paid.length,
      skippedCount: result.skipped.length,
      reason: "누락 ETF 이자 보정",
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

adminRouter.get("/economy/audit", (req, res) => {
  const latest = getLatestEconomyAudit(db) || runEconomyAudit(db, req.user.id);
  return res.json(latest);
});

adminRouter.post("/economy/audit/run", (req, res) => {
  return res.json(runEconomyAudit(db, req.user.id));
});

adminRouter.post("/economy/consistency-check", (req, res) => {
  return res.json(runConsistencyCheck(db, req.user.id));
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
    recordAdminSystemAction(req.user.id, "season_end_with_etf_rewards", {
      endedSeasonId: result.endedSeason.id,
      newSeasonId: result.newSeason.id,
      rewardJobId: result.seasonRewardJob?.id || null,
      reason: "시즌 종료 및 ETF 보상 실행",
    });
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

adminRouter.post("/jackpot/draw", (req, res) => {
  if (req.user.username !== "admin") {
    return res.status(403).json({ message: "관리자만 사용할 수 있어요." });
  }

  try {
    const result = runJackpotDraw(db);
    if (!result.success) {
      return res.status(400).json({ message: `잭팟 추첨에 실패했어요: ${result.reason}` });
    }
    const date = db.prepare("SELECT date('now', '+9 hours') AS value").get().value;
    return res.json({
      message: `잭팟 추첨을 완료했어요! 당첨된 금액은 ${formatWon(result.pool)}입니다.`,
      jackpotPool: 0,
      ...getJackpotEntryStats(db, date),
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
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
    if (req.user.username !== "admin") {
      return res.status(403).json({ message: "관리자만 사용할 수 있어요." });
    }
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
      targetPrice: req.body?.targetPrice !== undefined ? Number(req.body.targetPrice) : undefined,
      reason: req.body?.reason,
      newsTitle: req.body?.newsTitle,
      newsContent: req.body?.newsContent,
      publishNews: req.body?.publishNews !== undefined ? Boolean(req.body.publishNews) : true,
    });

    return res.json({
      message: `${stock.name} 주가를 ${formatWon(stock.current_price)}으로 조정했어요.`,
      stock,
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

adminRouter.patch("/stocks/:stockId/profile", (req, res) => {
  try {
    if (req.user.username !== "admin") {
      return res.status(403).json({ message: "관리자만 사용할 수 있어요." });
    }
    const stockId = Number(req.params.stockId);
    const name = String(req.body?.name || "").trim().replace(/\s+/g, " ");
    const sector = String(req.body?.sector || "").trim().replace(/\s+/g, " ");
    const reason = String(req.body?.reason || "관리자 회사 정보 변경").trim().slice(0, 120);
    if (!Number.isSafeInteger(stockId) || stockId < 1) throw new Error("종목을 확인해 주세요.");
    if ([...name].length < 2 || [...name].length > 30) throw new Error("회사명은 2자 이상 30자 이하로 입력해 주세요.");
    if ([...sector].length < 1 || [...sector].length > 20) throw new Error("섹터는 1자 이상 20자 이하로 입력해 주세요.");
    if (/[<>]|\b(?:script|javascript)\b/i.test(name) || /[<>]|\b(?:script|javascript)\b/i.test(sector)) {
      throw new Error("회사명과 섹터에는 사용할 수 없는 문자가 있어요.");
    }

    const result = db.transaction(() => {
      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock || stock.status === "delisted") throw new Error("상장 중인 종목만 변경할 수 있어요.");
      const duplicate = db
        .prepare("SELECT id FROM stocks WHERE id != ? AND status != 'delisted' AND name = ? COLLATE NOCASE")
        .get(stockId, name);
      if (duplicate) throw new Error("같은 이름의 활성 종목이 이미 있어요.");

      const before = { name: stock.name, sector: stock.sector || "기타" };
      const after = { name, sector };
      db.prepare(
        `UPDATE stocks
         SET name = ?, sector = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      ).run(name, sector, stockId);
      db.prepare(
        `INSERT INTO admin_logs
         (admin_user_id, target_user_id, target_stock_id, action_type, before_value, after_value, reason)
         VALUES (?, ?, ?, 'admin_stock_profile_update', ?, ?, ?)`,
      ).run(req.user.id, req.user.id, stockId, JSON.stringify(before), JSON.stringify(after), reason || null);
      db.prepare(
        `INSERT INTO stock_events
         (stock_id, stock_name_snapshot, symbol_snapshot, event_type, title, message, created_by_user_id, metadata_json)
         VALUES (?, ?, ?, 'admin_stock_profile_update', '회사 정보 변경', ?, ?, ?)`,
      ).run(
        stockId,
        name,
        stock.symbol,
        `${name}의 회사명 또는 섹터 정보가 관리자에 의해 변경되었어요.`,
        req.user.id,
        JSON.stringify({ oldName: before.name, newName: name, oldSector: before.sector, newSector: sector, reason }),
      );
      return db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
    })();

    return res.json({ message: "회사 정보를 변경했어요.", stock: result });
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
        calculateUserTotalEvaluatedAsset(db, admin.id, {
          excludeStockIds: [stock.id],
          excludePositionsForStockIds: [stock.id],
        }).totalEvaluatedAsset,
        1,
      );

      db.prepare(`
        UPDATE stocks 
        SET status = 'acquired', is_etf = 1, etf_tracking_type = 'owner_asset', 
            owner_user_id = ?, owner_nickname_snapshot = ?,
            etf_base_price = current_price,
            etf_base_owner_asset = ?, etf_last_tracked_owner_asset = ?,
            etf_delist_reference_price = current_price,
            etf_delist_reference_set_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            etf_delist_trigger_price = MAX(1, CAST(current_price * 0.15 AS INTEGER)),
            etf_delist_triggered_at = NULL, etf_delist_reason = NULL,
            delist_risk_status = 'normal', is_market_cap_warning = 0,
            caution_tick_count = 0, recovery_tick_count = 0, delist_review_tick_count = 0
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
            etf_base_owner_asset = 0, etf_last_tracked_owner_asset = 0,
            etf_delist_reference_price = NULL, etf_delist_reference_set_at = NULL,
            etf_delist_trigger_price = NULL, etf_delist_triggered_at = NULL, etf_delist_reason = NULL
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
  if (req.user.username !== "admin") {
    return res.status(403).json({ message: "관리자만 사용할 수 있어요." });
  }
  const stockId = Number(req.params.id);
  const targetPrice = Number(req.body?.targetPrice);
  const rampPercentPerTick = Number(req.body?.rampPercentPerTick);
  const reason = String(req.body?.reason || "").trim().slice(0, 120);
  const newsTitle = req.body?.newsTitle;
  const newsContent = req.body?.newsContent;
  const publishNews = req.body?.publishNews !== undefined ? Boolean(req.body.publishNews) : true;

  const stock = db.prepare("SELECT * FROM stocks WHERE id = ? AND status != 'delisted'").get(stockId);
  if (!stock) return res.status(404).json({ message: "해당 주식을 찾을 수 없거나 상장폐지되었습니다." });

  if (stock.status === 'acquired' || stock.is_etf === 1) {
    return res.status(400).json({ message: "이미 인수자 ETF 종목이므로 우량주로 설정할 수 없습니다." });
  }

  if (!Number.isSafeInteger(targetPrice) || targetPrice <= stock.current_price) {
    return res.status(400).json({ message: "목표주가는 현재가보다 높아야 해요." });
  }

  if (!Number.isFinite(rampPercentPerTick) || rampPercentPerTick < 1 || rampPercentPerTick > 100) {
    return res.status(400).json({ message: "tick당 상승률은 1% ~ 100% 사이여야 해요." });
  }

  const dayOpenPrice = Math.max(1, Math.floor(Number(stock.current_price) || 1));
  const dailyHighLimitPrice = Math.floor(dayOpenPrice * 1.15);
  const dailyLowLimitPrice = Math.max(1, Math.floor(dayOpenPrice * 0.87));

  // Determine auto messages
  let finalTitle = String(newsTitle || "").trim();
  let finalContent = String(newsContent || "").trim();

  if (!finalTitle) finalTitle = "우량주 선정";
  if (!finalContent) finalContent = `${stock.name}이(가) 우량주로 선정되었어요. 목표주가 ${targetPrice.toLocaleString("ko-KR")}원을 향해 상승 이벤트가 시작됩니다.`;

  db.transaction(() => {
    db.prepare(`
      UPDATE stocks 
      SET is_bluechip = 1, 
          blue_chip_selected_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 
          blue_chip_selected_by_user_id = ?,
          blue_chip_cancelled_at = NULL,
          blue_chip_day_open_price = ?,
          blue_chip_day_started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          blue_chip_daily_high_limit_price = ?,
          blue_chip_daily_low_limit_price = ?,
          blue_chip_ramp_active = 1,
          blue_chip_target_price = ?,
          blue_chip_ramp_percent_per_tick = ?,
          blue_chip_ramp_started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          blue_chip_ramp_ended_at = NULL,
          blue_chip_ramp_reason = ?,
          blue_chip_ramp_started_by_user_id = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(
      req.user.id,
      dayOpenPrice,
      dailyHighLimitPrice,
      dailyLowLimitPrice,
      targetPrice,
      rampPercentPerTick,
      reason,
      req.user.id,
      stockId,
    );

    db.prepare(`
      INSERT INTO admin_logs (admin_user_id, target_user_id, action_type, before_value, after_value)
      VALUES (?, ?, 'blue_chip_ramp_started', ?, ?)
    `).run(
      req.user.id,
      req.user.id,
      String(stock.is_bluechip),
      JSON.stringify({
        stockId,
        stockName: stock.name,
        targetPrice,
        rampPercentPerTick,
        reason,
        newsTitle,
        newsContent,
        publishNews,
        oldPrice: stock.current_price,
        newPrice: stock.current_price,
        sentiment: "good",
      })
    );

    const eventType = publishNews ? "admin_blue_chip_selected" : "admin_stock_manual_adjust";

    const stockEvent = db.prepare(`
      INSERT INTO stock_events (
        stock_id, stock_name_snapshot, symbol_snapshot, event_type, sentiment, 
        title, message, price_before, price_after, change_amount, change_rate, 
        target_price, percent_per_tick, created_by_user_id, metadata_json
      )
      VALUES (?, ?, ?, ?, 'good', ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
    `).run(
      stockId, stock.name, stock.symbol, eventType,
      finalTitle, finalContent, stock.current_price, stock.current_price,
      targetPrice, rampPercentPerTick, req.user.id, JSON.stringify({ reason })
    );

    if (publishNews) {
      db.prepare(`
        INSERT INTO server_notifications (nickname_snapshot, type, title, message, amount, source_type, source_id)
        VALUES ('시스템', 'admin_blue_chip_selected', '우량주 선정', ?, 0, 'stock_event', ?)
      `).run(finalContent, String(stockEvent.lastInsertRowid));
    }
  })();
  
  return res.json({ message: "해당 종목을 우량주로 선정하고 목표주가 급등 이벤트를 시작했습니다." });
});

adminRouter.delete("/stocks/:id/blue-chip", (req, res) => {
  const stockId = Number(req.params.id);
  const stock = db.prepare("SELECT * FROM stocks WHERE id = ? AND status != 'delisted'").get(stockId);
  if (!stock) return res.status(404).json({ message: "해당 주식을 찾을 수 없거나 상장폐지되었습니다." });
  
  db.prepare(`
    UPDATE stocks 
    SET is_bluechip = 0, 
        blue_chip_ramp_active = 0,
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

adminRouter.post("/stocks/:id/target-price", (req, res) => {
  if (req.user.username !== "admin") {
    return res.status(403).json({ message: "관리자만 사용할 수 있어요." });
  }
  const stockId = Number(req.params.id);
  const targetPrice = Number(req.body?.targetPrice);
  const percentPerTick = Number(req.body?.percentPerTick);
  const reason = String(req.body?.reason || "").trim().slice(0, 120);
  const newsTitle = req.body?.newsTitle;
  const newsContent = req.body?.newsContent;
  const publishNews = req.body?.publishNews !== undefined ? Boolean(req.body.publishNews) : true;

  const stock = db.prepare("SELECT * FROM stocks WHERE id = ? AND status != 'delisted'").get(stockId);
  if (!stock) return res.status(404).json({ message: "해당 주식을 찾을 수 없거나 상장폐지되었습니다." });

  if (stock.status === 'acquired' || stock.is_etf === 1) {
    return res.status(400).json({ message: "인수된 ETF 종목은 목표주가를 설정할 수 없습니다." });
  }

  if (!Number.isSafeInteger(targetPrice) || targetPrice <= 0) {
    return res.status(400).json({ message: "목표가는 0보다 큰 정수로 입력해 주세요." });
  }

  if (targetPrice === stock.current_price) {
    return res.status(400).json({ message: "목표가는 현재가와 달라야 합니다." });
  }

  if (!Number.isFinite(percentPerTick) || percentPerTick < 1 || percentPerTick > 100) {
    return res.status(400).json({ message: "틱당 변동률은 1% ~ 100% 사이여야 합니다." });
  }

  const direction = targetPrice > stock.current_price ? "up" : "down";

  // Determine auto messages
  let finalTitle = String(newsTitle || "").trim();
  let finalContent = String(newsContent || "").trim();
  if (!finalTitle) finalTitle = direction === "up" ? "호재" : "악재";
  if (!finalContent) {
    finalContent = reason
      ? `${stock.name}: ${reason}`
      : `${stock.name} 가격 조정이 시작되었어요.`;
  }

  const startTarget = db.transaction(() => {
    db.prepare(`
      UPDATE stocks
      SET admin_price_target_active = 1,
          admin_price_target = ?,
          admin_price_target_direction = ?,
          admin_price_target_percent_per_tick = ?,
          admin_price_target_started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          admin_price_target_ended_at = NULL,
          admin_price_target_reason = ?,
          admin_price_target_started_by_user_id = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(targetPrice, direction, percentPerTick, reason, req.user.id, stockId);

    db.prepare(`
      INSERT INTO admin_logs (admin_user_id, target_user_id, action_type, before_value, after_value)
      VALUES (?, ?, 'admin_stock_target_price_started', ?, ?)
    `).run(
      req.user.id,
      req.user.id,
      String(stock.current_price),
      JSON.stringify({
        stockId,
        stockName: stock.name,
        targetPrice,
        direction,
        percentPerTick,
        reason,
        newsTitle,
        newsContent,
        publishNews,
        oldPrice: stock.current_price,
        newPrice: stock.current_price,
        sentiment: direction === "up" ? "good" : "bad",
      })
    );

    const eventType = publishNews ? "admin_price_target_started" : "admin_stock_manual_adjust";
    const sentiment = direction === "up" ? "good" : "bad";

    db.prepare(`
      INSERT INTO stock_events (
        stock_id, stock_name_snapshot, symbol_snapshot, event_type, sentiment, 
        title, message, price_before, price_after, change_amount, change_rate, 
        target_price, percent_per_tick, created_by_user_id, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
    `).run(
      stockId, stock.name, stock.symbol, eventType, sentiment,
      finalTitle, finalContent, stock.current_price, stock.current_price,
      targetPrice, percentPerTick, req.user.id, JSON.stringify({ reason })
    );

    // Target price started notification removed per user request
  })();

  return res.json({ message: "목표주가 이벤트를 시작했습니다." });
});

adminRouter.get("/games/status", (req, res) => {
  const games = ["risk-button", "card-draw", "bomb-dodge", "slot", "dart", "cup"];
  const suspended = {};
  for (const game of games) {
    const row = db.prepare("SELECT value FROM system_config WHERE key = ?").get(`game_suspended_${game}`);
    suspended[game] = row ? row.value === "true" : false;
  }
  return res.json({ suspended });
});

adminRouter.post("/games/:gameType/suspend", (req, res) => {
  const { gameType } = req.params;
  const games = ["risk-button", "card-draw", "bomb-dodge", "slot", "dart", "cup"];
  if (!games.includes(gameType)) {
    return res.status(400).json({ message: "올바르지 않은 게임 유형입니다." });
  }

  db.prepare(`
    INSERT INTO system_config (key, value) VALUES (?, 'true')
    ON CONFLICT(key) DO UPDATE SET value = 'true'
  `).run(`game_suspended_${gameType}`);

  db.prepare(`
    INSERT INTO admin_logs (admin_user_id, target_user_id, action_type, before_value, after_value)
    VALUES (?, ?, 'game_suspend', ?, 'true')
  `).run(req.user.id, req.user.id, gameType);

  return res.json({ message: `${gameType} 게임을 정지했습니다.` });
});

adminRouter.post("/games/:gameType/resume", (req, res) => {
  const { gameType } = req.params;
  const games = ["risk-button", "card-draw", "bomb-dodge", "slot", "dart", "cup"];
  if (!games.includes(gameType)) {
    return res.status(400).json({ message: "올바르지 않은 게임 유형입니다." });
  }

  db.prepare(`
    INSERT INTO system_config (key, value) VALUES (?, 'false')
    ON CONFLICT(key) DO UPDATE SET value = 'false'
  `).run(`game_suspended_${gameType}`);

  db.prepare(`
    INSERT INTO admin_logs (admin_user_id, target_user_id, action_type, before_value, after_value)
    VALUES (?, ?, 'game_resume', ?, 'false')
  `).run(req.user.id, req.user.id, gameType);

  return res.json({ message: `${gameType} 게임의 정지를 해제했습니다.` });
});

adminRouter.post("/users/:userId/suspend", (req, res) => {
  const userId = Number(req.params.userId);
  const { type, until, reason } = req.body; // type: 'access' | 'action', until: ISOString, reason: string
  
  if (!["access", "action"].includes(type)) {
    return res.status(400).json({ message: "올바르지 않은 정지 유형입니다." });
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) {
    return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
  }
  if (user.username === "admin") {
    return res.status(400).json({ message: "관리자 계정은 정지할 수 없습니다." });
  }

  const columnPrefix = type === "access" ? "suspended_access" : "suspended_action";
  db.prepare(`
    UPDATE users
    SET ${columnPrefix}_until = ?,
        ${columnPrefix}_reason = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(until || null, reason || null, userId);

  db.prepare(`
    INSERT INTO admin_logs (admin_user_id, target_user_id, action_type, before_value, after_value)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    userId,
    `user_suspend_${type}`,
    JSON.stringify({ until: user[`${columnPrefix}_until`], reason: user[`${columnPrefix}_reason`] }),
    JSON.stringify({ until, reason })
  );

  return res.json({ message: `사용자에게 ${type === 'access' ? '접근 금지' : '재산'} 정지를 적용했습니다.` });
});

adminRouter.post("/users/:userId/resume", (req, res) => {
  const userId = Number(req.params.userId);
  const { type } = req.body; // type: 'access' | 'action' | 'all'

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) {
    return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
  }

  if (type === "access" || type === "all") {
    db.prepare(`
      UPDATE users
      SET suspended_access_until = NULL,
          suspended_access_reason = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(userId);
  }
  if (type === "action" || type === "all") {
    db.prepare(`
      UPDATE users
      SET suspended_action_until = NULL,
          suspended_action_reason = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(userId);
  }

  db.prepare(`
    INSERT INTO admin_logs (admin_user_id, target_user_id, action_type, before_value, after_value)
    VALUES (?, ?, ?, 'suspended', 'active')
  `).run(req.user.id, userId, `user_resume_${type}`, null);

  return res.json({ message: "사용자 정지를 해제했습니다." });
});

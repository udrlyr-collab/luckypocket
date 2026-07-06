import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import {
  CARD_BETS,
  DART_BETS,
  RISK_STAGES,
  bombStage,
  calculateSlotPayout,
  chance,
  classifySlot,
  createBombPositions,
  drawCardNumber,
  isDartWin,
  payoutFor,
  spinSlot,
  throwDart,
} from "../services/gameMath.js";
import {
  calculateRiskCashoutPayout,
  getAdjustedMultiplier,
  getRiskPayoutPreview,
  getRiskStagePayoutInfo,
} from "../services/riskPayoutService.js";
import {
  GameError,
  finishInstantGame,
  finishReservedGame,
  getFreshUser,
  validateBet,
} from "../services/gameService.js";

export const gamesRouter = Router();
gamesRouter.use(requireAuth);

function activeSession(userId, gameType) {
  return db
    .prepare(
      "SELECT * FROM game_sessions WHERE user_id = ? AND game_type = ? AND status = 'active'",
    )
    .get(userId, gameType);
}

function parseState(session) {
  return JSON.parse(session.state_json);
}

function saveSession(sessionId, state, status = "active") {
  db.prepare(
    `UPDATE game_sessions
     SET state_json = ?, status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(JSON.stringify(state), status, sessionId);
}

function riskView(session, state) {
  const bet = session.bet_amount;
  const current = state.stage > 0 ? RISK_STAGES[state.stage - 1] : null;
  const next = RISK_STAGES[state.stage] || null;

  let cashoutAmount = 0;
  let effectiveMultiplier = 1;
  let baseMultiplier = 1;
  let adjusted = false;
  if (current) {
    const info = getRiskStagePayoutInfo(bet, state.stage - 1);
    cashoutAmount = info.expectedPayout;
    effectiveMultiplier = info.effectiveMultiplier;
    baseMultiplier = info.baseMultiplier;
    adjusted = info.adjusted;
  }

  let nextAmount = null;
  let nextEffectiveMultiplier = null;
  let nextAdjusted = false;
  if (next) {
    const nextInfo = getRiskStagePayoutInfo(bet, state.stage);
    nextAmount = nextInfo.expectedPayout;
    nextEffectiveMultiplier = nextInfo.effectiveMultiplier;
    nextAdjusted = nextInfo.adjusted;
  }

  return {
    sessionId: session.id,
    betAmount: bet,
    stage: state.stage,
    cashoutAmount,
    effectiveMultiplier,
    baseMultiplier,
    adjusted,
    nextAmount,
    nextEffectiveMultiplier,
    nextAdjusted,
    nextChance: next?.stepChance ?? null,
    cumulativeChance: current?.cumulativeChance ?? 1,
    multiplier: current?.multiplier ?? 1,
  };
}

function bombView(session, state) {
  const safeCount = state.openedNumbers.length;
  const bombCount = state.bombs.length;
  const safeTotal = 16 - bombCount;
  const current = bombStage(bombCount, safeCount);
  const next = safeCount < safeTotal ? bombStage(bombCount, safeCount + 1) : null;
  return {
    sessionId: session.id,
    betAmount: session.bet_amount,
    openedNumbers: state.openedNumbers,
    safeCount,
    safeTotal,
    bombCount,
    cashoutAmount: safeCount > 0 ? payoutFor(session.bet_amount, current.multiplier) : 0,
    multiplier: current.multiplier,
    cumulativeChance: current.chance,
    targetRtp: current.targetRtp,
    nextChance: safeCount < safeTotal ? (safeTotal - safeCount) / (16 - safeCount) : null,
    nextMultiplier: next?.multiplier ?? null,
    remainingBombs: bombCount,
  };
}

gamesRouter.get("/active", (req, res) => {
  const sessions = db
    .prepare(
      "SELECT * FROM game_sessions WHERE user_id = ? AND status = 'active' ORDER BY id DESC",
    )
    .all(req.user.id);
  const response = {};
  for (const session of sessions) {
    const state = parseState(session);
    if (session.game_type === "risk-button") response.risk = riskView(session, state);
    if (session.game_type === "bomb-dodge") response.bomb = bombView(session, state);
  }
  return res.json(response);
});

gamesRouter.get("/risk/payout-preview", (req, res) => {
  const betAmount = Number(req.query.betAmount);
  if (!Number.isFinite(betAmount) || betAmount < 1000) {
    return res.status(400).json({ message: "배팅금을 올바르게 입력해 주세요." });
  }
  return res.json(getRiskPayoutPreview(betAmount));
});

gamesRouter.post("/risk-button/start", (req, res, next) => {
  try {
    const start = db.transaction(() => {
      const user = getFreshUser(req.user.id);
      if (activeSession(user.id, "risk-button")) {
        throw new GameError("이미 진행 중인 위험버튼 게임이 있어요.", 409);
      }
      const bet = validateBet(user, req.body.betAmount);
      const state = { stage: 0, balanceBefore: user.balance };
      db.prepare(
        "UPDATE users SET balance = balance - ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      ).run(bet, user.id);
      const result = db
        .prepare(
          "INSERT INTO game_sessions (user_id, game_type, bet_amount, state_json) VALUES (?, 'risk-button', ?, ?)",
        )
        .run(user.id, bet, JSON.stringify(state));
      const session = db
        .prepare("SELECT * FROM game_sessions WHERE id = ?")
        .get(result.lastInsertRowid);
      return { game: riskView(session, state), balance: user.balance - bet };
    });
    return res.status(201).json(start());
  } catch (error) {
    return next(error);
  }
});

gamesRouter.post("/risk-button/press", (req, res, next) => {
  try {
    const press = db.transaction(() => {
      const session = activeSession(req.user.id, "risk-button");
      if (!session) throw new GameError("진행 중인 위험버튼 게임이 없어요.", 404);
      const state = parseState(session);
      if (state.stage >= RISK_STAGES.length) {
        throw new GameError("마지막 단계예요. 수익을 확정해 주세요.");
      }
      const targetStage = state.stage + 1;
      const survived = chance(RISK_STAGES[state.stage].stepChance);
      if (!survived) {
        const detail = { failedAt: targetStage, reachedStage: state.stage, cashedOut: false };
        saveSession(session.id, { ...state, ...detail }, "completed");
        const result = finishReservedGame({
          userId: req.user.id,
          balanceBefore: state.balanceBefore,
          gameType: "risk-button",
          bet: session.bet_amount,
          payout: 0,
          detail,
          achievementContext: { stage: state.stage, cashedOut: false },
        });
        return { finished: true, ...result };
      }
      state.stage = targetStage;
      saveSession(session.id, state);
      return {
        finished: false,
        survived: true,
        game: riskView(session, state),
        balance: getFreshUser(req.user.id).balance,
      };
    });
    return res.json(press());
  } catch (error) {
    return next(error);
  }
});

gamesRouter.post("/risk-button/cashout", (req, res, next) => {
  try {
    const cashout = db.transaction(() => {
      const session = activeSession(req.user.id, "risk-button");
      if (!session) throw new GameError("진행 중인 위험버튼 게임이 없어요.", 404);
      const state = parseState(session);
      if (state.stage < 1) throw new GameError("버튼을 한 번 이상 성공한 뒤 확정할 수 있어요.");
      const { payout, detail } = calculateRiskCashoutPayout(session.bet_amount, state.stage);
      saveSession(session.id, state, "completed");
      return finishReservedGame({
        userId: req.user.id,
        balanceBefore: state.balanceBefore,
        gameType: "risk-button",
        bet: session.bet_amount,
        payout,
        detail,
        achievementContext: { stage: state.stage, cashedOut: true },
      });
    });
    return res.json({ finished: true, ...cashout() });
  } catch (error) {
    return next(error);
  }
});

gamesRouter.post("/card-draw/play", (req, res, next) => {
  try {
    const play = db.transaction(() => {
      const user = getFreshUser(req.user.id);
      const spec = CARD_BETS[req.body.condition];
      if (!spec) throw new GameError("카드 조건을 선택해 주세요.");
      const bet = validateBet(user, req.body.betAmount);
      let selectedNumber = null;
      if (req.body.condition === "exact") {
        selectedNumber = Number(req.body.selectedNumber);
        if (!Number.isInteger(selectedNumber) || selectedNumber < 1 || selectedNumber > 10) {
          throw new GameError("1부터 10까지 정확한 숫자를 선택해 주세요.");
        }
      }
      const number = drawCardNumber();
      const won =
        req.body.condition === "exact"
          ? number === selectedNumber
          : spec.test(number);
      const payout = won ? payoutFor(bet, spec.multiplier) : 0;
      return finishInstantGame({
        user,
        gameType: "card-draw",
        bet,
        payout,
        detail: {
          condition: req.body.condition,
          conditionLabel: spec.label,
          selectedNumber,
          number,
          multiplier: spec.multiplier,
        },
        achievementContext: { condition: req.body.condition },
      });
    });
    return res.json(play());
  } catch (error) {
    return next(error);
  }
});

gamesRouter.post("/bomb-dodge/start", (req, res, next) => {
  try {
    const start = db.transaction(() => {
      const user = getFreshUser(req.user.id);
      if (activeSession(user.id, "bomb-dodge")) {
        throw new GameError("이미 진행 중인 폭탄 피하기 게임이 있어요.", 409);
      }
      const bet = validateBet(user, req.body.betAmount);
      const bombCount = Number(req.body.bombCount);
      if (!Number.isInteger(bombCount) || bombCount < 1 || bombCount > 8) {
        throw new GameError("폭탄 개수는 1개부터 8개까지 선택해 주세요.");
      }
      const state = {
        bombs: createBombPositions(bombCount),
        openedNumbers: [],
        balanceBefore: user.balance,
      };
      db.prepare(
        "UPDATE users SET balance = balance - ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      ).run(bet, user.id);
      const result = db
        .prepare(
          "INSERT INTO game_sessions (user_id, game_type, bet_amount, state_json) VALUES (?, 'bomb-dodge', ?, ?)",
        )
        .run(user.id, bet, JSON.stringify(state));
      const session = db
        .prepare("SELECT * FROM game_sessions WHERE id = ?")
        .get(result.lastInsertRowid);
      return { game: bombView(session, state), balance: user.balance - bet };
    });
    return res.status(201).json(start());
  } catch (error) {
    return next(error);
  }
});

gamesRouter.post("/bomb-dodge/pick", (req, res, next) => {
  try {
    const pick = db.transaction(() => {
      const session = activeSession(req.user.id, "bomb-dodge");
      if (!session) throw new GameError("진행 중인 폭탄 피하기 게임이 없어요.", 404);
      const state = parseState(session);
      const number = Number(req.body.number);
      if (!Number.isInteger(number) || number < 1 || number > 16) {
        throw new GameError("1부터 16까지 칸을 골라 주세요.");
      }
      if (state.openedNumbers.includes(number)) {
        throw new GameError("이미 연 안전 숫자예요.");
      }
      if (state.bombs.includes(number)) {
        const detail = {
          pickedNumber: number,
          bombNumbers: state.bombs,
          openedNumbers: state.openedNumbers,
          safeCount: state.openedNumbers.length,
          bombCount: state.bombs.length,
          cashedOut: false,
        };
        saveSession(session.id, state, "completed");
        const result = finishReservedGame({
          userId: req.user.id,
          balanceBefore: state.balanceBefore,
          gameType: "bomb-dodge",
          bet: session.bet_amount,
          payout: 0,
          detail,
          achievementContext: {
            safeCount: state.openedNumbers.length,
            bombCount: state.bombs.length,
            cashedOut: false,
          },
        });
        return { finished: true, ...result };
      }
      state.openedNumbers.push(number);
      state.openedNumbers.sort((a, b) => a - b);
      saveSession(session.id, state);
      return {
        finished: false,
        safe: true,
        pickedNumber: number,
        game: bombView(session, state),
        balance: getFreshUser(req.user.id).balance,
      };
    });
    return res.json(pick());
  } catch (error) {
    return next(error);
  }
});

gamesRouter.post("/bomb-dodge/cashout", (req, res, next) => {
  try {
    const cashout = db.transaction(() => {
      const session = activeSession(req.user.id, "bomb-dodge");
      if (!session) throw new GameError("진행 중인 폭탄 피하기 게임이 없어요.", 404);
      const state = parseState(session);
      const safeCount = state.openedNumbers.length;
      if (safeCount < 1) throw new GameError("안전 숫자를 하나 이상 연 뒤 확정할 수 있어요.");
      const spec = bombStage(state.bombs.length, safeCount);
      const payout = payoutFor(session.bet_amount, spec.multiplier);
      const detail = {
        safeCount,
        bombCount: state.bombs.length,
        openedNumbers: state.openedNumbers,
        bombNumbers: state.bombs,
        multiplier: spec.multiplier,
        cumulativeChance: spec.chance,
        targetRtp: spec.targetRtp,
        cashedOut: true,
      };
      saveSession(session.id, state, "completed");
      return finishReservedGame({
        userId: req.user.id,
        balanceBefore: state.balanceBefore,
        gameType: "bomb-dodge",
        bet: session.bet_amount,
        payout,
        detail,
        achievementContext: {
          safeCount,
          bombCount: state.bombs.length,
          cashedOut: true,
        },
      });
    });
    return res.json({ finished: true, ...cashout() });
  } catch (error) {
    return next(error);
  }
});

gamesRouter.post("/slot/play", (req, res, next) => {
  try {
    const play = db.transaction(() => {
      const user = getFreshUser(req.user.id);
      const bet = validateBet(user, req.body.betAmount);
      const numbers = spinSlot();
      const outcome = classifySlot(numbers);
      const payout = calculateSlotPayout({
        balance: user.balance,
        bet,
        outcome,
      });
      const detail = outcome.outcome === "777"
        ? {
            numbers,
            ...outcome,
            jackpotBalanceBefore: user.balance,
            jackpotBalanceAfter: user.balance * outcome.balanceMultiplier,
          }
        : { numbers, ...outcome };
      return finishInstantGame({
        user,
        gameType: "slot",
        bet,
        payout,
        detail,
        achievementContext: { outcome: outcome.outcome },
      });
    });
    return res.json(play());
  } catch (error) {
    return next(error);
  }
});

gamesRouter.post("/dart/play", (req, res, next) => {
  try {
    const play = db.transaction(() => {
      const user = getFreshUser(req.user.id);
      const spec = DART_BETS[req.body.target];
      if (!spec) throw new GameError("다트 목표를 선택해 주세요.");
      const bet = validateBet(user, req.body.betAmount, spec.event ? 100000 : Infinity);
      const selectedSector = spec.needsSector ? Number(req.body.sector) : null;
      if (spec.needsSector && (!Number.isInteger(selectedSector) || selectedSector < 1 || selectedSector > 20)) {
        throw new GameError("1부터 20까지 섹터를 선택해 주세요.");
      }
      const dart = throwDart();
      const won = isDartWin(spec, dart, selectedSector);
      const payout = won ? payoutFor(bet, spec.multiplier) : 0;
      return finishInstantGame({
        user,
        gameType: "dart",
        bet,
        payout,
        detail: {
          target: req.body.target,
          targetLabel: spec.label,
          selectedSector,
          multiplier: spec.multiplier,
          radius: Number(dart.radius.toFixed(6)),
          x: Number(dart.x.toFixed(6)),
          y: Number(dart.y.toFixed(6)),
          sector: dart.sector,
        },
        achievementContext: { radius: dart.radius, target: req.body.target },
      });
    });
    return res.json(play());
  } catch (error) {
    return next(error);
  }
});

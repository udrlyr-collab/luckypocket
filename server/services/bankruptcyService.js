import { calculateUserTotalEvaluatedAsset } from "./portfolioValuationService.js";

export const BANKRUPTCY_POLICY = {
  threshold: 500_000,
  resetBalance: 1_000_000,
  transferLookbackHours: 24,
  cooldownHours: 24,
};

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function remainingMsSinceIso(value, hours) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return 0;
  const end = timestamp + hours * 60 * 60 * 1000;
  return Math.max(0, end - Date.now());
}

export function getRecentOutgoingTransferAmount(database, userId) {
  const since = isoHoursAgo(BANKRUPTCY_POLICY.transferLookbackHours);
  const row = database
    .prepare(
      `SELECT TOTAL(amount) AS amount
       FROM transfer_logs
       WHERE sender_user_id = ?
         AND created_at >= ?`,
    )
    .get(userId, since);
  return Math.floor(Number(row?.amount || 0));
}

export function getBankruptcyStatus(database, user, valuation = null) {
  if (!user) {
    return {
      eligible: false,
      shouldPrompt: false,
      reason: "login_required",
      message: "로그인이 필요해요.",
      totalEvaluatedAsset: 0,
      recentOutgoingTransferAmount: 0,
      effectiveBankruptcyAsset: 0,
      transferLookbackHours: BANKRUPTCY_POLICY.transferLookbackHours,
      cooldownHours: BANKRUPTCY_POLICY.cooldownHours,
      cooldownRemainingMs: 0,
    };
  }

  const assetSnapshot =
    valuation || calculateUserTotalEvaluatedAsset(database, user.id);
  const totalEvaluatedAsset = Math.floor(
    Number(assetSnapshot.totalEvaluatedAsset || 0),
  );
  const recentOutgoingTransferAmount = getRecentOutgoingTransferAmount(
    database,
    user.id,
  );
  const effectiveBankruptcyAsset =
    totalEvaluatedAsset + recentOutgoingTransferAmount;
  const cooldownRemainingMs = remainingMsSinceIso(
    user.last_bankruptcy_at,
    BANKRUPTCY_POLICY.cooldownHours,
  );

  let eligible = true;
  let reason = "eligible";
  let message = "파산신청을 할 수 있어요.";

  if (cooldownRemainingMs > 0) {
    eligible = false;
    reason = "cooldown";
    message = "파산신청은 24시간에 한 번만 사용할 수 있어요.";
  } else if (effectiveBankruptcyAsset >= BANKRUPTCY_POLICY.threshold) {
    eligible = false;
    if (
      totalEvaluatedAsset < BANKRUPTCY_POLICY.threshold &&
      recentOutgoingTransferAmount > 0
    ) {
      reason = "recent_transfer";
      message =
        "최근 송금한 금액이 있어 아직 파산신청할 수 없어요. 최근 24시간 내 보낸 송금액도 파산 판정에 포함돼요.";
    } else {
      reason = "asset_threshold";
      message = "총 평가자산이 500,000원 미만일 때만 파산신청할 수 있어요.";
    }
  }

  return {
    eligible,
    shouldPrompt:
      eligible && !user.bankruptcy_prompt_dismissed_at,
    reason,
    message,
    totalEvaluatedAsset,
    recentOutgoingTransferAmount,
    effectiveBankruptcyAsset,
    transferLookbackHours: BANKRUPTCY_POLICY.transferLookbackHours,
    cooldownHours: BANKRUPTCY_POLICY.cooldownHours,
    cooldownRemainingMs,
  };
}

export function canPromptBankruptcy(database, user, valuation = null) {
  return getBankruptcyStatus(database, user, valuation).shouldPrompt;
}

export function assertCanApplyBankruptcy(database, user, valuation = null) {
  const status = getBankruptcyStatus(database, user, valuation);
  if (!status.eligible) {
    if (status.reason === "recent_transfer") {
      try {
        database
          .prepare(
            `INSERT INTO abuse_logs
             (user_id, action_type, reason, metadata_json)
             VALUES (?, 'bankruptcy_apply_blocked', ?, ?)`,
          )
          .run(
            user.id,
            status.reason,
            JSON.stringify({
              totalEvaluatedAsset: status.totalEvaluatedAsset,
              recentOutgoingTransferAmount:
                status.recentOutgoingTransferAmount,
              effectiveBankruptcyAsset: status.effectiveBankruptcyAsset,
            }),
          );
      } catch {
        // abuse logging must not change the validation result
      }
    }
    const error = new Error(status.message);
    error.status = 400;
    error.code = status.reason;
    error.bankruptcyStatus = status;
    throw error;
  }
  return status;
}

export function assertCanTransferAfterBankruptcy(user) {
  const remainingMs = remainingMsSinceIso(
    user?.last_bankruptcy_at,
    BANKRUPTCY_POLICY.cooldownHours,
  );
  if (remainingMs <= 0) return;
  const error = new Error(
    "파산신청 후 24시간 동안은 송금할 수 없어요. 복구 자금은 직접 플레이에 사용해 주세요.",
  );
  error.status = 400;
  error.code = "bankruptcy_transfer_cooldown";
  error.remainingMs = remainingMs;
  throw error;
}

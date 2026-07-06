export const ADMIN_RESET_TARGETS = Object.freeze([
  "balance",
  "games",
  "achievements",
  "history",
  "stocks",
  "mine",
  "account",
]);

const ADMIN_RESET_TARGET_SET = new Set(ADMIN_RESET_TARGETS);

export function parseAdminResetTargets(value) {
  if (value === undefined) {
    return [...ADMIN_RESET_TARGETS];
  }
  if (!Array.isArray(value)) {
    throw new TypeError("초기화 항목 형식이 올바르지 않습니다.");
  }

  const invalidTargets = value.filter(
    (target) => typeof target !== "string" || !ADMIN_RESET_TARGET_SET.has(target),
  );
  if (invalidTargets.length > 0) {
    throw new TypeError("허용되지 않은 초기화 항목이 포함되어 있습니다.");
  }

  const requested = new Set(value);
  const targets = ADMIN_RESET_TARGETS.filter((target) => requested.has(target));
  if (targets.length === 0) {
    throw new TypeError("초기화할 항목을 하나 이상 선택해 주세요.");
  }
  return targets;
}

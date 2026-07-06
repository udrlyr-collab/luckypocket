export function bonusCodeLimitState(code, userUses) {
  if (Boolean(code.is_unlimited)) {
    return { totalLimitReached: false, userLimitReached: false };
  }
  return {
    totalLimitReached: code.used_count >= code.max_total_uses,
    userLimitReached: userUses >= code.max_uses_per_user,
  };
}

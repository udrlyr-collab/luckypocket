export function canPromptBankruptcy(database, user, totalEvaluatedAsset = null) {
  if (!user) return false;
  const assetToCheck = totalEvaluatedAsset !== null ? totalEvaluatedAsset : user.balance;
  if (assetToCheck >= 500000) return false;
  if (!user.bankruptcy_prompt_dismissed_at) return true;
  return false;
}

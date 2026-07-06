export function canPromptBankruptcy(database, user) {
  if (!user || user.balance >= 500000) return false;
  if (!user.bankruptcy_prompt_dismissed_at) return true;
  const crossedAgain = database
    .prepare(
      `SELECT 1
       FROM asset_events
       WHERE user_id = ?
         AND balance_before >= 500000
         AND balance_after < 500000
         AND julianday(created_at) > julianday(?)
       LIMIT 1`,
    )
    .get(user.id, user.bankruptcy_prompt_dismissed_at);
  return Boolean(crossedAgain);
}

export function calculateUserTotalEvaluatedAsset(db, userId) {
  const user = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId);
  if (!user) return 0;
  
  let cashBalance = user.balance;
  let stockValue = 0;
  let positionValue = 0;
  let unrealizedPnl = 0;

  const holdings = db.prepare(`
    SELECT SUM(h.quantity * s.current_price) as value
    FROM stock_holdings h
    JOIN stocks s ON h.stock_id = s.id
    WHERE h.user_id = ? AND s.status != 'delisted'
  `).get(userId);
  
  if (holdings && holdings.value) {
    stockValue = holdings.value;
  }

  const positions = db.prepare(`
    SELECT p.margin_amount, p.quantity, p.entry_price, s.current_price
    FROM stock_positions p
    JOIN stocks s ON p.stock_id = s.id
    WHERE p.user_id = ? AND p.status = 'open' AND s.status != 'delisted'
  `).all(userId);

  for (const p of positions) {
    const pnl = Math.floor(p.quantity * (p.current_price - p.entry_price));
    unrealizedPnl += pnl;
    positionValue += Math.max(0, p.margin_amount + pnl);
  }
  
  const totalEvaluatedAsset = Math.floor(cashBalance + stockValue + unrealizedPnl);

  return {
    cashBalance,
    stockValue: Math.floor(stockValue),
    positionValue: Math.floor(positionValue),
    unrealizedPnl: Math.floor(unrealizedPnl),
    totalEvaluatedAsset
  };
}

export function getPortfolioSnapshot(db, userId) {
  return calculateUserTotalEvaluatedAsset(db, userId);
}

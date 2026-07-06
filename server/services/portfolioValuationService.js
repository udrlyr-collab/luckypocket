export function calculateUserTotalEvaluatedAsset(db, userId) {
  const user = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId);
  if (!user) {
    return {
      cashBalance: 0,
      stockValue: 0,
      positionValue: 0,
      unrealizedPnl: 0,
      totalEvaluatedAsset: 0,
    };
  }
  
  let cashBalance = user.balance;
  let stockValue = 0;
  let positionValue = 0;
  let unrealizedPnl = 0;

  const holdings = db.prepare(`
    SELECT TOTAL(h.quantity * s.current_price) as value
    FROM stock_holdings h
    JOIN stocks s ON h.stock_id = s.id
    WHERE h.user_id = ?
      AND s.status != 'delisted'
      AND NOT (s.is_etf = 1 AND s.owner_user_id = ?)
  `).get(userId, userId);
  
  if (holdings && holdings.value) {
    stockValue = holdings.value;
  }

  const positions = db.prepare(`
    SELECT p.margin_amount, p.quantity, p.entry_price, s.current_price
    FROM stock_positions p
    JOIN stocks s ON p.stock_id = s.id
    WHERE p.user_id = ?
      AND p.status = 'open'
      AND s.status != 'delisted'
      AND NOT (s.is_etf = 1 AND s.owner_user_id = ?)
  `).all(userId, userId);

  for (const p of positions) {
    const pnl = Math.floor(p.quantity * (p.current_price - p.entry_price));
    unrealizedPnl += pnl;
    positionValue += Math.max(0, p.margin_amount + pnl);
  }
  
  const totalEvaluatedAsset = Math.floor(cashBalance + stockValue + positionValue);

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

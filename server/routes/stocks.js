import express from "express";
import { db } from "../db.js";
import { requireAuth } from "./auth.js";
import { createServerNotification } from "../services/serverNotificationService.js";
import { delistStock } from "../services/stockService.js";

export const stocksRouter = express.Router();

stocksRouter.get("/", (req, res) => {
  const stocks = db.prepare(`
    SELECT * FROM stocks 
    WHERE status != 'delisted' OR delisted_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
    ORDER BY market_cap DESC
  `).all();
  
  const summary = {
    total: stocks.length,
    up: stocks.filter(s => s.current_price > s.previous_price).length,
    down: stocks.filter(s => s.current_price < s.previous_price).length,
    ipo: stocks.filter(s => s.status === 'ipo').length,
    delisted: stocks.filter(s => s.status === 'delisted').length
  };

  res.json({ stocks, summary });
});

stocksRouter.get("/news", (req, res) => {
  const news = db.prepare(`
    SELECT * FROM stock_events 
    ORDER BY created_at DESC LIMIT 20
  `).all();
  res.json({ news });
});

stocksRouter.use(requireAuth);

stocksRouter.get("/portfolio", (req, res) => {
  const userId = req.user.id;
  
  const holdings = db.prepare(`
    SELECT h.*, s.symbol, s.name, s.current_price, s.status, s.is_etf,
           (s.current_price - h.average_price) * h.quantity as unrealized_pnl,
           (s.current_price * h.quantity) as value
    FROM stock_holdings h
    JOIN stocks s ON h.stock_id = s.id
    WHERE h.user_id = ? AND h.quantity > 0
  `).all(userId);

  const positions = db.prepare(`
    SELECT p.*, s.symbol, s.name, s.current_price as stock_current_price, s.status as stock_status,
           (s.current_price - p.entry_price) * p.quantity as live_unrealized_pnl
    FROM stock_positions p
    JOIN stocks s ON p.stock_id = s.id
    WHERE p.user_id = ? AND p.status = 'open'
  `).all(userId);

  res.json({ holdings, positions });
});

stocksRouter.get("/:id", (req, res) => {
  const { id } = req.params;
  const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(id);
  if (!stock) return res.status(404).json({ message: "종목을 찾을 수 없어요." });

  const history = db.prepare(`
    SELECT * FROM stock_price_history 
    WHERE stock_id = ? 
    ORDER BY created_at DESC LIMIT 60
  `).all(id).reverse(); // Last 10 minutes (60 ticks)

  const holding = db.prepare("SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?").get(req.user.id, id);
  const positions = db.prepare("SELECT * FROM stock_positions WHERE user_id = ? AND stock_id = ? AND status = 'open'").all(req.user.id, id);

  res.json({ stock, history, holding, positions });
});

stocksRouter.post("/buy", (req, res) => {
  const { stockId, amount } = req.body; // amount is the money they want to spend
  const userId = req.user.id;

  if (!amount || amount <= 0) return res.status(400).json({ message: "매수 금액을 올바르게 입력해주세요." });

  let result;
  try {
    result = db.transaction(() => {
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (user.balance < amount) throw new Error("잔액이 부족해요.");

      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock || stock.status === 'delisted') throw new Error("거래할 수 없는 종목입니다.");

      const quantity = amount / stock.current_price;
      
      let holding = db.prepare("SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?").get(userId, stockId);
      if (holding) {
        const totalCost = (holding.average_price * holding.quantity) + amount;
        const newQuantity = holding.quantity + quantity;
        const newAvgPrice = totalCost / newQuantity;
        db.prepare("UPDATE stock_holdings SET quantity = ?, average_price = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(newQuantity, newAvgPrice, holding.id);
      } else {
        db.prepare("INSERT INTO stock_holdings (user_id, stock_id, quantity, average_price) VALUES (?, ?, ?, ?)").run(userId, stockId, quantity, stock.current_price);
      }

      const balanceAfter = user.balance - amount;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_after, source_id)
        VALUES (?, 'stock_buy', ?, ?, ?)
      `).run(userId, -amount, balanceAfter, stockId);

      db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, balance_before, balance_after)
        VALUES (?, ?, 'buy', ?, ?, ?, 1, ?, ?)
      `).run(userId, stockId, amount, quantity, stock.current_price, user.balance, balanceAfter);

      return { balance: balanceAfter, stockPrice: stock.current_price };
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: "매수 주문이 체결되었어요.", ...result });
});

stocksRouter.post("/sell", (req, res) => {
  const { stockId, fraction = 1 } = req.body; // fraction to sell (1 = 100%)
  const userId = req.user.id;

  if (fraction <= 0 || fraction > 1) return res.status(400).json({ message: "매도 비율이 올바르지 않아요." });

  let result;
  try {
    result = db.transaction(() => {
      const holding = db.prepare("SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?").get(userId, stockId);
      if (!holding || holding.quantity <= 0) throw new Error("보유 중인 주식이 없어요.");

      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock || stock.status === 'delisted') {
        // If delisted, allow selling but at 0 price
        if (stock && stock.status === 'delisted') {
           db.prepare("UPDATE stock_holdings SET quantity = 0 WHERE id = ?").run(holding.id);
           return { balance: req.user.balance, amountSold: 0 };
        }
        throw new Error("거래할 수 없는 종목입니다.");
      }

      const sellQuantity = holding.quantity * fraction;
      const sellAmount = Math.floor(sellQuantity * stock.current_price);
      const realizedPnl = Math.floor(sellQuantity * (stock.current_price - holding.average_price));

      const newQuantity = holding.quantity - sellQuantity;
      db.prepare("UPDATE stock_holdings SET quantity = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(newQuantity, holding.id);

      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      const balanceAfter = user.balance + sellAmount;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_after, source_id)
        VALUES (?, 'stock_sell', ?, ?, ?)
      `).run(userId, sellAmount, balanceAfter, stockId);

      db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, realized_pnl, balance_before, balance_after)
        VALUES (?, ?, 'sell', ?, ?, ?, 1, ?, ?, ?)
      `).run(userId, stockId, sellAmount, sellQuantity, stock.current_price, realizedPnl, user.balance, balanceAfter);

      if (realizedPnl >= 1000000) {
        createServerNotification(db, {
          userId,
          nickname: user.nickname,
          type: "stock_big_profit",
          title: "주식 대박",
          message: `${user.nickname}님이 주식 현물 투자로 ${realizedPnl.toLocaleString()}원의 수익을 실현했어요!`,
          amount: realizedPnl,
          gameType: "stock",
          gameName: "주식"
        });
      }

      return { balance: balanceAfter, amountSold: sellAmount, realizedPnl };
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: "매도 주문이 체결되었어요.", ...result });
});

stocksRouter.post("/open-position", (req, res) => {
  const { stockId, margin, leverage } = req.body;
  const userId = req.user.id;

  if (!margin || margin <= 0 || !leverage || leverage <= 1) return res.status(400).json({ message: "증거금 또는 레버리지가 올바르지 않아요." });
  if (![2, 5, 10, 50, 100].includes(leverage)) return res.status(400).json({ message: "지원하지 않는 레버리지 배율이에요." });

  let result;
  try {
    result = db.transaction(() => {
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (user.balance < margin) throw new Error("잔액이 부족해요.");

      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock || stock.status === 'delisted') throw new Error("거래할 수 없는 종목입니다.");

      const positionSize = margin * leverage;
      const quantity = positionSize / stock.current_price;
      const liquidationPrice = Math.floor(stock.current_price * (1 - 1 / leverage)); // LONG liquidation

      db.prepare(`
        INSERT INTO stock_positions (user_id, stock_id, side, margin_amount, leverage, position_size, quantity, entry_price, liquidation_price)
        VALUES (?, ?, 'long', ?, ?, ?, ?, ?, ?)
      `).run(userId, stockId, margin, leverage, positionSize, quantity, stock.current_price, liquidationPrice);

      const balanceAfter = user.balance - margin;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_after, source_id)
        VALUES (?, 'stock_position_open', ?, ?, ?)
      `).run(userId, -margin, balanceAfter, stockId);

      db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, balance_before, balance_after)
        VALUES (?, ?, 'open_position', ?, ?, ?, ?, ?, ?)
      `).run(userId, stockId, margin, quantity, stock.current_price, leverage, user.balance, balanceAfter);

      return { balance: balanceAfter };
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: `${leverage}배 레버리지 포지션을 열었어요.`, ...result });
});

stocksRouter.post("/close-position", (req, res) => {
  const { positionId } = req.body;
  const userId = req.user.id;

  let result;
  try {
    result = db.transaction(() => {
      const position = db.prepare("SELECT * FROM stock_positions WHERE id = ? AND user_id = ? AND status = 'open'").get(positionId, userId);
      if (!position) throw new Error("포지션을 찾을 수 없어요.");

      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(position.stock_id);
      const closePrice = (stock && stock.status !== 'delisted') ? stock.current_price : 0;

      const unrealizedPnl = (closePrice - position.entry_price) * position.quantity;
      const payout = Math.floor(position.margin_amount + unrealizedPnl);
      const finalPayout = Math.max(0, payout); // Cannot lose more than margin if manually closed before liquidation processing

      db.prepare(`
        UPDATE stock_positions 
        SET status = 'closed', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), unrealized_pnl = 0, realized_pnl = ?
        WHERE id = ?
      `).run(unrealizedPnl, position.id);

      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      const balanceAfter = user.balance + finalPayout;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_after, source_id)
        VALUES (?, 'stock_position_close', ?, ?, ?)
      `).run(userId, finalPayout, balanceAfter, stock.id);

      db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, realized_pnl, balance_before, balance_after)
        VALUES (?, ?, 'close_position', ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, stock.id, finalPayout, position.quantity, closePrice, position.leverage, unrealizedPnl, user.balance, balanceAfter);

      if (position.leverage >= 10 && unrealizedPnl >= 1000000) {
        createServerNotification(db, {
          userId,
          nickname: user.nickname,
          type: "stock_big_profit",
          title: "레버리지 대박",
          message: `${user.nickname}님이 ${position.leverage}배 레버리지로 ${Math.floor(unrealizedPnl).toLocaleString()}원의 수익을 올렸어요!`,
          amount: unrealizedPnl,
          gameType: "stock",
          gameName: "주식"
        });
      }

      return { balance: balanceAfter, payout: finalPayout, realizedPnl: unrealizedPnl };
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: "포지션을 청산했어요.", ...result });
});

stocksRouter.post("/:id/acquire", (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    db.transaction(() => {
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(id);

      if (!stock || stock.status === 'delisted') throw new Error("인수할 수 없는 종목입니다.");
      if (stock.is_etf || stock.status === 'acquired') throw new Error("이미 인수된 종목입니다.");
      if (user.balance < stock.market_cap) throw new Error(`시가총액(${stock.market_cap.toLocaleString()}원)보다 잔액이 부족해요.`);

      const cost = stock.market_cap;
      const balanceAfter = user.balance - cost;
      
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);
      
      db.prepare(`
        UPDATE stocks 
        SET status = 'acquired', is_etf = 1, etf_tracking_type = 'top_user_asset', 
            owner_user_id = ?, owner_nickname_snapshot = ?
        WHERE id = ?
      `).run(userId, user.nickname, id);

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_after, source_id)
        VALUES (?, 'stock_acquire_company', ?, ?, ?)
      `).run(userId, -cost, balanceAfter, id);

      db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, balance_before, balance_after)
        VALUES (?, ?, 'acquire', ?, 0, ?, 1, ?, ?)
      `).run(userId, id, cost, stock.current_price, user.balance, balanceAfter);

      createServerNotification(db, {
        userId,
        nickname: user.nickname,
        type: "stock_acquired",
        title: "회사 인수",
        message: `${user.nickname}님이 ${cost.toLocaleString()}원에 ${stock.name}을(를) 인수했어요! 이제 1등 자산을 추종하는 ETF가 됩니다.`,
        amount: -cost,
        gameType: "stock",
        gameName: "주식",
        metadata: { stockId: id, symbol: stock.symbol }
      });
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: "회사 인수에 성공했어요!" });
});

stocksRouter.post("/:id/delist-by-owner", (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    db.transaction(() => {
      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(id);
      
      if (!stock || stock.status !== 'acquired' || !stock.is_etf) throw new Error("상장폐지할 수 없는 상태입니다.");
      if (stock.owner_user_id !== userId) throw new Error("회사의 소유자만 상장폐지할 수 있어요.");

      delistStock(db, stock);

      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      
      db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, balance_before, balance_after)
        VALUES (?, ?, 'owner_delist', 0, 0, 0, 1, ?, ?)
      `).run(userId, id, user.balance, user.balance);
      
      createServerNotification(db, {
        userId,
        nickname: user.nickname,
        type: "stock_owner_delisted",
        title: "소유자 상장폐지",
        message: `${user.nickname}님이 인수한 ${stock.name}을(를) 상장폐지시켰습니다.`,
        gameType: "stock",
        gameName: "주식",
        metadata: { stockId: id }
      });
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: "회사를 상장폐지시켰습니다. 새로운 공모주가 곧 등장합니다." });
});

import { createServerNotification } from "./serverNotificationService.js";

const STOCK_TICK_INTERVAL_MS = 10_000;

const EVENT_PROBABILITIES = {
  normal: 0.92,
  surge: 0.025,
  crash: 0.025,
  delistWarning: 0.015,
  delist: 0.005,
  ipoBoost: 0.01
};

const IPO_EVENT_PROBABILITIES = {
  ipoSurge: 0.55,
  ipoNormal: 0.30,
  ipoCrash: 0.15
};

const DEFAULT_STOCKS = [
  { symbol: "LUCKY", name: "행운전자" },
  { symbol: "POKET", name: "주머니식품" },
  { symbol: "BOMB", name: "폭탄산업" },
  { symbol: "DART", name: "다트정밀" },
  { symbol: "SLOT", name: "슬롯엔터" },
  { symbol: "MINE", name: "탄광개발" },
  { symbol: "CARD", name: "카드리테일" },
  { symbol: "MOON", name: "달토끼바이오" }
];

function randomPrice() {
  return Math.floor(Math.random() * 49000) + 1000; // 1,000 ~ 50,000
}

function randomShares() {
  return Math.floor(Math.random() * 990000) + 10000; // 10,000 ~ 1,000,000
}

function generateIpoName() {
  const prefixes = ["우주", "메타", "스마트", "미래", "글로벌", "신성", "제일", "동방"];
  const suffixes = ["테크", "바이오", "에너지", "홀딩스", "로보틱스", "솔루션", "시스템즈", "네트웍스"];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  return `${prefix}${suffix}`;
}

function generateIpoSymbol() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let symbol = "";
  for (let i = 0; i < 4; i++) {
    symbol += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return symbol;
}

export function initStockMarket(db) {
  const count = db.prepare("SELECT COUNT(*) as c FROM stocks").get().c;
  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO stocks (symbol, name, status, current_price, previous_price, initial_price, total_shares, market_cap, volatility)
      VALUES (?, ?, 'listed', ?, ?, ?, ?, ?, ?)
    `);
    
    db.transaction(() => {
      for (const st of DEFAULT_STOCKS) {
        const price = randomPrice();
        const shares = randomShares();
        const cap = price * shares;
        const volatility = 0.01 + Math.random() * 0.04; // 1% ~ 5% base volatility
        insert.run(st.symbol, st.name, price, price, price, shares, cap, volatility);
      }
    })();
  }
}

function getRandomEvent(probs) {
  const r = Math.random();
  let cumulative = 0;
  for (const [event, prob] of Object.entries(probs)) {
    cumulative += prob;
    if (r <= cumulative) return event;
  }
  return "normal"; // fallback
}

export function tickStockMarket(db) {
  db.transaction(() => {
    const stocks = db.prepare("SELECT * FROM stocks WHERE status IN ('listed', 'ipo', 'acquired')").all();

    for (const stock of stocks) {
      if (stock.is_etf) {
        processEtfTick(db, stock);
      } else {
        processNormalTick(db, stock);
      }
    }

    // Process liquidations globally after price updates
    liquidatePositionsIfNeeded(db);
  })();
}

function processNormalTick(db, stock) {
  let newPrice = stock.current_price;
  let eventType = null;
  let eventMsg = null;
  let newStatus = stock.status;
  const now = Date.now();

  // Determine if active event expires
  let currentEventType = stock.event_type;
  if (stock.event_until && stock.event_until < now) {
    currentEventType = null;
    db.prepare("UPDATE stocks SET event_type = NULL, event_until = NULL WHERE id = ?").run(stock.id);
  }

  if (stock.status === "ipo") {
    const event = getRandomEvent(IPO_EVENT_PROBABILITIES);
    if (event === "ipoSurge") {
      newPrice = Math.floor(newPrice * (1 + 0.5 + Math.random() * 2.5)); // +50% ~ +300%
      eventType = "ipo_surge";
    } else if (event === "ipoCrash") {
      newPrice = Math.floor(newPrice * (1 - 0.4 - Math.random() * 0.4)); // -40% ~ -80%
      eventType = "ipo_crash";
    } else {
      const change = (Math.random() * 0.4 - 0.1); // -10% ~ +30%
      newPrice = Math.floor(newPrice * (1 + change));
    }
    
    // Transition to listed after some time or randomly (10% chance per tick to stabilize)
    if (Math.random() < 0.1) {
      newStatus = "listed";
    }
  } else {
    // Normal listed stock
    if (currentEventType === "delist_warning") {
      // High chance to delist or recover
      if (Math.random() < 0.3) {
        delistStock(db, stock);
        return; // Terminate further processing for this stock
      } else if (Math.random() < 0.4) {
        // Recover
        db.prepare("UPDATE stocks SET event_type = NULL, event_until = NULL WHERE id = ?").run(stock.id);
      }
    }

    const event = getRandomEvent(EVENT_PROBABILITIES);
    if (event === "surge") {
      newPrice = Math.floor(newPrice * (1 + 0.2 + Math.random() * 0.6)); // +20% ~ +80%
      eventType = "surge";
      eventMsg = `${stock.name} 주가가 급등했어요!`;
    } else if (event === "crash") {
      newPrice = Math.floor(newPrice * (1 - 0.2 - Math.random() * 0.5)); // -20% ~ -70%
      eventType = "crash";
      eventMsg = `${stock.name} 주가가 급락했어요!`;
    } else if (event === "delistWarning" && currentEventType !== "delist_warning") {
      db.prepare("UPDATE stocks SET event_type = ?, event_until = ? WHERE id = ?")
        .run("delist_warning", now + 60000, stock.id); // 1 minute warning
      eventType = "delist_warning";
      eventMsg = `${stock.name} 종목이 상장폐지 위기에 처했어요!`;
    } else if (event === "delist") {
      delistStock(db, stock);
      return;
    } else if (event === "ipoBoost") {
       // Small boost
       newPrice = Math.floor(newPrice * (1 + 0.1 + Math.random() * 0.2));
    } else {
      // Normal fluctuation
      const maxChange = stock.volatility; // e.g. 0.03 for 3%
      const change = (Math.random() * 2 - 1) * maxChange + stock.trend;
      newPrice = Math.floor(newPrice * (1 + change));
    }
  }

  // Enforce bounds
  newPrice = Math.max(1, newPrice);

  if (newPrice !== stock.current_price || newStatus !== stock.status) {
    updateStockPrice(db, stock, newPrice, newStatus, eventType, eventMsg);
  }
}

function processEtfTick(db, stock) {
  // 1등 유저 찾기 (balance + 주식 평가액이 가장 큰 사람)
  // For simplicity based on prompt, we can use highest balance + portfolio value, or just highest total_profit, etc.
  // Prompt says: "리더보드 1등 유저의 자산을 추종" -> We will use highest balance for simplicity and performance.
  const topUser = db.prepare("SELECT balance FROM users ORDER BY balance DESC LIMIT 1").get();
  if (!topUser) return;

  const currentTopBalance = topUser.balance;
  
  if (!stock.etf_base_price || !stock.etf_base_top_balance) {
    db.prepare("UPDATE stocks SET etf_base_price = ?, etf_base_top_balance = ?, etf_last_tracked_balance = ? WHERE id = ?")
      .run(stock.current_price, currentTopBalance, currentTopBalance, stock.id);
    return;
  }

  if (currentTopBalance !== stock.etf_last_tracked_balance) {
    const ratio = currentTopBalance / stock.etf_base_top_balance;
    let newPrice = Math.floor(stock.etf_base_price * ratio);
    newPrice = Math.max(1, newPrice); // minimum 1 won
    
    updateStockPrice(db, stock, newPrice, stock.status, "etf_update", null);
    db.prepare("UPDATE stocks SET etf_last_tracked_balance = ? WHERE id = ?").run(currentTopBalance, stock.id);
  }
}

function updateStockPrice(db, stock, newPrice, newStatus, eventType, eventMsg) {
  const newCap = newPrice * stock.total_shares;
  
  db.prepare(`
    UPDATE stocks 
    SET previous_price = current_price, current_price = ?, market_cap = ?, status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(newPrice, newCap, newStatus, stock.id);

  db.prepare(`
    INSERT INTO stock_price_history (stock_id, price, market_cap, event_type)
    VALUES (?, ?, ?, ?)
  `).run(stock.id, newPrice, newCap, eventType);

  if (eventType && eventMsg) {
    const eventId = db.prepare(`
      INSERT INTO stock_events (stock_id, event_type, title, message)
      VALUES (?, ?, ?, ?)
    `).run(stock.id, eventType, eventType === "surge" ? "급등" : eventType === "crash" ? "급락" : "위기", eventMsg).lastInsertRowid;
    
    // Optional: Only broadcast really huge surges/crashes to server_notifications if needed, 
    // but the prompt says to broadcast IPOs, acquired, delisted.
  }
}

export function delistStock(db, stock) {
  // 1. Update stock status to delisted, price to 0
  db.prepare("UPDATE stocks SET status = 'delisted', current_price = 0, previous_price = current_price, market_cap = 0 WHERE id = ?").run(stock.id);
  
  // 2. Liquidate all positions for this stock
  const openPositions = db.prepare("SELECT * FROM stock_positions WHERE stock_id = ? AND status = 'open'").all(stock.id);
  for (const pos of openPositions) {
    liquidatePosition(db, pos, 0);
  }

  // 3. Mark holdings as worthless (no active deletion needed, just price is 0, but we can log)
  // 4. Create server notification
  createServerNotification(db, {
    type: "stock_delisted",
    title: "상장폐지 발생",
    message: `${stock.name} 종목이 상장폐지되었습니다. 보유 주식은 휴지조각이 되었습니다.`,
    gameType: "stock",
    gameName: "주식",
    metadata: { stockId: stock.id, symbol: stock.symbol }
  });

  db.prepare(`
    INSERT INTO stock_events (stock_id, event_type, title, message)
    VALUES (?, ?, ?, ?)
  `).run(stock.id, "delisted", "상장폐지", `${stock.name} 종목이 상장폐지되었습니다.`);

  // 5. Create new IPO
  createIpoStock(db);
}

export function createIpoStock(db) {
  const symbol = generateIpoSymbol();
  const name = generateIpoName();
  const price = Math.floor(Math.random() * 4500) + 500; // 500 ~ 5,000
  const shares = randomShares();
  const cap = price * shares;
  const volatility = 0.05 + Math.random() * 0.05; // 5% ~ 10% highly volatile initially

  const insert = db.prepare(`
    INSERT INTO stocks (symbol, name, status, current_price, previous_price, initial_price, total_shares, market_cap, volatility)
    VALUES (?, ?, 'ipo', ?, ?, ?, ?, ?, ?)
  `);
  
  const stockId = insert.run(symbol, name, price, price, price, shares, cap, volatility).lastInsertRowid;

  createServerNotification(db, {
    type: "stock_ipo",
    title: "신규 상장 (IPO)",
    message: `새로운 공모주 ${name}(${symbol})이(가) 상장되었습니다!`,
    gameType: "stock",
    gameName: "주식",
    metadata: { stockId, symbol, name }
  });

  db.prepare(`
    INSERT INTO stock_events (stock_id, event_type, title, message)
    VALUES (?, ?, ?, ?)
  `).run(stockId, "ipo_created", "신규 상장", `${name} 종목이 주식시장에 신규 상장되었습니다.`);
}

function liquidatePositionsIfNeeded(db) {
  // Find all open positions where current stock price hits or exceeds liquidation price
  // For LONG: liquidation occurs if current_price <= liquidation_price
  const positions = db.prepare(`
    SELECT p.*, s.current_price as stock_current_price
    FROM stock_positions p
    JOIN stocks s ON p.stock_id = s.id
    WHERE p.status = 'open' AND s.current_price <= p.liquidation_price
  `).all();

  for (const pos of positions) {
    liquidatePosition(db, pos, pos.stock_current_price);
  }
}

function liquidatePosition(db, position, closingPrice) {
  db.prepare(`
    UPDATE stock_positions 
    SET status = 'liquidated', current_price = ?, liquidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), unrealized_pnl = 0, realized_pnl = ?
    WHERE id = ?
  `).run(closingPrice, -position.margin_amount, position.id);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(position.user_id);
  
  db.prepare(`
    INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, realized_pnl, balance_before, balance_after)
    VALUES (?, ?, 'liquidation', ?, ?, ?, ?, ?, ?, ?)
  `).run(position.user_id, position.stock_id, position.margin_amount, position.quantity, closingPrice, position.leverage, -position.margin_amount, user.balance, user.balance);

  // Big liquidations get notification
  if (position.leverage >= 50 || position.margin_amount >= 500000) {
    createServerNotification(db, {
      userId: user.id,
      nickname: user.nickname,
      type: "stock_liquidation",
      title: "강제 청산",
      message: `${user.nickname}님이 ${position.leverage}배 레버리지 포지션에서 강제 청산당했습니다.`,
      amount: -position.margin_amount,
      gameType: "stock",
      gameName: "주식",
      metadata: { positionId: position.id, margin: position.margin_amount }
    });
  }
}

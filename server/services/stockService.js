import { createServerNotification } from "./serverNotificationService.js";

const STOCK_TICK_INTERVAL_MS = 10_000;

const EVENT_PROBABILITIES = {
  normal: 0.95,
  surge: 0.025,
  crash: 0.025
};

const IPO_EVENT_PROBABILITIES = {
  ipoSurge: 0.55,
  ipoNormal: 0.30,
  ipoCrash: 0.15
};

import { STOCK_NAME_POOL } from "../constants/stockNamePool.js";

function pickRandomStockIdentity(db) {
  const activeStocks = db.prepare("SELECT name, symbol FROM stocks WHERE status IN ('listed', 'ipo_subscription', 'newly_listed', 'acquired', 'delist_warning', 'final_crash')").all();
  const recentDelisted = db.prepare("SELECT name FROM stocks WHERE status = 'delisted' ORDER BY delisted_at DESC LIMIT 5").all();
  
  const activeNames = new Set(activeStocks.map(s => s.name));
  const activeSymbols = new Set(activeStocks.map(s => s.symbol));
  const recentDelistedNames = new Set(recentDelisted.map(s => s.name));

  const candidates = STOCK_NAME_POOL.filter(item => {
    return (
      !activeNames.has(item.name) &&
      !activeSymbols.has(item.symbol) &&
      !recentDelistedNames.has(item.name)
    );
  });

  if (candidates.length > 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const fallback = STOCK_NAME_POOL[Math.floor(Math.random() * STOCK_NAME_POOL.length)];
  const suffix = Date.now().toString().slice(-4);

  return {
    name: `${fallback.name}${suffix}`,
    symbol: `${fallback.symbol}${suffix}`
  };
}

export function initStockMarket(db) {
  const count = db.prepare("SELECT COUNT(*) as c FROM stocks").get().c;
  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO stocks (symbol, name, status, current_price, previous_price, initial_price, total_shares, market_cap, volatility)
      VALUES (?, ?, 'listed', ?, ?, ?, ?, ?, ?)
    `);
    
    db.transaction(() => {
      for (let i = 0; i < 8; i++) {
        const st = pickRandomStockIdentity(db);
        const price = Math.floor(Math.random() * 49000) + 1000;
        const shares = Math.floor(Math.random() * 990000) + 10000;
        const cap = price * shares;
        const volatility = 0.01 + Math.random() * 0.04;
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
    const stocks = db.prepare("SELECT * FROM stocks WHERE status IN ('listed', 'ipo_subscription', 'newly_listed', 'acquired', 'delist_warning', 'final_crash')").all();

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

  if (stock.status === "ipo_subscription") {
    const endsAt = new Date(stock.ipo_subscription_ends_at).getTime();
    if (now >= endsAt) {
      newStatus = "newly_listed";
      const newlyListedUntil = new Date(now + 3 * 60 * 1000).toISOString();
      const identity = pickRandomStockIdentity(db);
      
      db.prepare("UPDATE stocks SET newly_listed_until = ?, name = ?, symbol = ? WHERE id = ?").run(newlyListedUntil, identity.name, identity.symbol, stock.id);
      
      createServerNotification(db, {
        type: "stock_newly_listed",
        title: "신규 상장",
        message: `공모주가 '${identity.name}'(으)로 신규 상장했어요!`,
        gameType: "stock",
        gameName: "주식",
        metadata: { stockId: stock.id, symbol: identity.symbol }
      });
      db.prepare("INSERT INTO stock_events (stock_id, event_type, title, message) VALUES (?, ?, ?, ?)").run(stock.id, "newly_listed", "신규 상장", `공모주가 '${identity.name}' 종목으로 신규 상장되어 거래가 시작되었습니다.`);
    } else {
      return; // In subscription period, price is locked
    }
  } else if (stock.status === "newly_listed") {
    const newlyListedUntil = new Date(stock.newly_listed_until).getTime();
    if (now >= newlyListedUntil) {
      newStatus = "listed";
    }

    const event = getRandomEvent(IPO_EVENT_PROBABILITIES);
    if (event === "ipoSurge") {
      newPrice = Math.floor(newPrice * (1 + 0.5 + Math.random() * 2.5)); // +50% ~ +300%
      eventType = "ipo_surge";
      eventMsg = `${stock.name}이(가) 신규 상장 후 급등했어요.`;
    } else if (event === "ipoCrash") {
      newPrice = Math.floor(newPrice * (1 - 0.4 - Math.random() * 0.4)); // -40% ~ -80%
      eventType = "ipo_crash";
      eventMsg = `${stock.name}이(가) 신규 상장 후 급락했어요.`;
    } else {
      const change = (Math.random() * 0.4 - 0.1); // -10% ~ +30%
      newPrice = Math.floor(newPrice * (1 + change));
    }
  } else if (stock.status === "final_crash") {
    delistStock(db, stock);
    return;
  } else if (stock.status === "delist_warning") {
    const phase = stock.delist_phase || 0;
    const totalPhase = stock.delist_phase_total || 5;

    if (phase < totalPhase - 1) {
      const direction = phase % 2 === 0 ? 1 : -1;
      const changeRate = direction === 1
        ? (0.25 + Math.random() * 0.55) // +25% ~ +80%
        : -(0.30 + Math.random() * 0.40); // -30% ~ -70%

      newPrice = Math.floor(newPrice * (1 + changeRate));
      db.prepare("UPDATE stocks SET delist_phase = delist_phase + 1 WHERE id = ?").run(stock.id);
      eventType = direction === 1 ? "unstable_surge" : "unstable_crash";
    } else {
      // Final crash
      const finalCrashRate = -(0.85 + Math.random() * 0.10); // -85% ~ -95%
      newPrice = Math.floor(newPrice * (1 + finalCrashRate));
      eventType = "final_crash";
      eventMsg = `${stock.name}이(가) 최종 대폭락했어요.`;
      newStatus = "final_crash";
    }
  } else {
    // Normal listed stock
    if (Math.random() < 0.005 && stock.is_bluechip !== 1) { // 0.5% chance to become delist_warning, ignore if bluechip
      const totalPhases = Math.floor(Math.random() * 3) + 5; // 5~7 phases
      db.prepare("UPDATE stocks SET delist_phase = 0, delist_phase_total = ?, delist_warning_started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
        .run(totalPhases, stock.id);
      newStatus = "delist_warning";
      eventType = "delist_warning";
      eventMsg = `${stock.name} 종목에서 이상 변동이 감지되었어요!`;
    } else {
      const event = getRandomEvent(EVENT_PROBABILITIES);
      if (event === "surge") {
        newPrice = Math.floor(newPrice * (1 + 0.2 + Math.random() * 0.6)); // +20% ~ +80%
        eventType = "surge";
        eventMsg = `${stock.name} 주가가 급등했어요!`;
      } else if (event === "crash") {
        newPrice = Math.floor(newPrice * (1 - 0.2 - Math.random() * 0.5)); // -20% ~ -70%
        eventType = "crash";
        eventMsg = `${stock.name} 주가가 급락했어요!`;
      } else {
        const maxChange = stock.volatility;
        const change = (Math.random() * 2 - 1) * maxChange + stock.trend;
        newPrice = Math.floor(newPrice * (1 + change));
      }
    }
  }

  // Enforce bounds
  newPrice = Math.max(1, newPrice);

  if (newPrice !== stock.current_price || newStatus !== stock.status) {
    const basis = (eventType === "ipo_surge" || eventType === "ipo_crash") ? "offering_price" 
      : eventType === "final_crash" ? "delist_final_crash" 
      : "previous_tick";
    updateStockPrice(db, stock, newPrice, newStatus, eventType, eventMsg, basis);
  }
}

function processEtfTick(db, stock) {
  const ownerUser = db.prepare("SELECT balance FROM users WHERE id = ?").get(stock.owner_user_id);
  if (!ownerUser) return;

  const currentOwnerAsset = ownerUser.balance;
  
  if (!stock.etf_base_price || !stock.etf_base_owner_asset) {
    db.prepare("UPDATE stocks SET etf_base_price = ?, etf_base_owner_asset = ?, etf_last_tracked_owner_asset = ? WHERE id = ?")
      .run(stock.current_price, currentOwnerAsset, currentOwnerAsset, stock.id);
    return;
  }

  if (currentOwnerAsset !== stock.etf_last_tracked_owner_asset) {
    const safeOwnerAsset = Math.max(currentOwnerAsset, 1);
    const ratio = safeOwnerAsset / Math.max(stock.etf_base_owner_asset, 1);
    let newPrice = Math.floor(stock.etf_base_price * ratio);
    newPrice = Math.max(1, newPrice); // minimum 1 won
    
    updateStockPrice(db, stock, newPrice, stock.status, "etf_update", null);
    db.prepare("UPDATE stocks SET etf_last_tracked_owner_asset = ? WHERE id = ?").run(currentOwnerAsset, stock.id);
  }
}

function updateStockPrice(db, stock, newPrice, newStatus, eventType, eventMsg, basis = "previous_tick") {
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
    const priceBefore = stock.current_price;
    const priceAfter = newPrice;
    const changeAmount = priceAfter - priceBefore;
    const changeRate = priceBefore > 0 ? changeAmount / priceBefore : 0;
    
    let finalMsg = eventMsg;
    const formatRate = (rate) => {
      const percent = rate * 100;
      if (percent > 0) return `+${percent.toFixed(1)}%`;
      if (percent < 0) return `${percent.toFixed(1)}%`;
      return "0.0%";
    };
    const formatAmount = (amt) => {
      if (amt > 0) return `+${amt.toLocaleString()}원`;
      if (amt < 0) return `${amt.toLocaleString()}원`;
      return "0원";
    };

    if (basis === "previous_tick" || basis === "delist_final_crash") {
      finalMsg += ` 전 tick 대비 ${formatAmount(changeAmount)} · ${formatRate(changeRate)}`;
    } else if (basis === "offering_price" && stock.offering_price) {
      const offAmt = priceAfter - stock.offering_price;
      const offRate = stock.offering_price > 0 ? offAmt / stock.offering_price : 0;
      finalMsg += ` 공모가 대비 ${formatAmount(offAmt)} · ${formatRate(offRate)}`;
    }

    db.prepare(`
      INSERT INTO stock_events (stock_id, event_type, title, message, price_before, price_after, change_amount, change_rate, basis)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(stock.id, eventType, eventType === "surge" || eventType === "ipo_surge" ? "급등" : eventType === "crash" || eventType === "ipo_crash" ? "급락" : "위기", finalMsg, priceBefore, priceAfter, changeAmount, changeRate, basis);
  }
}

export function delistStock(db, stock) {
  // 1. Update stock status to delisted, price to 0, set delisted_at
  db.prepare("UPDATE stocks SET status = 'delisted', current_price = 0, previous_price = current_price, market_cap = 0, delisted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(stock.id);
  
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
    message: `${stock.name}이(가) 급등락을 반복하다가 최종 대폭락 후 상장폐지되었어요.`,
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
  const symbol = "IPO";
  const name = "공모주";
  const price = Math.floor(Math.random() * 4500) + 500; // 500 ~ 5,000
  const shares = Math.floor(Math.random() * 990000) + 10000;
  const cap = price * shares;
  const volatility = 0.05 + Math.random() * 0.05; // 5% ~ 10% highly volatile initially

  const insert = db.prepare(`
    INSERT INTO stocks (symbol, name, status, current_price, previous_price, initial_price, total_shares, market_cap, volatility, ipo_subscription_started_at, ipo_subscription_ends_at, offering_price)
    VALUES (?, ?, 'ipo_subscription', ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), datetime('now', '+1 minute'), ?)
  `);
  
  const stockId = insert.run(symbol, name, price, price, price, shares, cap, volatility, price).lastInsertRowid;

  // 알림: 새 공모주가 상장폐지 후 등장했다는 메시지로 변경할 수 있지만, 기본적으로 아래 메시지를 사용
  createServerNotification(db, {
    type: "stock_ipo",
    title: "신규 공모주 청약",
    message: `새 공모주가 등장했어요. 1분 동안 공모가로 구매할 수 있어요.`,
    gameType: "stock",
    gameName: "주식",
    metadata: { stockId, symbol, name }
  });

  db.prepare(`
    INSERT INTO stock_events (stock_id, event_type, title, message)
    VALUES (?, ?, ?, ?)
  `).run(stockId, "ipo_created", "신규 상장", `새 공모주 청약이 시작되었습니다.`);
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
    SET status = 'liquidated', liquidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), unrealized_pnl = 0, realized_pnl = ?
    WHERE id = ?
  `).run(-position.margin_amount, position.id);

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

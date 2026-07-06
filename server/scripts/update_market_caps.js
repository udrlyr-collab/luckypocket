import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'database.sqlite');
const db = new Database(dbPath);

const MARKET_CAP_TIERS = [
  { key: "small", label: "소형주", min: 10_000_000_000, max: 50_000_000_000, weight: 30 },
  { key: "small_mid", label: "중소형주", min: 50_000_000_000, max: 300_000_000_000, weight: 28 },
  { key: "mid", label: "중형주", min: 300_000_000_000, max: 2_000_000_000_000, weight: 22 },
  { key: "large", label: "대형주", min: 2_000_000_000_000, max: 20_000_000_000_000, weight: 14 },
  { key: "mega", label: "초대형주", min: 20_000_000_000_000, max: 100_000_000_000_000, weight: 5 },
  { key: "giant", label: "대표 대형주", min: 100_000_000_000_000, max: 250_000_000_000_000, weight: 1 }
];

function pickWeightedTier() {
  const totalWeight = MARKET_CAP_TIERS.reduce((sum, tier) => sum + tier.weight, 0);
  let random = Math.random() * totalWeight;
  for (const tier of MARKET_CAP_TIERS) {
    random -= tier.weight;
    if (random <= 0) return tier;
  }
  return MARKET_CAP_TIERS[0];
}

function randomBetweenInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function migrateStocks() {
  console.log('Starting market cap migration for existing stocks...');
  
  const stocks = db.prepare(`SELECT * FROM stocks WHERE status != 'delisted' AND is_etf = 0`).all();
  
  const updateStock = db.prepare(`
    UPDATE stocks
    SET total_shares = ?, market_cap = ?
    WHERE id = ?
  `);
  
  db.transaction(() => {
    for (const stock of stocks) {
      if (stock.is_bluechip === 1 && stock.market_cap >= 2_000_000_000_000) {
        // 이미 대형주/초대형주인 우량주는 굳이 깎아내리지 않아도 무방하지만,
        // 너무 말도 안되는 400조 이상이 있는지 체크
        if (stock.market_cap > 250_000_000_000_000) {
          const tier = MARKET_CAP_TIERS[4]; // mega
          const targetCap = randomBetweenInt(tier.min, tier.max);
          const totalShares = Math.max(1000, Math.floor(targetCap / stock.current_price));
          const newCap = totalShares * stock.current_price;
          updateStock.run(totalShares, newCap, stock.id);
          console.log(`Updated overly massive blue chip ${stock.name} to ${newCap}`);
        } else {
          console.log(`Skipped existing valid blue chip ${stock.name} (${stock.market_cap})`);
        }
        continue;
      }
      
      const tier = pickWeightedTier();
      const targetCap = randomBetweenInt(tier.min, tier.max);
      
      // 가격은 유지하고 발행량을 조작하여 시가총액을 맞춤
      const totalShares = Math.max(1000, Math.floor(targetCap / stock.current_price));
      const newCap = totalShares * stock.current_price;
      
      updateStock.run(totalShares, newCap, stock.id);
      console.log(`Updated ${stock.name}: ${stock.market_cap} -> ${newCap} (${tier.label})`);
    }
  })();
  
  console.log('Migration complete!');
}

migrateStocks();

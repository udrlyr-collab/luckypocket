import Database from "better-sqlite3";
import path from "node:path";

const dbPath = path.resolve("c:/Users/홍성민/OneDrive/문서/gamble/data/lucky-pocket.db");
const db = new Database(dbPath);

console.log("=========================================");
console.log("📈 행운주머니 주식시장 데이터 분석 📉");
console.log(`분석 시각: ${new Date().toLocaleString()}`);
console.log("=========================================\n");

// 1. 시장 요약
const totalStocks = db.prepare("SELECT COUNT(*) AS count FROM stocks").get().count;
const listedStocks = db.prepare("SELECT COUNT(*) AS count FROM stocks WHERE status != 'delisted'").get().count;
const delistedStocks = db.prepare("SELECT COUNT(*) AS count FROM stocks WHERE status = 'delisted'").get().count;
const blueChips = db.prepare("SELECT COUNT(*) AS count FROM stocks WHERE is_bluechip = 1 AND status != 'delisted'").get().count;
const etfs = db.prepare("SELECT COUNT(*) AS count FROM stocks WHERE is_etf = 1 AND status != 'delisted'").get().count;

console.log("📂 [1] 시장 기본 통계");
console.log(`- 전체 등록 종목 수: ${totalStocks}개`);
console.log(`  * 거래 가능한 상장 종목: ${listedStocks}개`);
console.log(`  * 상장 폐지된 종목: ${delistedStocks}개`);
console.log(`  * 우량주(Blue Chip): ${blueChips}개`);
console.log(`  * ETF 종목: ${etfs}개\n`);

// 2. 가격 및 시가총액 통계 (상장 종목 기준)
const stats = db.prepare(`
  SELECT 
    AVG(current_price) AS avg_price,
    MIN(current_price) AS min_price,
    MAX(current_price) AS max_price,
    AVG(market_cap) AS avg_cap,
    SUM(market_cap) AS total_cap
  FROM stocks 
  WHERE status != 'delisted'
`).get();

const formatWon = (value) => {
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}조 원`;
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}억 원`;
  return `${Math.floor(value).toLocaleString()}원`;
};

console.log("💰 [2] 주가 및 시가총액 통계 (상장 종목)");
console.log(`- 시장 총 시가총액: ${formatWon(stats.total_cap)}`);
console.log(`- 평균 시가총액: ${formatWon(stats.avg_cap)}`);
console.log(`- 평균 주가: ${formatWon(stats.avg_price)}`);
console.log(`- 최고 주가: ${formatWon(stats.max_price)}`);
console.log(`- 최저 주가: ${formatWon(stats.min_price)}\n`);

// 3. 주요 종목 순위
console.log("🏆 [3] 시가총액 상위 5개 종목");
const topCap = db.prepare("SELECT name, symbol, current_price, market_cap FROM stocks WHERE status != 'delisted' ORDER BY market_cap DESC LIMIT 5").all();
topCap.forEach((s, idx) => {
  console.log(`  ${idx + 1}. ${s.name} (${s.symbol}) - 주가: ${s.current_price.toLocaleString()}원 | 시총: ${formatWon(s.market_cap)}`);
});
console.log("");

// 4. 최근 활성화된 시장 상태 (Market Regime)
const regime = db.prepare("SELECT * FROM market_regimes ORDER BY id DESC LIMIT 1").get();
console.log("🌐 [4] 현재 시장 정국 (Market Regime)");
if (regime) {
  const ends = new Date(regime.ends_at);
  const now = new Date();
  const leftMin = Math.round((ends - now) / 60000);
  console.log(`- 상태: ${regime.market_regime} (강도: ${regime.strength})`);
  console.log(`- 시작: ${new Date(regime.started_at).toLocaleString()}`);
  console.log(`- 종료 예정: ${ends.toLocaleString()} (${leftMin > 0 ? `${leftMin}분 남음` : '만료됨'})\n`);
} else {
  console.log("- 활성화된 시장 정국 정보 없음\n");
}

// 5. 상장폐지 위험 상태
const riskStocks = db.prepare(`
  SELECT name, delist_risk_status, current_price, market_cap 
  FROM stocks 
  WHERE delist_risk_status IS NOT NULL AND delist_risk_status != 'normal' AND status != 'delisted'
`).all();

console.log("⚠️ [5] 상장폐지 위험/심사 종목");
if (riskStocks.length > 0) {
  riskStocks.forEach((s) => {
    console.log(`  * ${s.name} - 상태: ${s.delist_risk_status} | 주가: ${s.current_price.toLocaleString()}원 | 시총: ${formatWon(s.market_cap)}`);
  });
} else {
  console.log("  - 현재 위험 종목이 없습니다.\n");
}

db.close();

import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { formatMoney, formatSignedMoney, formatCompactMoney } from "../utils/format";
import AnimatedMoney from "../components/AnimatedMoney";
import { StockRiskBadges } from "../components/StockRiskStatus";

export default function StockMarketPage() {
  const [market, setMarket] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [news, setNews] = useState([]);
  const [timer, setTimer] = useState(10);
  const loading = !market || !portfolio;

  const fetchMarket = async () => {
    try {
      const data = await api("/stocks/market-snapshot");
      setMarket(prev => ({
        ...prev,
        stocks: data.stocks,
        summary: prev ? prev.summary : { listed: data.stocks.length },
        marketOpen: data.marketOpen,
      }));
      setPortfolio(data.portfolio);
      setTimer(data.nextTickInSeconds);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchFullMarket = async () => {
    try {
      const data = await api("/stocks");
      setMarket(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchNews = async () => {
    try {
      const data = await api("/stocks/news");
      setNews(data.news);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchFullMarket().then(() => fetchMarket());
    fetchNews();

    const fastInterval = setInterval(() => {
      fetchMarket();
    }, 2000);

    const newsInterval = setInterval(() => {
      fetchNews();
    }, 10000);

    return () => {
      clearInterval(fastInterval);
      clearInterval(newsInterval);
    };
  }, []);

  useEffect(() => {
    const timerInterval = setInterval(() => {
      setTimer((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timerInterval);
  }, []);

  if (loading) {
    return (
      <div className="page-content text-center py-20">
        <span className="loading loading-spinner loading-lg text-primary" />
        <p className="mt-4 font-bold">주식 시장을 불러오는 중...</p>
      </div>
    );
  }

  const { stocks, recentDelistedStocks, summary } = market;
  const { holdings, positions } = portfolio;

  const totalHoldingsValue = holdings.reduce((sum, h) => sum + h.value, 0);
  const totalHoldingsUnrealized = holdings.reduce((sum, h) => sum + h.unrealized_pnl, 0);
  const totalPositionsUnrealized = positions.reduce((sum, p) => sum + p.live_unrealized_pnl, 0);
  const totalMargin = positions.reduce((sum, p) => sum + p.margin_amount, 0);

  return (
    <div className="page-content">
      <div className="mb-6 rounded-2xl bg-base-200 p-4 text-center">
        <p className="text-sm font-bold text-base-content/70">
          실제 투자가 아닌 행운주머니 내부 수치 게임입니다.<br />
          현금 결제·출금이 없는 가상 주식 시장이에요.<br />
          시가총액이 3틱 연속 60억원 미만이면 거래주의, 50억원 미만이면 상장폐지 심사에 들어갑니다.
        </p>
      </div>

      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Lucky Exchange</p>
          <h1 className="text-3xl font-black">주식 시장</h1>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold text-base-content/50">다음 갱신까지</p>
          <p className="text-xl font-black text-primary">{timer}초</p>
        </div>
      </header>

      {market.marketOpen === false && (
        <div className="alert alert-warning mb-6 rounded-2xl font-bold">
          <span>⏸ 현재 주식장은 휴장 중이에요. 가격 갱신과 모든 거래가 일시 중지됐어요.</span>
        </div>
      )}

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="soft-card bg-gradient-to-br from-base-100 to-base-200/50 shadow-sm border border-base-200/50 min-w-0 p-4 rounded-2xl hover:shadow-md transition-shadow">
          <span className="text-[11px] font-black text-base-content/50 uppercase tracking-wider">전체 종목</span>
          <strong className="block text-2xl mt-1 tabular-nums">{summary.total}</strong>
        </div>
        <div className="soft-card bg-gradient-to-br from-base-100 to-base-200/50 shadow-sm border border-base-200/50 min-w-0 p-4 rounded-2xl hover:shadow-md transition-shadow">
          <span className="text-[11px] font-black text-base-content/50 uppercase tracking-wider">상승 / 하락</span>
          <strong className="block text-2xl mt-1 tabular-nums text-success">{summary.up} <span className="text-base-content/30 text-lg">/</span> <span className="text-error">{summary.down}</span></strong>
        </div>
        <div className="soft-card bg-gradient-to-br from-base-100 to-base-200/50 shadow-sm border border-base-200/50 min-w-0 p-4 rounded-2xl hover:shadow-md transition-shadow">
          <span className="text-[11px] font-black text-base-content/50 uppercase tracking-wider">공모주/신규 상장</span>
          <strong className="block text-2xl mt-1 tabular-nums text-warning">{summary.ipo}</strong>
        </div>
        <div className="soft-card bg-gradient-to-br from-base-100 to-base-200/50 shadow-sm border border-base-200/50 min-w-0 p-4 rounded-2xl hover:shadow-md transition-shadow">
          <span className="text-[11px] font-black text-base-content/50 uppercase tracking-wider">최근 상장폐지</span>
          <strong className="block text-2xl mt-1 tabular-nums text-base-content/40">{recentDelistedStocks ? recentDelistedStocks.length : 0}</strong>
        </div>
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="section-title text-xl mb-4">시장 종목</h2>
          <div className="bg-base-100 rounded-2xl p-2 sm:p-4 shadow-sm border border-base-200">
            <div className="hidden sm:flex text-xs font-bold text-base-content/50 px-4 pb-2 border-b border-base-200 mb-2">
              <div className="flex-[2]">종목명</div>
              <div className="flex-1 text-right">현재가</div>
              <div className="flex-1 text-right">등락률</div>
              <div className="flex-1 text-right">시가총액</div>
            </div>
            <div className="grid gap-1">
              {stocks.map(stock => (
                <StockRow key={stock.id} stock={stock} />
              ))}
              {recentDelistedStocks && recentDelistedStocks.length > 0 && (
                <div className="mt-4 pt-4 border-t border-base-200">
                  <div className="text-xs font-bold text-base-content/50 mb-2 px-2">최근 상장폐지 (최근 5개)</div>
                  <div className="grid gap-1 opacity-60">
                    {recentDelistedStocks.map(stock => (
                      <StockRow key={stock.id} stock={stock} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div>
          <h2 className="section-title text-xl mb-4">내 포트폴리오</h2>
          <div className="soft-card mb-4 p-4 border-2 border-primary/20">
            <h3 className="text-xs font-bold text-base-content/50 mb-2">총 평가 자산</h3>
            <div className="text-2xl font-black">
              <AnimatedMoney value={portfolio.totalEvaluatedAsset || (totalHoldingsValue + totalMargin + totalPositionsUnrealized)} />
            </div>
            <div className={`text-sm font-bold mt-1 ${portfolio.unrealizedPnl >= 0 ? "text-success" : "text-error"}`}>
              {portfolio.unrealizedPnl >= 0 ? "+" : ""}<AnimatedMoney value={portfolio.unrealizedPnl} />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-bold mb-2">보유 주식 (현물)</h4>
              {holdings.length === 0 ? (
                <p className="text-xs text-base-content/50">보유한 주식이 없어요.</p>
              ) : (
                <div className="grid gap-2">
                  {holdings.map(h => (
                    <Link to={`/stocks/${h.stock_id}`} key={h.id} className="block bg-base-200/50 p-3 rounded-2xl hover:bg-base-200 transition">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-sm">{h.name}</span>
                        <span className="text-xs">{h.quantity.toFixed(2)}주</span>
                      </div>
                      <div className="flex justify-between items-end">
                        <span className="text-xs text-base-content/50">평가금 {formatMoney(h.value)}</span>
                        <span className={`text-xs font-bold ${h.unrealized_pnl >= 0 ? "text-success" : "text-error"}`}>
                          {formatSignedMoney(h.unrealized_pnl)}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="text-sm font-bold mb-2">레버리지 포지션</h4>
              {positions.length === 0 ? (
                <p className="text-xs text-base-content/50">열려있는 포지션이 없어요.</p>
              ) : (
                <div className="grid gap-2">
                  {positions.map(p => {
                    const danger = p.stock_current_price <= p.entry_price - (p.entry_price - p.liquidation_price) * 0.8;
                    return (
                      <Link to={`/stocks/${p.stock_id}`} key={p.id} className={`block bg-base-200/50 p-3 rounded-2xl hover:bg-base-200 transition border ${danger ? "border-error/50" : "border-transparent"}`}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold text-sm">{p.name} <span className="text-[10px] bg-secondary/20 text-secondary-content px-1.5 py-0.5 rounded-lg ml-1">{p.leverage}x</span></span>
                          {danger && <span className="text-[10px] font-bold text-error animate-pulse">위험</span>}
                        </div>
                        <div className="flex justify-between items-end">
                          <span className="text-xs text-base-content/50">증거금 {formatMoney(p.margin_amount)}</span>
                          <span className={`text-xs font-bold ${p.live_unrealized_pnl >= 0 ? "text-success" : "text-error"}`}>
                            {formatSignedMoney(p.live_unrealized_pnl)}
                          </span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <section>
        <h2 className="section-title text-xl mb-4">최근 시장 뉴스</h2>
        <div className="soft-card p-0 overflow-hidden">
          {news.length === 0 ? (
            <div className="p-6 text-center text-sm text-base-content/50">최근 소식이 없어요.</div>
          ) : (
            <ul className="divide-y divide-base-300">
              {news.map(n => (
                <li key={n.id} className="p-4 flex flex-col sm:flex-row gap-2 sm:items-center">
                  <Badge type={n.event_type} label={n.title} />
                  <span className="text-sm text-base-content/80 flex-1">{n.message}</span>
                  <span className="text-[10px] text-base-content/40 whitespace-nowrap">
                    {new Date(n.created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function StockRow({ stock }) {
  const isDelisted = stock.status === 'delisted';
  const isUp = stock.priceChangeAmount > 0;
  const isDown = stock.priceChangeAmount < 0;
  const color = isUp ? "text-success" : isDown ? "text-error" : "text-base-content";
  
  return (
    <Link to={`/stocks/${stock.id}`} className="group flex flex-col sm:flex-row sm:items-center p-3 rounded-xl hover:bg-base-200/50 transition border border-transparent hover:border-base-200/50">
      <div className="flex-[2] flex items-center min-w-0 mb-1 sm:mb-0">
        <h3 className="font-black text-base truncate mr-2">{stock.name}</h3>
        <div className="flex gap-1 shrink-0 flex-wrap">
          {stock.status === 'ipo_subscription' && <span className="badge badge-warning badge-xs py-1 font-bold">공모주</span>}
          {stock.status === 'newly_listed' && <span className="badge badge-warning badge-xs py-1 font-bold">신규 상장</span>}
          {stock.status === 'acquired' && <span className="badge badge-primary badge-xs py-1 font-bold">인수됨</span>}
          <StockRiskBadges stock={stock} compact />
          {Boolean(stock.is_etf) && <span className="badge badge-outline badge-primary badge-xs py-1 font-bold">인수자 ETF</span>}
          {stock.is_bluechip === 1 && <span className="badge badge-info badge-xs py-1 font-bold">우량주</span>}
          {stock.is_trading_suspended === 1 && <span className="badge badge-error badge-xs py-1 font-bold">거래 정지</span>}
          {isDelisted && <span className="badge badge-ghost badge-xs py-1 font-bold">상장폐지</span>}
        </div>
      </div>
      
      <div className="flex-[3] flex justify-between sm:justify-end items-end sm:items-center mt-1 sm:mt-0">
        <div className={`flex-1 sm:text-right font-black tabular-nums ${isDelisted ? "text-base-content/30" : ""}`}>
          {formatMoney(stock.current_price)}
        </div>
        
        <div className={`flex-1 text-right text-xs font-bold tabular-nums shrink-0 transition-colors duration-500 ${isDelisted ? "opacity-0" : color}`}>
          {isUp ? "+" : ""}{formatMoney(stock.priceChangeAmount)}<br className="sm:hidden"/>
          <span className="sm:ml-1 text-[10px] opacity-80">({isUp ? "+" : ""}{(stock.priceChangeRate * 100).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)</span>
        </div>

        <div className="flex-1 text-right text-[11px] text-base-content/50 truncate hidden sm:block">
          {stock.is_etf ? (
            <span className="text-primary">{stock.owner_nickname_snapshot}</span>
          ) : stock.status === 'ipo_subscription' || stock.status === 'newly_listed' ? (
            <span className="text-warning">공모가 {formatCompactMoney(stock.offering_price)}</span>
          ) : (
            formatCompactMoney(stock.market_cap)
          )}
        </div>
      </div>
    </Link>
  );
}

function Badge({ type, label }) {
  let colorClass = "bg-base-200 text-base-content";
  if (type === "surge" || type === "ipo_surge") colorClass = "bg-success/20 text-success";
  else if (type === "crash" || type === "ipo_crash") colorClass = "bg-error/20 text-error";
  else if (type === "ipo_created") colorClass = "bg-warning/20 text-warning-content";
  else if (type === "acquired" || type === "etf_converted") colorClass = "bg-primary/20 text-primary";
  else if (type === "delisted" || type === "delist_warning") colorClass = "bg-error/20 text-error";

  return <span className={`text-[10px] font-black px-2 py-1 rounded-lg shrink-0 text-center ${colorClass}`}>{label}</span>;
}

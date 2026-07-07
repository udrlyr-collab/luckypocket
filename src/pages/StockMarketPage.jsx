import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatMoney, formatSignedMoney, formatCompactMoney } from "../utils/format";
import AnimatedMoney from "../components/AnimatedMoney";
import { StockRiskBadges, StockTierBadge } from "../components/StockRiskStatus";
import { PageContainer, SectionHeader, BaseCard } from "../components/ui";
import { useMarketClock } from "../hooks/useMarketClock";

export default function StockMarketPage() {
  const { user } = useAuth();
  const isAdmin = user && (user.isAdmin || user.username === 'admin');
  const [market, setMarket] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [news, setNews] = useState([]);
  const [busy, setBusy] = useState(false);
  const lastIpoRefreshRef = useRef(0);
  const [blueChipModalOpen, setBlueChipModalOpen] = useState(false);
  const [blueChipStock, setBlueChipStock] = useState(null);
  const [blueChipTargetPrice, setBlueChipTargetPrice] = useState("");
  const [blueChipRampPercent, setBlueChipRampPercent] = useState("30");
  const [blueChipReason, setBlueChipReason] = useState("우량주 편입 이벤트");
  const loading = !market || !portfolio;
  const {
    serverNow,
    nextTickRemainingSeconds,
    remainingSecondsUntil,
  } = useMarketClock({
    serverTime: market?.serverTime,
    nextTickAt: market?.nextTickAt,
  });

  const handleAdminAction = async (endpoint) => {
    if (!window.confirm("정말 실행하시겠습니까?")) return;
    setBusy(true);
    try {
      const isDelete = endpoint.includes('method=DELETE');
      const path = endpoint.split('?')[0];
      await api(path, { method: isDelete ? "DELETE" : "POST" });
      await fetchMarket();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openBlueChipModal = (stock) => {
    setBlueChipStock(stock);
    setBlueChipTargetPrice("");
    setBlueChipRampPercent("30");
    setBlueChipReason("우량주 편입 이벤트");
    setBlueChipModalOpen(true);
  };

  const submitBlueChip = async () => {
    if (!blueChipStock || blueChipTargetPrice === "" || blueChipRampPercent === "") return;
    setBusy(true);
    try {
      await api(`/admin/stocks/${blueChipStock.id}/blue-chip`, {
        method: "POST",
        body: JSON.stringify({
          targetPrice: Number(blueChipTargetPrice),
          rampPercentPerTick: Number(blueChipRampPercent),
          reason: blueChipReason,
        })
      });
      setBlueChipModalOpen(false);
      await fetchMarket();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const fetchMarket = async () => {
    try {
      const data = await api("/stocks/market-snapshot");
      setMarket(prev => ({
        ...prev,
        stocks: data.stocks,
        summary: data.summary || (prev ? prev.summary : { listed: data.stocks.length }),
        marketOpen: data.marketOpen,
        serverTime: data.serverTime,
        nextTickAt: data.nextTickAt,
        tickIntervalSeconds: data.tickIntervalSeconds,
      }));
      setPortfolio(data.portfolio);
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
    if (!market?.stocks?.length) return;
    const hasExpiredIpo = market.stocks.some((stock) => {
      if (stock.status !== "ipo_subscription") return false;
      const remaining = remainingSecondsUntil(
        stock.ipoSubscriptionEndsAt || stock.ipo_subscription_ends_at,
      );
      return remaining === 0;
    });
    if (!hasExpiredIpo) return;
    const now = Date.now();
    if (now - lastIpoRefreshRef.current < 1500) return;
    lastIpoRefreshRef.current = now;
    fetchMarket();
  }, [serverNow, market?.stocks]);

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
    <PageContainer>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionHeader title="주식 시장" eyebrow="LUCKY EXCHANGE" className="mb-0" />
          <div className="flex items-center gap-4 mt-2">
            {isAdmin && (
              <div className="flex gap-2">
                {market.marketOpen ? (
                  <button className="btn btn-xs btn-error" disabled={busy} onClick={() => handleAdminAction("/admin/stocks/market/close")}>주식장 닫기</button>
                ) : (
                  <button className="btn btn-xs btn-success" disabled={busy} onClick={() => handleAdminAction("/admin/stocks/market/open")}>주식장 열기</button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold text-base-content/50">다음 갱신까지</p>
          <p className="text-xl font-black text-primary">
            {nextTickRemainingSeconds ?? "-"}초
          </p>
        </div>
      </header>

      {market.marketOpen === false && (
        <div className="alert alert-warning mb-6 rounded-2xl font-bold">
          <span>⏸ 현재 주식장은 휴장 중이에요. 가격 갱신과 모든 거래가 일시 중지됐어요.</span>
        </div>
      )}

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <BaseCard className="bg-gradient-to-br from-base-100 to-base-200/50 shadow-sm border border-base-200/50 min-w-0 p-4 rounded-2xl hover:shadow-md transition-shadow">
          <span className="text-[11px] font-black text-base-content/50 uppercase tracking-wider">상장 종목</span>
          <strong className="block text-2xl mt-1 tabular-nums">
            {summary.activeTradableStockCount ?? summary.total}
            <span className="ml-1 text-sm text-base-content/40">/ {summary.targetActiveTradableStockCount ?? 16}</span>
          </strong>
        </BaseCard>
        <BaseCard className="bg-gradient-to-br from-base-100 to-base-200/50 shadow-sm border border-base-200/50 min-w-0 p-4 rounded-2xl hover:shadow-md transition-shadow">
          <span className="text-[11px] font-black text-base-content/50 uppercase tracking-wider">상승 / 하락</span>
          <strong className="block text-2xl mt-1 tabular-nums text-success">{summary.up} <span className="text-base-content/30 text-lg">/</span> <span className="text-error">{summary.down}</span></strong>
        </BaseCard>
        <BaseCard className="bg-gradient-to-br from-base-100 to-base-200/50 shadow-sm border border-base-200/50 min-w-0 p-4 rounded-2xl hover:shadow-md transition-shadow">
          <span className="text-[11px] font-black text-base-content/50 uppercase tracking-wider">공모주</span>
          <strong className="block text-2xl mt-1 tabular-nums text-warning">{summary.ipoCount ?? summary.ipo}</strong>
        </BaseCard>
        <BaseCard className="bg-gradient-to-br from-base-100 to-base-200/50 shadow-sm border border-base-200/50 min-w-0 p-4 rounded-2xl hover:shadow-md transition-shadow">
          <span className="text-[11px] font-black text-base-content/50 uppercase tracking-wider">최근 상장폐지</span>
          <strong className="block text-2xl mt-1 tabular-nums text-base-content/40">{summary.recentDelistedCount ?? (recentDelistedStocks ? recentDelistedStocks.length : 0)}</strong>
        </BaseCard>
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionHeader title="시장 종목" eyebrow="STOCKS" className="mb-4" />
          <div className="bg-base-100 rounded-2xl p-2 sm:p-4 shadow-sm border border-base-200">
            <div className="hidden sm:flex text-xs font-bold text-base-content/50 px-4 pb-2 border-b border-base-200 mb-2">
              <div className="flex-[2]">종목명</div>
              <div className="flex-1 text-right">현재가</div>
              <div className="flex-1 text-right">등락률</div>
              <div className="flex-1 text-right">시가총액</div>
            </div>
            <div className="grid gap-1">
              {stocks.map(stock => (
                <StockRow
                  key={stock.id}
                  stock={stock}
                  isAdmin={isAdmin}
                  handleAdminAction={handleAdminAction}
                  openBlueChipModal={openBlueChipModal}
                  remainingSecondsUntil={remainingSecondsUntil}
                />
              ))}
              {recentDelistedStocks && recentDelistedStocks.length > 0 && (
                <div className="mt-4 pt-4 border-t border-base-200">
                  <div className="text-xs font-bold text-base-content/50 mb-2 px-2">최근 상장폐지 (최근 5개)</div>
                  <div className="grid gap-1 opacity-60">
                    {recentDelistedStocks.map(stock => (
                      <StockRow
                        key={stock.id}
                        stock={stock}
                        isAdmin={isAdmin}
                        handleAdminAction={handleAdminAction}
                        openBlueChipModal={openBlueChipModal}
                        remainingSecondsUntil={remainingSecondsUntil}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div>
          <SectionHeader title="내 포트폴리오" eyebrow="PORTFOLIO" className="mb-4" />
          <BaseCard className="mb-4 p-4 border-2 border-primary/20">
            <h3 className="text-xs font-bold text-base-content/50 mb-2">총 평가 자산</h3>
            <div className="text-2xl font-black">
              <AnimatedMoney value={portfolio.totalEvaluatedAsset || (totalHoldingsValue + totalMargin + totalPositionsUnrealized)} />
            </div>
            <div className={`text-sm font-bold mt-1 ${portfolio.unrealizedPnl >= 0 ? "text-success" : "text-error"}`}>
              {portfolio.unrealizedPnl >= 0 ? "+" : ""}<AnimatedMoney value={portfolio.unrealizedPnl} />
            </div>
          </BaseCard>

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
                    const danger = p.side === "short"
                      ? p.stock_current_price >= p.entry_price + (p.liquidation_price - p.entry_price) * 0.8
                      : p.stock_current_price <= p.entry_price - (p.entry_price - p.liquidation_price) * 0.8;
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
        <SectionHeader title="최근 시장 뉴스" eyebrow="NEWS" className="mb-4" />
        <BaseCard className="p-0 overflow-hidden">
          {news.length === 0 ? (
            <div className="p-6 text-center text-sm text-base-content/50">최근 소식이 없어요.</div>
          ) : (
            <ul className="divide-y divide-base-300">
              {news.map(n => (
                <li key={n.id} className="p-4 flex flex-col sm:flex-row gap-2 sm:items-center">
                  <Badge type={n.event_type} label={n.title} sentiment={n.sentiment} />
                  <span className="text-sm text-base-content/80 flex-1">{n.message}</span>
                  <span className="text-[10px] text-base-content/40 whitespace-nowrap">
                    {new Date(n.created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </BaseCard>
      </section>

      {blueChipModalOpen && blueChipStock && (
        <div className="modal modal-open">
          <div className="modal-box rounded-3xl border border-base-300 shadow-xl max-w-md bg-base-100">
            <h3 className="font-black text-lg text-base-content mb-4">⭐ 우량주 선정 및 급등 시작</h3>
            <div className="text-sm text-base-content/70 mb-3">
              종목명: <strong className="text-base-content font-black">{blueChipStock.name}</strong>
            </div>

            <div className="grid gap-3">
              <div className="rounded-2xl bg-base-200/50 p-3 text-sm">
                <span className="text-xs font-bold text-base-content/50">현재가</span>
                <strong className="block text-primary text-base font-black">
                  {formatMoney(blueChipStock.currentPrice || blueChipStock.current_price)}
                </strong>
              </div>

              <label className="form-control">
                <span className="label-text mb-1 font-bold">목표주가</span>
                <input
                  className="input input-bordered w-full h-12 rounded-2xl"
                  type="number"
                  min="1"
                  value={blueChipTargetPrice}
                  onChange={(event) => setBlueChipTargetPrice(event.target.value)}
                  placeholder="예: 30000"
                />
              </label>

              <label className="form-control">
                <span className="label-text mb-1 font-bold">tick당 상승률 (%)</span>
                <input
                  className="input input-bordered w-full h-12 rounded-2xl"
                  type="number"
                  min="1"
                  max="100"
                  value={blueChipRampPercent}
                  onChange={(event) => setBlueChipRampPercent(event.target.value)}
                  placeholder="예: 30"
                />
              </label>

              <label className="form-control">
                <span className="label-text mb-1 font-bold">사유</span>
                <input
                  className="input input-bordered w-full h-12 rounded-2xl"
                  value={blueChipReason}
                  onChange={(event) => setBlueChipReason(event.target.value)}
                  placeholder="예: 우량주 편입 이벤트"
                  maxLength={120}
                />
              </label>
            </div>

            <div className="modal-action mt-6 gap-2">
              <button
                type="button"
                className="btn btn-outline rounded-2xl flex-1 h-12"
                onClick={() => setBlueChipModalOpen(false)}
              >
                취소
              </button>
              <button
                type="button"
                className="btn btn-primary rounded-2xl flex-1 h-12"
                disabled={busy || blueChipTargetPrice === "" || blueChipRampPercent === ""}
                onClick={submitBlueChip}
              >
                선택 및 급등 시작
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function StockRow({ stock, isAdmin, handleAdminAction, openBlueChipModal, remainingSecondsUntil }) {
  const isDelisted = stock.status === 'delisted';
  const isUp = stock.priceChangeAmount > 0;
  const isDown = stock.priceChangeAmount < 0;
  const color = isUp ? "text-success" : isDown ? "text-error" : "text-base-content";

  const ipoTimeRemaining = stock.status === "ipo_subscription"
    ? remainingSecondsUntil(stock.ipoSubscriptionEndsAt || stock.ipo_subscription_ends_at)
    : null;
  const ipoMins = Math.floor((ipoTimeRemaining || 0) / 60);
  const ipoSecs = (ipoTimeRemaining || 0) % 60;
  const offeringRate = Number(stock.offeringChangeRate || 0);
  const isIpoLimitNear = stock.status === 'newly_listed' && offeringRate >= 2.7;
  const isIpoOverheated = stock.status === 'newly_listed' && offeringRate >= 1.5;
  
  return (
    <Link to={`/stocks/${stock.id}`} className="group flex flex-col sm:flex-row sm:items-center p-3 rounded-xl hover:bg-base-200/50 transition border border-transparent hover:border-base-200/50">
      <div className="flex-[2] flex items-center min-w-0 mb-1 sm:mb-0">
        <h3 className="font-black text-base truncate mr-2">{stock.name}</h3>
        <div className="flex gap-1 shrink-0 flex-wrap">
          {stock.status === 'ipo_subscription' && ipoTimeRemaining !== null && (
             <span className="badge badge-warning badge-xs py-1 font-bold">
               {ipoTimeRemaining === 0
                 ? "상장 처리 중..."
                 : `상장까지 ${ipoMins > 0 ? `${ipoMins}분 ` : ""}${ipoSecs}초`}
             </span>
          )}
          {stock.status === 'newly_listed' && <span className="badge badge-warning badge-xs py-1 font-bold">신규 상장</span>}
          {isIpoLimitNear && <span className="badge badge-error badge-xs py-1 font-bold">상한 근접</span>}
          {!isIpoLimitNear && isIpoOverheated && <span className="badge badge-warning badge-xs py-1 font-bold">공모주 과열</span>}
          {stock.status === 'acquired' && <span className="badge badge-primary badge-xs py-1 font-bold">인수됨</span>}
          {Boolean(stock.is_etf) && <span className="badge badge-outline badge-primary badge-xs py-1 font-bold">인수자 ETF</span>}
          {stock.is_bluechip === 1 && <span className="badge badge-info badge-xs py-1 font-bold">우량주</span>}
          {stock.blueChipRampActive && (
            <span className="badge badge-error badge-xs py-1 font-bold text-white">목표주가 진행 중</span>
          )}
          {stock.adminPriceTargetActive && (
            <span className="badge badge-warning badge-xs py-1 font-bold">목표주가 진행 중</span>
          )}
          <StockTierBadge stock={stock} compact />
          {stock.is_trading_suspended === 1 && <span className="badge badge-error badge-xs py-1 font-bold">거래 정지</span>}
          {isDelisted && <span className="badge badge-ghost badge-xs py-1 font-bold">상장폐지</span>}
          <StockRiskBadges stock={stock} compact />

          {(stock.blueChipRampActive || stock.adminPriceTargetActive) && (
            <span className="text-[10px] font-bold text-base-content/65 ml-1">
              {stock.blueChipRampActive ? (
                `+${stock.blueChipRampPercentPerTick}%/틱 · 도달률 ${Math.min(100, Math.floor((stock.currentPrice / stock.blueChipTargetPrice) * 100))}%`
              ) : (
                `${stock.adminPriceTargetDirection === "up" ? "+" : "-"}${stock.adminPriceTargetPercentPerTick}%/틱 · 도달률 ${Math.min(100, Math.floor((stock.currentPrice / stock.adminPriceTarget) * 100))}%`
              )}
            </span>
          )}
          
          {isAdmin && !isDelisted && (
            <div className="flex gap-1 ml-2 border-l border-base-200 pl-2">
              {stock.is_bluechip === 1 ? (
                <button className="btn btn-xs btn-outline btn-warning" onClick={(e) => { e.preventDefault(); handleAdminAction(`/admin/stocks/${stock.id}/blue-chip?method=DELETE`); }}>우량주 취소</button>
              ) : stock.status !== 'ipo_subscription' && stock.status !== 'newly_listed' && !stock.is_etf ? (
                <button className="btn btn-xs btn-outline btn-info" onClick={(e) => { e.preventDefault(); openBlueChipModal(stock); }}>우량주 선정</button>
              ) : null}
            </div>
          )}
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

function Badge({ type, label, sentiment }) {
  let colorClass = "bg-base-200 text-base-content";
  let displayLabel = label;

  if (type === "surge" || type === "ipo_surge" || type === "ipo_strong_surge" || type === "ipo_mega_surge") {
    colorClass = "bg-success/20 text-success";
  } else if (type === "crash" || type === "ipo_crash") {
    colorClass = "bg-error/20 text-error";
  } else if (type === "ipo_created" || type === "ipo_normal_open" || type === "ipo_overheated") {
    colorClass = "bg-warning/20 text-warning-content";
  } else if (type === "ipo_limit_near") {
    colorClass = "bg-error/20 text-error";
  } else if (type === "acquired" || type === "etf_converted") {
    colorClass = "bg-primary/20 text-primary";
  } else if (type === "delisted" || type === "delist_warning") {
    colorClass = "bg-error/20 text-error";
  } else if (type === "admin_good_news") {
    colorClass = "bg-success/20 text-success";
    displayLabel = `[호재] ${label}`;
  } else if (type === "admin_bad_news") {
    colorClass = "bg-error/20 text-error";
    displayLabel = `[악재] ${label}`;
  } else if (type === "admin_blue_chip_selected") {
    colorClass = "bg-primary/20 text-primary";
    displayLabel = `[호재] [우량주 선정]`;
  } else if (type === "admin_price_target_started") {
    if (sentiment === "bad") {
      colorClass = "bg-error/20 text-error";
      displayLabel = `[악재] [목표주가 하향]`;
    } else {
      colorClass = "bg-success/20 text-success";
      displayLabel = `[호재] [목표주가 상향]`;
    }
  } else if (type === "admin_stock_manual_adjust") {
    colorClass = "bg-base-300 text-base-content";
    displayLabel = `[조정] ${label}`;
  }

  return <span className={`text-[10px] font-black px-2 py-1 rounded-lg shrink-0 text-center ${colorClass}`}>{displayLabel}</span>;
}

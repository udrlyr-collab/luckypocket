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
  const [activeTab, setActiveTab] = useState("market");
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

      <div className="mb-8 grid gap-4 lg:grid-cols-12">
        {/* User Portfolio Stats (Full 12/12) */}
        <div className="lg:col-span-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <BaseCard className="bg-gradient-to-br from-primary/10 to-primary/5 shadow-sm border border-primary/25 min-w-0 p-4 rounded-2xl hover:shadow-md transition-shadow">
            <span className="text-[11px] font-black text-primary/70 uppercase tracking-wider">보유 현금</span>
            <strong className="block text-lg mt-1 tabular-nums font-black text-primary truncate">
              {formatMoney(user.balance)}
            </strong>
          </BaseCard>
          <BaseCard className="bg-gradient-to-br from-base-100 to-base-200/30 shadow-sm border border-base-200/50 min-w-0 p-4 rounded-2xl hover:shadow-md transition-shadow">
            <span className="text-[11px] font-black text-base-content/50 uppercase tracking-wider">총 평가 자산</span>
            <strong className="block text-lg mt-1 tabular-nums font-black text-base-content truncate">
              {formatMoney(portfolio.totalEvaluatedAsset || (totalHoldingsValue + totalMargin + totalPositionsUnrealized))}
            </strong>
          </BaseCard>
          <BaseCard className="bg-gradient-to-br from-base-100 to-base-200/30 shadow-sm border border-base-200/50 min-w-0 p-4 rounded-2xl hover:shadow-md transition-shadow">
            <span className="text-[11px] font-black text-base-content/50 uppercase tracking-wider">평가 손익</span>
            <strong className={`block text-lg mt-1 tabular-nums font-black truncate ${portfolio.unrealizedPnl >= 0 ? "text-success" : "text-error"}`}>
              {portfolio.unrealizedPnl >= 0 ? "+" : ""}{formatMoney(portfolio.unrealizedPnl)}
            </strong>
          </BaseCard>
        </div>
      </div>

      <div className="flex gap-2 p-1 bg-base-200/60 backdrop-blur-md rounded-2xl mb-6 max-w-md">
        <button
          className={`flex-1 py-2.5 rounded-xl font-black text-sm transition-all ${
            activeTab === "market"
              ? "bg-base-100 text-base-content shadow-sm"
              : "text-base-content/50 hover:text-base-content hover:bg-base-100/30"
          }`}
          onClick={() => setActiveTab("market")}
        >
          📈 시장 종목
        </button>
        <button
          className={`flex-1 py-2.5 rounded-xl font-black text-sm transition-all relative ${
            activeTab === "portfolio"
              ? "bg-base-100 text-base-content shadow-sm"
              : "text-base-content/50 hover:text-base-content hover:bg-base-100/30"
          }`}
          onClick={() => setActiveTab("portfolio")}
        >
          💼 내 잔고
          {(holdings.length > 0 || positions.length > 0) && (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full animate-pulse" />
          )}
        </button>
        <button
          className={`flex-1 py-2.5 rounded-xl font-black text-sm transition-all ${
            activeTab === "news"
              ? "bg-base-100 text-base-content shadow-sm"
              : "text-base-content/50 hover:text-base-content hover:bg-base-100/30"
          }`}
          onClick={() => setActiveTab("news")}
        >
          📰 시장 뉴스
        </button>
      </div>

      {activeTab === "market" && (
        <section className="animate-fade-in mb-8">
          <SectionHeader title="시장 종목" eyebrow="STOCKS" className="mb-4" />
          <div className="bg-base-100 rounded-3xl p-3 sm:p-5 shadow-sm border border-base-200">
            <div className="hidden sm:flex text-xs font-bold text-base-content/40 px-4 pb-3 border-b border-base-200 mb-2">
              <div className="flex-[3] pl-2">종목명 및 상태</div>
              <div className="flex-1 text-right">현재가</div>
              <div className="flex-1 text-right">등락률 (10초)</div>
              <div className="flex-1 text-right pr-2">시가총액 / 공모 정보</div>
            </div>
            <div className="grid gap-1.5">
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
                <div className="mt-6 pt-6 border-t border-base-200">
                  <div className="text-xs font-black text-base-content/40 mb-3 px-3 uppercase tracking-wider">최근 상장폐지 종목</div>
                  <div className="grid gap-1.5 opacity-60">
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
        </section>
      )}

      {activeTab === "portfolio" && (
        <div className="grid gap-6 lg:grid-cols-3 animate-fade-in mb-8">
          <div className="lg:col-span-1">
            <BaseCard className="bg-gradient-to-br from-primary to-primary-focus text-primary-content border-none shadow-lg p-6 rounded-3xl relative overflow-hidden">
              <div className="absolute right-0 bottom-0 opacity-10 pointer-events-none translate-x-4 translate-y-4">
                <svg className="w-48 h-48" fill="currentColor" viewBox="0 0 24 24"><path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
              </div>
              <span className="text-xs font-black uppercase tracking-widest opacity-80">총 평가 자산</span>
              <strong className="block text-3xl font-black mt-2 tabular-nums">
                <AnimatedMoney value={portfolio.totalEvaluatedAsset || (totalHoldingsValue + totalMargin + totalPositionsUnrealized)} />
              </strong>
              <div className="mt-4 pt-4 border-t border-white/20 flex justify-between items-center text-sm font-bold">
                <span className="opacity-80">평가 수익률 (PnL)</span>
                <span className={portfolio.unrealizedPnl >= 0 ? "text-success-content" : "text-error-content"}>
                  {portfolio.unrealizedPnl >= 0 ? "+" : ""}<AnimatedMoney value={portfolio.unrealizedPnl} />
                </span>
              </div>
            </BaseCard>
          </div>

          <div className="lg:col-span-2 grid gap-6">
            <BaseCard className="rounded-3xl border border-base-200 bg-base-100 shadow-sm p-4 sm:p-6">
              <SectionHeader title="보유 주식 (현물)" eyebrow="EQUITY HOLDINGS" className="mb-4" />
              {holdings.length === 0 ? (
                <div className="bg-base-200/40 p-8 rounded-2xl text-center text-sm text-base-content/50 font-bold">
                  보유한 현물 주식이 없습니다.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-sm w-full">
                    <thead>
                      <tr className="text-xs text-base-content/50 border-b border-base-200">
                        <th className="pl-2">종목명</th>
                        <th className="text-right">보유량</th>
                        <th className="text-right">평가금액</th>
                        <th className="text-right pr-2">평가손익</th>
                      </tr>
                    </thead>
                    <tbody>
                      {holdings.map(h => (
                        <tr key={h.id} className="hover:bg-base-200/40 font-bold border-b border-base-100">
                          <td className="pl-2 py-3">
                            <Link to={`/stocks/${h.stock_id}`} className="hover:underline text-base-content font-black">
                              {h.name}
                            </Link>
                          </td>
                          <td className="text-right tabular-nums">{h.quantity.toFixed(2)}주</td>
                          <td className="text-right tabular-nums">{formatMoney(h.value)}</td>
                          <td className={`text-right tabular-nums pr-2 ${h.unrealized_pnl >= 0 ? "text-success" : "text-error"}`}>
                            {formatSignedMoney(h.unrealized_pnl)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </BaseCard>

            <BaseCard className="rounded-3xl border border-base-200 bg-base-100 shadow-sm p-4 sm:p-6">
              <SectionHeader title="레버리지 포지션" eyebrow="MARGIN POSITIONS" className="mb-4" />
              {positions.length === 0 ? (
                <div className="bg-base-200/40 p-8 rounded-2xl text-center text-sm text-base-content/50 font-bold">
                  진입한 레버리지 포지션이 없습니다.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-sm w-full">
                    <thead>
                      <tr className="text-xs text-base-content/50 border-b border-base-200">
                        <th className="pl-2">종목명 (레버리지)</th>
                        <th className="text-right">방향</th>
                        <th className="text-right">증거금</th>
                        <th className="text-right">현재가 / 청산가</th>
                        <th className="text-right pr-2">미실현손익</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map(p => {
                        const danger = p.side === "short"
                          ? p.stock_current_price >= p.entry_price + (p.liquidation_price - p.entry_price) * 0.8
                          : p.stock_current_price <= p.entry_price - (p.entry_price - p.liquidation_price) * 0.8;
                        return (
                          <tr key={p.id} className={`hover:bg-base-200/40 font-bold border-b border-base-100 ${danger ? "bg-error/5" : ""}`}>
                            <td className="pl-2 py-3">
                              <Link to={`/stocks/${p.stock_id}`} className="hover:underline text-base-content font-black">
                                {p.name}
                                <span className="text-[10px] bg-secondary/15 text-secondary px-1.5 py-0.5 rounded-lg ml-1">{p.leverage}x</span>
                              </Link>
                            </td>
                            <td className="text-right">
                              <span className={`badge badge-sm font-black ${p.side === "long" ? "badge-success text-success-content" : "badge-error text-error-content"}`}>
                                {p.side === "long" ? "LONG" : "SHORT"}
                              </span>
                            </td>
                            <td className="text-right tabular-nums">{formatMoney(p.margin_amount)}</td>
                            <td className="text-right tabular-nums">
                              {formatMoney(p.stock_current_price)}<br />
                              <span className="text-[10px] text-base-content/40">청산 {formatMoney(p.liquidation_price)}</span>
                            </td>
                            <td className={`text-right tabular-nums pr-2 ${p.live_unrealized_pnl >= 0 ? "text-success" : "text-error"}`}>
                              {formatSignedMoney(p.live_unrealized_pnl)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </BaseCard>
          </div>
        </div>
      )}

      {activeTab === "news" && (
        <section className="animate-fade-in mb-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <BaseCard className="bg-gradient-to-br from-base-100 to-base-200/30 shadow-sm border border-base-200/50 p-4 rounded-2xl hover:shadow-md transition-shadow">
              <span className="text-[11px] font-black text-base-content/50 uppercase tracking-wider">상장 종목</span>
              <strong className="block text-xl mt-1 tabular-nums font-black text-base-content">
                {summary.activeTradableStockCount ?? summary.total}
                <span className="ml-1 text-xs text-base-content/30">/ {summary.targetActiveTradableStockCount ?? 16}</span>
              </strong>
            </BaseCard>
            <BaseCard className="bg-gradient-to-br from-base-100 to-base-200/30 shadow-sm border border-base-200/50 p-4 rounded-2xl hover:shadow-md transition-shadow">
              <span className="text-[11px] font-black text-base-content/50 uppercase tracking-wider">상승 / 하락</span>
              <strong className="block text-xl mt-1 tabular-nums font-black text-success">
                {summary.up} <span className="text-base-content/20 text-sm font-normal">/</span> <span className="text-error">{summary.down}</span>
              </strong>
            </BaseCard>
            <BaseCard className="bg-gradient-to-br from-base-100 to-base-200/30 shadow-sm border border-base-200/50 p-4 rounded-2xl hover:shadow-md transition-shadow">
              <span className="text-[11px] font-black text-base-content/50 uppercase tracking-wider">공모주</span>
              <strong className="block text-xl mt-1 tabular-nums font-black text-warning">
                {summary.ipoCount ?? summary.ipo}
              </strong>
            </BaseCard>
            <BaseCard className="bg-gradient-to-br from-base-100 to-base-200/30 shadow-sm border border-base-200/50 p-4 rounded-2xl hover:shadow-md transition-shadow">
              <span className="text-[11px] font-black text-base-content/50 uppercase tracking-wider">상장폐지</span>
              <strong className="block text-xl mt-1 tabular-nums font-black text-base-content/40">
                {summary.recentDelistedCount ?? (recentDelistedStocks ? recentDelistedStocks.length : 0)}
              </strong>
            </BaseCard>
          </div>
          <SectionHeader title="최근 시장 뉴스" eyebrow="NEWS" className="mb-4" />
          <BaseCard className="p-0 overflow-hidden shadow-sm border border-base-200 bg-base-100 rounded-3xl">
            {news.length === 0 ? (
              <div className="p-12 text-center text-sm text-base-content/50 font-bold">최근 등록된 시장 소식이 없습니다.</div>
            ) : (
              <ul className="divide-y divide-base-300">
                {news.map(n => (
                  <li key={n.id} className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center hover:bg-base-200/30 transition">
                    <Badge type={n.event_type} label={n.title} sentiment={n.sentiment} />
                    <span className="text-sm text-base-content/85 font-bold flex-1">{n.message}</span>
                    <span className="text-[10px] text-base-content/40 whitespace-nowrap font-bold">
                      {new Date(n.created_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </BaseCard>
        </section>
      )}

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
      <div className="flex-[3] flex items-center min-w-0 mb-1 sm:mb-0">
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

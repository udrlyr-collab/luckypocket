import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatMoney, formatSignedMoney, formatCompactMoney } from "../utils/format";
import { useEnterConfirm } from "../hooks/useEnterConfirm";

export default function StockDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [data, setData] = useState(null);
  const [timer, setTimer] = useState(10);
  
  // Trade state
  const [amountInput, setAmountInput] = useState("");
  const [sellFraction, setSellFraction] = useState(1);
  const [leverage, setLeverage] = useState(1);
  
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showLeverageWarning, setShowLeverageWarning] = useState(false);
  const [showAcquireConfirm, setShowAcquireConfirm] = useState(false);
  const [showDelistConfirm, setShowDelistConfirm] = useState(false);

  const fetchStock = async () => {
    try {
      const res = await api(`/stocks/${id}`);
      setData(res);
      setTimer(10);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    fetchStock();
    const interval = setInterval(fetchStock, 10000);
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    const timerInterval = setInterval(() => {
      setTimer((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timerInterval);
  }, []);

  if (error) {
    return (
      <div className="page-content text-center py-20">
        <p className="text-error font-bold">{error}</p>
        <button className="btn btn-outline mt-4" onClick={() => navigate("/stocks")}>시장으로 돌아가기</button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page-content text-center py-20">
        <span className="loading loading-spinner loading-lg text-primary" />
        <p className="mt-4 font-bold">주식 정보를 불러오는 중...</p>
      </div>
    );
  }

  const { stock, history, holding, positions } = data;
  const isDelisted = stock.status === 'delisted';
  const isAcquired = stock.status === 'acquired' || Boolean(stock.is_etf);
  const isOwner = stock.owner_user_id === user.id;
  const isAdmin = user && (user.isAdmin || user.username === 'admin');

  const executeAdminAction = async (endpoint) => {
    if (!window.confirm("정말 실행하시겠습니까?")) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api(`/admin/stocks/${stock.id}${endpoint}`, { method: "POST" });
      setMessage(res.message);
      await fetchStock();
      await refreshUser();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleBuy = async () => {
    if (leverage > 1) {
      if (leverage >= 50 && !showLeverageWarning) {
        setShowLeverageWarning(true);
        return;
      }
      return executeTrade("/stocks/open-position", { stockId: stock.id, margin: Number(amountInput), leverage });
    }
    return executeTrade("/stocks/buy", { stockId: stock.id, quantity: Number(amountInput) });
  };

  const handleBuyIpo = async () => {
    return executeTrade("/stocks/buy-ipo", { stockId: stock.id, amount: Number(amountInput) });
  };

  const handleSell = async () => {
    return executeTrade("/stocks/sell", { stockId: stock.id, fraction: sellFraction });
  };

  const executeTrade = async (endpoint, body) => {
    setBusy(true);
    setMessage("");
    setError("");
    setShowLeverageWarning(false);
    try {
      const res = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(body)
      });
      setMessage(res.message);
      setAmountInput("");
      await refreshUser();
      await fetchStock();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleClosePosition = async (positionId) => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api("/stocks/close-position", {
        method: "POST",
        body: JSON.stringify({ positionId })
      });
      setMessage(res.message);
      await refreshUser();
      await fetchStock();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleAcquire = async () => {
    setShowAcquireConfirm(false);
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api(`/stocks/${stock.id}/acquire`, { method: "POST" });
      setMessage(res.message);
      await refreshUser();
      await fetchStock();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelistByOwner = async () => {
    setShowDelistConfirm(false);
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api(`/stocks/${stock.id}/delist-by-owner`, { method: "POST" });
      setMessage(res.message);
      await refreshUser();
      await fetchStock();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addValue = (val) => {
    const cur = Number(amountInput) || 0;
    setAmountInput(String(cur + val));
  };

  const setPercent = (pct) => {
    const budget = Math.floor(user.balance * pct);
    if (leverage === 1) {
      setAmountInput(String(Math.floor(budget / stock.current_price)));
    } else {
      setAmountInput(String(budget));
    }
  };

  const todayRate = ((stock.current_price - stock.initial_price) / stock.initial_price) * 100;

  return (
    <div className="page-content">
      <button className="btn btn-sm btn-ghost mb-4 pl-0" onClick={() => navigate("/stocks")}>
        ← 시장으로 돌아가기
      </button>

      <header className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <h1 className="text-3xl font-black">{stock.name}</h1>
            <span className="text-sm font-bold text-base-content/50">{stock.symbol}</span>
            {stock.status === 'ipo_subscription' && <span className="badge badge-warning">공모주</span>}
            {stock.status === 'newly_listed' && <span className="badge badge-warning">신규 상장</span>}
            {isAcquired && <span className="badge badge-primary">인수됨</span>}
            {stock.is_bluechip === 1 && <span className="badge badge-info">우량주</span>}
            {stock.status === 'delist_warning' && <span className="badge badge-error animate-pulse">거래 주의</span>}
            {isDelisted && <span className="badge badge-ghost">상장폐지</span>}
          </div>
          <p className="text-sm font-bold text-base-content/60">
            {isAcquired ? (
              <span>이 종목은 {stock.owner_nickname_snapshot}님의 자산을 추종하는 ETF입니다.</span>
            ) : (
              <span>시가총액 {formatMoney(stock.market_cap)}</span>
            )}
          </p>
        </div>
        <div className="text-left md:text-right relative">
          <div className="absolute right-0 -top-6 text-xs font-bold text-base-content/50">
            다음 갱신 <span className="text-primary">{timer}초</span>
          </div>
          <div className={`text-4xl font-black tabular-nums ${isDelisted ? "text-base-content/30" : ""}`}>
            {formatMoney(stock.current_price)}
          </div>
          {!isDelisted && (
            <div className={`text-lg font-bold tabular-nums flex gap-3 justify-end items-center mt-1 flex-wrap transition-colors duration-500 ${stock.priceChangeAmount > 0 ? "text-success" : stock.priceChangeAmount < 0 ? "text-error" : "text-base-content"}`}>
              <span>전 틱 대비 {stock.priceChangeAmount > 0 ? "+" : ""}{formatMoney(stock.priceChangeAmount)} · {stock.priceChangeRate > 0 ? "+" : ""}{(stock.priceChangeRate * 100).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>
              <span className={`text-sm px-2 py-0.5 rounded-lg bg-base-200 ${(stock.offeringChangeRate !== null ? stock.offeringChangeRate : todayRate) > 0 ? "text-success" : (stock.offeringChangeRate !== null ? stock.offeringChangeRate : todayRate) < 0 ? "text-error" : "text-base-content"}`}>
                {stock.offeringChangeRate !== null ? `공모가 대비 ${stock.offeringChangeRate > 0 ? "+" : ""}${(stock.offeringChangeRate * 100).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : `상장가 대비 ${todayRate > 0 ? "+" : ""}${todayRate.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* CHART */}
      <section className="soft-card mb-6 p-4">
        <StockChart history={history} isDelisted={isDelisted} />
      </section>

      {/* ADMIN CONTROL PANEL */}
      {isAdmin && (
        <section className="soft-card mb-6 border-2 border-error/50 bg-error/5">
          <h2 className="section-title text-xl text-error mb-4">어드민 제어판</h2>
          <div className="flex flex-wrap gap-2">
            {!isDelisted && stock.status !== 'ipo_subscription' && stock.status !== 'newly_listed' && !isAcquired && stock.is_bluechip !== 1 && (
              <button 
                className="btn btn-error btn-sm" 
                disabled={busy} 
                onClick={() => executeAdminAction("/acquire")}
              >
                어드민 강제 인수
              </button>
            )}
            {isAcquired && (
              <button 
                className="btn btn-warning btn-sm" 
                disabled={busy} 
                onClick={() => executeAdminAction("/revert")}
              >
                일반 주식으로 되돌리기
              </button>
            )}
            {!isDelisted && (
              <button 
                className="btn btn-error btn-sm btn-outline" 
                disabled={busy} 
                onClick={() => executeAdminAction("/delist")}
              >
                강제 상장폐지
              </button>
            )}
          </div>
        </section>
      )}

      {/* TRADE FORMS */}
      <div className="grid gap-6 md:grid-cols-2">
        <section className="soft-card">
          <h2 className="section-title text-xl mb-4">거래하기</h2>
          {isDelisted ? (
            <div className="bg-base-200/50 p-6 rounded-2xl text-center">
              <p className="font-bold text-base-content/50 mb-4">상장폐지되어 거래할 수 없습니다.</p>
              {holding && holding.quantity > 0 && (
                <button className="btn btn-error btn-sm" onClick={() => executeTrade("/stocks/sell", { stockId: stock.id, fraction: 1 })}>
                  휴지조각 버리기 (보유량 비우기)
                </button>
              )}
            </div>
          ) : stock.status === 'ipo_subscription' ? (
            <div className="bg-warning/10 border-2 border-warning/20 p-6 rounded-2xl">
              <h3 className="font-black text-warning text-lg mb-2">🚀 공모 청약 진행 중!</h3>
              <p className="text-sm font-bold text-base-content/70 mb-4">
                현재 공모가 <strong className="text-warning text-lg">{formatMoney(stock.offering_price)}</strong>로 무제한 구매 가능합니다.<br/>
                상장 후 가격이 어떻게 변동될지 예측해보세요!
              </p>
              
              <div className="mb-4">
                <label className="text-xs font-bold text-base-content/50 mb-2 flex justify-between items-end gap-2">
                  <span>청약 금액 (금액 입력 시 수량 자동 계산)</span>
                  <span>보유 잔액: {formatMoney(user.balance)}</span>
                </label>
                <div className="flex flex-col gap-1">
                  <div className="flex gap-2">
                    <input 
                      type="number" 
                      className="input input-bordered flex-1 min-w-0 rounded-2xl bg-base-100" 
                      placeholder="0"
                      value={amountInput}
                      onChange={e => setAmountInput(e.target.value)}
                    />
                    <button 
                      className="btn btn-warning rounded-2xl px-6 shrink-0" 
                      disabled={busy || !amountInput || Number(amountInput) <= 0}
                      onClick={handleBuyIpo}
                    >
                      {busy ? <span className="loading loading-spinner loading-sm"/> : "공모가로 청약"}
                    </button>
                  </div>
                  {amountInput && Number(amountInput) > 0 && (
                    <div className="text-right text-xs text-primary font-bold pr-2">
                      {formatCompactMoney(amountInput)}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => addValue(10000)}>+1만</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => addValue(100000)}>+10만</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => addValue(1000000)}>+100만</button>
                  <button className="btn btn-xs rounded-lg bg-base-200 ml-auto" onClick={() => setPercent(0.1)}>10%</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => setPercent(0.5)}>50%</button>
                  <button className="btn btn-xs rounded-lg bg-base-200 font-bold text-warning" onClick={() => setPercent(1)}>전재산</button>
                  <button className="btn btn-xs rounded-lg btn-ghost" onClick={() => setAmountInput("")}>초기화</button>
                </div>
              </div>
              {error && <p className="text-error text-sm font-bold mt-2">{error}</p>}
              {message && <p className="text-success text-sm font-bold mt-2">{message}</p>}
            </div>
          ) : (
            <div>
              <div className="mb-4">
                <label className="text-xs font-bold text-base-content/50 block mb-2">레버리지 선택</label>
                <div className="join w-full">
                  {[1, 2, 5, 10, 50, 100].map(x => (
                    <button 
                      key={x} 
                      className={`join-item btn btn-sm flex-1 ${leverage === x ? (x >= 50 ? "btn-error" : "btn-primary") : "bg-base-200"}`}
                      onClick={() => { setLeverage(x); setShowLeverageWarning(false); }}
                    >
                      {x}x
                    </button>
                  ))}
                </div>
                <p className="text-[10px] mt-1 text-base-content/50 text-right">
                  {leverage === 1 ? "일반 현물 거래" : leverage <= 5 ? "손익이 더 크게 움직여요." : leverage <= 10 ? "높은 변동성에 주의하세요." : leverage === 50 ? "작은 하락에도 청산될 수 있어요." : "매우 위험해요. 1% 하락에도 청산될 수 있어요."}
                </p>
              </div>

              <div className="mb-4">
                <label className="text-xs font-bold text-base-content/50 mb-2 flex justify-between items-end gap-2">
                  <span>{leverage === 1 ? "매수 수량(주)" : "증거금(금액)"}</span>
                  <span>보유 잔액: {formatMoney(user.balance)}</span>
                </label>
                <div className="flex flex-col gap-1">
                  <div className="flex gap-2">
                    <input 
                      type="number" 
                      className="input input-bordered flex-1 min-w-0 rounded-2xl" 
                      placeholder="0"
                      value={amountInput}
                      onChange={e => setAmountInput(e.target.value)}
                    />
                    <button 
                      className={`btn rounded-2xl px-6 shrink-0 ${leverage >= 50 ? "btn-error" : "btn-primary"}`} 
                      disabled={busy || !amountInput || Number(amountInput) <= 0}
                      onClick={handleBuy}
                    >
                      {busy ? <span className="loading loading-spinner loading-sm"/> : (leverage === 1 ? "매수" : "롱 오픈")}
                    </button>
                  </div>
                  {amountInput && Number(amountInput) > 0 && (
                    <div className="text-right text-xs mt-1 font-bold text-primary pr-2">
                      {leverage === 1 ? `총 매수 금액: ${formatCompactMoney(Math.floor(Number(amountInput) * stock.current_price))}` : formatCompactMoney(amountInput)}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-1 mt-2">
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => addValue(leverage === 1 ? 1 : 10000)}>{leverage === 1 ? "+1주" : "+1만"}</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => addValue(leverage === 1 ? 10 : 100000)}>{leverage === 1 ? "+10주" : "+10만"}</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => addValue(leverage === 1 ? 100 : 1000000)}>{leverage === 1 ? "+100주" : "+100만"}</button>
                  <button className="btn btn-xs rounded-lg bg-base-200 ml-auto" onClick={() => setPercent(0.1)}>10%</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => setPercent(0.5)}>50%</button>
                  <button className="btn btn-xs rounded-lg bg-base-200 font-bold text-primary" onClick={() => setPercent(1)}>전재산</button>
                  <button className="btn btn-xs rounded-lg btn-ghost" onClick={() => setAmountInput("")}>초기화</button>
                </div>
              </div>

              {showLeverageWarning && (
                <div className="alert alert-error rounded-2xl mb-4 text-sm font-bold shadow-sm">
                  <div>
                    <span className="text-xl mr-2">⚠️</span>
                    정말 고배율({leverage}배) 레버리지를 사용할까요? 작은 하락에도 전액을 잃을 수 있습니다.
                  </div>
                  <button className="btn btn-sm" onClick={handleBuy}>네, 오픈합니다</button>
                </div>
              )}

              {error && <p className="text-error text-sm font-bold mt-2">{error}</p>}
              {message && <p className="text-success text-sm font-bold mt-2">{message}</p>}
            </div>
          )}
        </section>

        <section className="soft-card">
          <h2 className="section-title text-xl mb-4">내 보유 현황</h2>
          
          <div className="mb-6">
            <h3 className="text-xs font-bold text-base-content/50 mb-2">보유 주식 (현물)</h3>
            {!holding || holding.quantity === 0 ? (
              <p className="text-sm text-base-content/40 bg-base-200/50 p-4 rounded-2xl">보유한 현물 주식이 없습니다.</p>
            ) : (
              <div className="bg-base-200/50 p-4 rounded-2xl">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold">{holding.quantity.toFixed(2)}주</span>
                  <span className={`font-bold ${holding.quantity * (stock.current_price - holding.average_price) >= 0 ? "text-success" : "text-error"}`}>
                    {formatSignedMoney(holding.quantity * (stock.current_price - holding.average_price))} ({holding.quantity * (stock.current_price - holding.average_price) >= 0 ? "+" : ""}{((stock.current_price / holding.average_price - 1) * 100).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)
                  </span>
                </div>
                <div className="flex justify-between text-xs text-base-content/60 mb-4">
                  <span>평단가: {formatMoney(holding.average_price)}</span>
                  <span>평가금: {formatMoney(holding.quantity * stock.current_price)}</span>
                </div>
                
                {!isDelisted && (
                  <div className="flex gap-2">
                    <div className="join flex-1">
                      {[0.25, 0.5, 0.75, 1].map(frac => (
                        <button 
                          key={frac} 
                          className={`join-item btn btn-sm flex-1 ${sellFraction === frac ? "btn-active" : "bg-base-100"}`}
                          onClick={() => setSellFraction(frac)}
                        >
                          {frac * 100}%
                        </button>
                      ))}
                    </div>
                    <button 
                      className="btn btn-sm btn-error rounded-xl px-4" 
                      disabled={busy} 
                      onClick={handleSell}
                    >
                      {busy ? <span className="loading loading-spinner loading-xs"/> : "매도"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-xs font-bold text-base-content/50 mb-2">레버리지 포지션</h3>
            {!positions || positions.length === 0 ? (
              <p className="text-sm text-base-content/40 bg-base-200/50 p-4 rounded-2xl">진입한 레버리지 포지션이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {positions.map(p => {
                  const unrealized = (stock.current_price - p.entry_price) * p.quantity;
                  const danger = stock.current_price <= p.entry_price - (p.entry_price - p.liquidation_price) * 0.8;
                  
                  return (
                    <div key={p.id} className={`bg-base-200/50 p-4 rounded-2xl border ${danger ? "border-error/50" : "border-transparent"}`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-bold text-sm">
                          LONG {p.leverage}x <span className="text-xs font-normal text-base-content/50 ml-1">진입 {formatMoney(p.entry_price)}</span>
                        </span>
                        <span className={`font-bold text-sm ${unrealized >= 0 ? "text-success" : "text-error"}`}>
                          {formatSignedMoney(unrealized)} ({unrealized >= 0 ? "+" : ""}{((unrealized / p.margin_amount) * 100).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)
                        </span>
                      </div>
                      <div className="flex justify-between text-[11px] text-base-content/60 mb-3">
                        <span>증거금: {formatMoney(p.margin_amount)}</span>
                        <span>청산가: <span className="font-bold text-error">{formatMoney(p.liquidation_price)}</span></span>
                      </div>
                      <button 
                        className="btn btn-sm btn-outline btn-error w-full rounded-xl"
                        disabled={busy || isDelisted}
                        onClick={() => handleClosePosition(p.id)}
                      >
                        포지션 청산
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ACQUISITION PANEL */}
      {!isAcquired && !isDelisted && stock.status !== 'ipo' && (
        <section className="mt-6 soft-card border-2 border-primary/20 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div>
            <h3 className="font-black text-lg mb-1 flex items-center gap-2">🏢 회사 인수 <span className="badge badge-primary badge-sm">ETF 전환</span></h3>
            <p className="text-sm text-base-content/60 leading-relaxed">
              시가총액 <strong>{formatMoney(stock.market_cap)}</strong> 이상을 지불하면 이 회사를 인수할 수 있어요.<br />
              인수된 회사는 '인수자 자산 추종 ETF'가 되어 오너의 자산 변화를 따라갑니다.
            </p>
          </div>
          <button 
            className="btn btn-primary rounded-2xl px-6 shrink-0" 
            disabled={user.balance < stock.market_cap || busy}
            onClick={() => setShowAcquireConfirm(true)}
          >
            회사 인수하기
          </button>
        </section>
      )}

      {/* OWNER PANEL */}
      {isOwner && isAcquired && (
        <section className="mt-6 soft-card border-2 border-error/20 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div>
            <h3 className="font-black text-lg mb-1 text-error">⚠️ 오너 권한: 상장폐지</h3>
            <p className="text-sm text-base-content/60 leading-relaxed">
              당신은 이 회사의 소유자입니다. 언제든 이 회사를 상장폐지시킬 수 있습니다.<br />
              상장폐지 시 모든 주주의 주식 가치는 0원이 되며, 새로운 공모주가 상장됩니다.
            </p>
          </div>
          <button 
            className="btn btn-error rounded-2xl px-6 shrink-0" 
            disabled={busy}
            onClick={() => setShowDelistConfirm(true)}
          >
            상장폐지 실행
          </button>
        </section>
      )}

      {/* MODALS */}
      {showAcquireConfirm && (
        <ConfirmModal 
          title="정말 회사를 인수할까요?" 
          message={`비용으로 ${formatMoney(stock.market_cap)}이 차감되며, 이 종목은 1등 자산 추종 ETF로 변환됩니다.`} 
          onConfirm={handleAcquire} 
          onClose={() => setShowAcquireConfirm(false)} 
        />
      )}

      {showDelistConfirm && (
        <ConfirmModal 
          title="정말 이 회사를 상장폐지할까요?" 
          message="상장폐지되면 이 종목을 보유한 유저들의 주식 가치는 0원이 되며, 레버리지 포지션은 즉시 청산됩니다. 이 행동은 되돌릴 수 없습니다!" 
          isDanger 
          onConfirm={handleDelistByOwner} 
          onClose={() => setShowDelistConfirm(false)} 
        />
      )}
    </div>
  );
}

function ConfirmModal({ title, message, onConfirm, onClose, isDanger }) {
  useEnterConfirm(true, onConfirm);
  return (
    <div className="modal modal-open" role="dialog">
      <div className="modal-box rounded-[2rem] text-center">
        <h2 className={`text-2xl font-black mb-3 ${isDanger ? "text-error" : ""}`}>{title}</h2>
        <p className="text-sm mb-6 text-base-content/70">{message}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-outline rounded-2xl" onClick={onClose}>취소</button>
          <button type="button" className={`btn rounded-2xl ${isDanger ? "btn-error" : "btn-primary"}`} onClick={onConfirm}>
            확인 (Enter)
          </button>
        </div>
      </div>
      <button className="modal-backdrop" onClick={onClose} />
    </div>
  );
}

function StockChart({ history, isDelisted }) {
  const points = useMemo(() => {
    if (!history || history.length === 0) return [];
    
    // We want chronologically, but it's sorted descending from API
    // Wait, API returns `.reverse()` so it IS chronological.
    
    const width = 800;
    const height = 200;
    const padding = { left: 10, right: 10, top: 20, bottom: 20 };
    
    const prices = history.map(h => h.price);
    const min = Math.min(...prices) * 0.95;
    const max = Math.max(...prices) * 1.05;
    const spread = Math.max(1, max - min);
    
    const mapped = history.map((point, i) => {
      const x = padding.left + (i / Math.max(1, history.length - 1)) * (width - padding.left - padding.right);
      const y = height - padding.bottom - ((point.price - min) / spread) * (height - padding.top - padding.bottom);
      return `${x},${y}`;
    });
    
    return { mapped: mapped.join(" "), width, height, isUp: history[history.length-1].price >= history[0].price, minPrice: Math.min(...prices), maxPrice: Math.max(...prices) };
  }, [history]);

  if (!history || history.length < 2) {
    return <div className="h-40 flex items-center justify-center text-sm text-base-content/40">차트 데이터가 부족합니다.</div>;
  }

  const strokeColor = isDelisted ? "#9ca3af" : (points.isUp ? "#36d399" : "#f87272");

  return (
    <div className="w-full relative">
      <svg viewBox={`0 0 ${points.width} ${points.height}`} className="w-full h-auto max-h-56">
        <defs>
          <linearGradient id="chart-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.2" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon 
          points={`${points.mapped.split(" ")[0].split(",")[0]},${points.height} ${points.mapped} ${points.mapped.split(" ").pop().split(",")[0]},${points.height}`}
          fill="url(#chart-grad)"
        />
        <polyline 
          points={points.mapped} 
          fill="none" 
          stroke={strokeColor} 
          strokeWidth="3" 
          strokeLinecap="round" 
          strokeLinejoin="round" 
        />
      </svg>
      <div className="absolute top-2 left-2 px-2 py-1 bg-base-100/80 rounded-lg text-xs font-bold shadow-sm">
        최고 {formatMoney(points.maxPrice)}
      </div>
      <div className="absolute bottom-2 left-2 px-2 py-1 bg-base-100/80 rounded-lg text-xs font-bold shadow-sm">
        최저 {formatMoney(points.minPrice)}
      </div>
      {/* 
        This is a simple sparkline chart. 
        Prices aren't mapped to axes explicitly since it updates every 10s and is just a visual trend.
      */}
    </div>
  );
}

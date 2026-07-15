import { Fragment, useEffect, useState, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatMoney, formatSignedMoney, formatCompactMoney } from "../utils/format";
import { useEnterConfirm } from "../hooks/useEnterConfirm";
import { useMarketClock } from "../hooks/useMarketClock";
import AnimatedMoney from "../components/AnimatedMoney";
import { StockRiskBadges, StockRiskNotice, StockTierBadge } from "../components/StockRiskStatus";
import AdminStockControlPanel from "../components/AdminStockControlPanel";
import StockActionErrorDialog from "../components/StockActionErrorDialog";
import { PageContainer, SectionHeader, BaseCard, ConfirmModal } from "../components/ui";

function corporateEventLabel(eventType) {
  return {
    earnings_beat: "어닝 서프라이즈",
    earnings_inline: "실적 발표",
    earnings_miss: "실적 부진",
    dividend: "배당 예정",
    share_buyback: "자사주 매입",
    rights_offering: "유상증자",
    short_squeeze: "숏스퀴즈",
  }[eventType] || "회사 이벤트";
}

function corporateEventStatus(status) {
  return {
    scheduled: "예정",
    active: "진행 중",
    recorded: "기준일 확정",
    paid: "지급 완료",
    completed: "종료",
    cancelled: "취소",
  }[status] || "확인 중";
}

function formatTradeResultMessage(message, result) {
  const parts = [];
  const fee = result.buyFee ?? result.sellFee ?? result.openFee ?? result.closeFee;
  if (fee > 0) parts.push(`수수료 ${formatMoney(fee)}`);
  if (result.capitalGainsTax > 0) parts.push(`양도소득세 ${formatMoney(result.capitalGainsTax)}`);
  if (result.jackpotPoolContribution > 0) parts.push(`잭팟 적립 ${formatMoney(result.jackpotPoolContribution)}`);
  const finalAmount = result.finalReceiveAmount ?? result.finalPayout;
  if (finalAmount > 0) parts.push(`최종 수령 ${formatMoney(finalAmount)}`);
  return parts.length ? `${message} (${parts.join(" · ")})` : message;
}

function StockBuyPreview({ preview }) {
  if (!preview) return null;
  if (!preview.quantity || preview.quantity <= 0) {
    return <p className="mt-3 text-sm font-bold text-error">{preview.error || "수수료를 포함해 매수 가능한 주식이 없어요."}</p>;
  }

  return (
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-2xl bg-base-200/55 px-4 py-3 text-xs font-bold tabular-nums">
      <span className="text-base-content/55">입력한 예산</span><span className="text-right">{formatMoney(preview.budgetAmount)}</span>
      <span className="text-base-content/55">매수 가능 수량</span><span className="text-right">{Number(preview.quantity).toLocaleString("ko-KR", { maximumFractionDigits: 4 })}주</span>
      <span className="text-base-content/55">주식 매수금액</span><span className="text-right">{formatMoney(preview.tradeValue)}</span>
      <span className="text-base-content/55">거래 수수료</span><span className="text-right">{formatMoney(preview.buyFee)}</span>
      <span className="text-base-content/55">예상 총 차감액</span><span className="text-right">{formatMoney(preview.totalCost)}</span>
      <span className="text-base-content/55">매수 후 잔액</span><span className="text-right">{formatMoney(preview.remainingBalance)}</span>
    </div>
  );
}

export default function StockDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [data, setData] = useState(null);
  const [topHolders, setTopHolders] = useState([]);
  const [topPositions, setTopPositions] = useState([]);
  const lastIpoRefreshRef = useRef(0);
  const {
    serverNow,
    nextTickRemainingSeconds,
    remainingSecondsUntil,
  } = useMarketClock({
    serverTime: data?.serverTime,
    nextTickAt: data?.nextTickAt,
  });
  
  // Trade state
  const [amountInput, setAmountInput] = useState("");
  const [sellFraction, setSellFraction] = useState(1);
  const [leverage, setLeverage] = useState(1);
  const [positionSide, setPositionSide] = useState('long');
  
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState(null);
  const [buyPreview, setBuyPreview] = useState(null);
  const [sellPreview, setSellPreview] = useState(null);
  const [showLeverageWarning, setShowLeverageWarning] = useState(false);
  const [showAcquireConfirm, setShowAcquireConfirm] = useState(false);
  const [showDelistConfirm, setShowDelistConfirm] = useState(false);
  const [showEditMetaModal, setShowEditMetaModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSymbol, setEditSymbol] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [alertTargetPrice, setAlertTargetPrice] = useState("");
  const [alertDirection, setAlertDirection] = useState("above");

  const showActionError = (title, error) => {
    setActionError({
      title,
      message: error?.message || String(error || "잠시 후 다시 시도해 주세요."),
    });
  };

  // Keeps legacy stock action handlers on the current page while they are
  // progressively migrated to use a more specific dialog title.
  const setError = (message) => {
    if (!message) {
      setActionError(null);
      return;
    }
    showActionError("거래를 완료하지 못했어요", message);
  };


  const fetchStock = async () => {
    try {
      const [res, holdersData, positionsData] = await Promise.all([
        api(`/stocks/${id}`),
        api(`/stocks/${id}/top-holders?limit=5`),
        api(`/stocks/${id}/top-positions?limit=5`),
      ]);
      setData(res);
      setLoadError("");
      setTopHolders(holdersData.holders || []);
      setTopPositions(positionsData.positions || []);
    } catch (e) {
      setLoadError(e.message);
    }
  };

  useEffect(() => {
    fetchStock();
    const interval = setInterval(fetchStock, 2000);
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    if (data?.stock?.status !== "ipo_subscription") return;
    const remaining = remainingSecondsUntil(
      data.stock.ipoSubscriptionEndsAt || data.stock.ipo_subscription_ends_at,
    );
    if (remaining !== 0) return;
    const now = Date.now();
    if (now - lastIpoRefreshRef.current < 1500) return;
    lastIpoRefreshRef.current = now;
    fetchStock();
  }, [serverNow, data?.stock?.status, data?.stock?.ipoSubscriptionEndsAt, data?.stock?.ipo_subscription_ends_at]);

  useEffect(() => {
    const stock = data?.stock;
    const budgetAmount = Math.floor(Number(amountInput) || 0);
    if (!stock || leverage !== 1 || budgetAmount <= 0) {
      setBuyPreview(null);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const preview = await api(`/stocks/${stock.id}/buy-preview`, {
          method: "POST",
          body: JSON.stringify({ budgetAmount }),
        });
        if (!cancelled) setBuyPreview(preview);
      } catch (error) {
        if (!cancelled) setBuyPreview({ quantity: 0, error: error.message });
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [data?.stock?.id, data?.stock?.status, data?.stock?.current_price, amountInput, leverage]);

  useEffect(() => {
    const stock = data?.stock;
    if (!stock || !data?.holding?.quantity || stock.status === "delisted") {
      setSellPreview(null);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const preview = await api(`/stocks/${stock.id}/sell-preview`, {
          method: "POST",
          body: JSON.stringify({ fraction: sellFraction }),
        });
        if (!cancelled) setSellPreview(preview);
      } catch {
        if (!cancelled) setSellPreview(null);
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [data?.stock?.id, data?.stock?.status, data?.stock?.current_price, data?.holding?.quantity, sellFraction]);

  if (loadError && !data) {
    return (
      <div className="page-content text-center py-20">
        <p className="text-error font-bold">{loadError}</p>
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

  const {
    stock,
    history,
    holding,
    positions,
    trades = [],
    events = [],
    corporateEvents = [],
    shortInterestRatio = 0,
    priceAlerts = [],
    marketOpen,
  } = data;
  const isDelisted = stock.status === 'delisted';
  const isOwnerAssetEtf = Boolean(stock.is_etf) && stock.etf_tracking_type === "owner_asset";
  const isAcquired = stock.status === 'acquired' || isOwnerAssetEtf;
  const isOwner = Number(stock.owner_user_id) === Number(user.id);
  const isOwnOwnerEtf = isOwnerAssetEtf && isOwner;
  const ownerNickname = stock.owner_nickname_snapshot || "인수자";
  const acquisitionInfo = data.acquisition || {};
  const acquisitionCost = Number(acquisitionInfo.acquisitionPrice || acquisitionInfo.cost || stock.market_cap || 0);
  const acquisitionRequiredTotalAsset = Number(acquisitionInfo.requiredTotalAsset || acquisitionInfo.requiredBalance || acquisitionCost);
  const acquisitionUserTotalAsset = Number(acquisitionInfo.userTotalEvaluatedAsset || 0);
  const acquisitionUserCashBalance = Number(acquisitionInfo.userCashBalance || user.balance || 0);
  const acquisitionEstimatedCash = Number(acquisitionInfo.estimatedCashAfterAutoClear || acquisitionUserCashBalance);
  const canAcquireCompany = acquisitionInfo.canAcquire !== false;
  const hostileCost = Number(data.hostileTakeover?.cost || 0);
  const hostileRequiredBalance = Number(data.hostileTakeover?.requiredTotalAsset || data.hostileTakeover?.requiredBalance || hostileCost);
  const isAdmin = user && (user.isAdmin || user.username === 'admin');
  const isPrimaryAdmin = user?.username === "admin";
  const isTradingSuspended = stock.is_trading_suspended === 1;
  const isTradeBlocked = !marketOpen || isTradingSuspended;
  const maxAllowedLeverage = getClientMaxAllowedLeverage(stock);
  const isLeverageBlocked = maxAllowedLeverage <= 1 || isClientLeverageBlocked(stock);
  const isSelectedLeverageBlocked = leverage > 1 && (isLeverageBlocked || leverage > maxAllowedLeverage);
  const ipoTimeRemaining = stock.status === "ipo_subscription"
    ? remainingSecondsUntil(stock.ipoSubscriptionEndsAt || stock.ipo_subscription_ends_at)
    : null;
  const ipoCountdownText =
    ipoTimeRemaining === null
      ? "상장 시간 확인 중"
      : ipoTimeRemaining === 0
        ? "상장 처리 중..."
        : `상장까지 ${Math.floor(ipoTimeRemaining / 60) > 0 ? `${Math.floor(ipoTimeRemaining / 60)}분 ` : ""}${ipoTimeRemaining % 60}초`;
  const listingInfoText =
    stock.status === "ipo_subscription"
      ? `상장 전 · ${ipoCountdownText}`
      : `상장일 ${stock.listedDateText || "상장일 미정"} · ${stock.listedAgeText || "상장일 미정"}`;

  const executeAdminAction = async (endpoint) => {
    if (!window.confirm("정말 실행하시겠습니까?")) return;
    setBusy(true);
    setMessage("");
    setActionError(null);
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

  const handleUpdateMeta = async () => {
    if (!editName.trim()) {
      setError("회사 제목은 필수 입력 항목입니다.");
      return;
    }
    if (!editSymbol.trim()) {
      setError("종목코드(심볼)는 필수 입력 항목입니다.");
      return;
    }

    const badWords = ["개새끼", "씨발", "병신", "좆", "씹", "아가리", "느금마", "지랄", "존나", "쌍년", "썅", "엠창", "시발", "미친년", "미친놈"];
    const sanitizedName = editName.replace(/\s+/g, "");
    for (const word of badWords) {
      if (sanitizedName.includes(word)) {
        setError("회사 제목에 비속어가 포함될 수 없습니다.");
        return;
      }
    }

    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api(`/stocks/${stock.id}/update-meta`, {
        method: "POST",
        body: JSON.stringify({
          name: editName,
          symbol: editSymbol,
          description: editDescription,
        }),
      });
      setMessage(res.message);
      setShowEditMetaModal(false);
      await fetchStock();
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
      return executeTrade("/stocks/open-position", { stockId: stock.id, budgetAmount: Number(amountInput), leverage, side: positionSide });
    }
    return executeTrade("/stocks/buy", { stockId: stock.id, budgetAmount: Number(amountInput) });
  };

  const handleBuyIpo = async () => {
    return executeTrade("/stocks/buy-ipo", { stockId: stock.id, budgetAmount: Number(amountInput) });
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
      setMessage(formatTradeResultMessage(res.message, res));
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
      setMessage(formatTradeResultMessage(res.message, res));
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

  const executeAction = async (endpoint, actionName) => {
    if (!window.confirm(`정말 ${actionName}하시겠습니까?`)) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api(`/stocks/${stock.id}${endpoint}`, { method: "POST" });
      setMessage(res.message);
      await refreshUser();
      await fetchStock();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleHostileDefense = async () => {
    const input = window.prompt("투입할 방어 자금을 입력하세요.", "100000");
    if (input === null) return;
    const amount = Number(String(input).replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("방어 자금을 올바르게 입력해주세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api(`/stocks/${stock.id}/hostile-takeover/defend`, {
        method: "POST",
        body: JSON.stringify({ amount }),
      });
      setMessage(res.message);
      await refreshUser();
      await fetchStock();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleWatchlist = async () => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api(`/stocks/${stock.id}/watchlist`, {
        method: stock.isWatched ? "DELETE" : "POST",
      });
      setMessage(res.message);
      await fetchStock();
    } catch (e) {
      showActionError("관심종목 설정을 변경하지 못했어요", e);
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePriceAlert = async () => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api(`/stocks/${stock.id}/alerts`, {
        method: "POST",
        body: JSON.stringify({
          targetPrice: Number(alertTargetPrice),
          direction: alertDirection,
        }),
      });
      setMessage(res.message);
      setAlertTargetPrice("");
      await fetchStock();
    } catch (e) {
      showActionError("가격 알림을 설정하지 못했어요", e);
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePriceAlert = async (alertId) => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api(`/stocks/alerts/${alertId}`, { method: "DELETE" });
      setMessage(res.message);
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
    setAmountInput(String(budget));
  };

  const todayRate = ((stock.current_price - stock.initial_price) / stock.initial_price) * 100;
  const blueChipDayOpenPrice = Number(stock.blue_chip_day_open_price || 0);
  const blueChipDailyChangeRate = blueChipDayOpenPrice > 0
    ? (stock.current_price - blueChipDayOpenPrice) / blueChipDayOpenPrice
    : null;
  const blueChipDailyChangePercent = blueChipDailyChangeRate === null
    ? null
    : `${blueChipDailyChangeRate > 0 ? "+" : ""}${(blueChipDailyChangeRate * 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const offeringRate = Number(stock.offeringChangeRate || 0);
  const isIpoLimitNear = stock.status === 'newly_listed' && offeringRate >= 2.7;
  const isIpoOverheated = stock.status === 'newly_listed' && offeringRate >= 1.5;

  return (
    <PageContainer>
      <button className="btn btn-sm btn-ghost mb-4 pl-0" onClick={() => navigate("/stocks")}>
        ← 시장으로 돌아가기
      </button>

      <header className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <h1 className="text-3xl font-black">{stock.name}</h1>
            <span className="text-sm font-bold text-base-content/50">{stock.symbol}</span>
            <button
              type="button"
              className={`btn btn-xs rounded-full ${stock.isWatched ? "btn-warning" : "btn-outline"}`}
              disabled={busy}
              onClick={handleToggleWatchlist}
            >
              {stock.isWatched ? "★ 관심종목" : "☆ 관심"}
            </button>
          </div>
          <div className="flex gap-2 mb-2 flex-wrap">
            {stock.is_bluechip === 1 && <span className="badge badge-info font-bold">우량주</span>}
            {stock.blueChipRampActive && <span className="badge badge-error font-bold text-white">목표주가 진행 중</span>}
            {stock.adminPriceTargetActive && <span className="badge badge-warning font-bold">목표주가 진행 중</span>}
            <StockTierBadge stock={stock} />
            <StockRiskBadges stock={stock} />
            {stock.sector && <span className="badge badge-outline font-bold">{stock.sector}</span>}
            {stock.status === 'ipo_subscription' && <span className="badge badge-warning font-bold">공모주</span>}
            {stock.status === 'newly_listed' && <span className="badge badge-warning font-bold">신규 상장</span>}
            {stock.volatilityBadge && <span className="badge badge-ghost font-bold">{stock.volatilityBadge}</span>}
            {isIpoLimitNear && <span className="badge badge-error font-bold">상한 근접</span>}
            {!isIpoLimitNear && isIpoOverheated && <span className="badge badge-warning font-bold">공모주 과열</span>}
            {isAcquired && <span className="badge badge-primary font-bold">인수됨</span>}
            {stock.status === 'delist_warning' && <span className="badge badge-error font-bold animate-pulse">상장폐지 위험</span>}
            {isDelisted && <span className="badge badge-ghost font-bold">상장폐지</span>}
            {isTradingSuspended && <span className="badge badge-error font-bold">거래 정지</span>}
            {!marketOpen && <span className="badge badge-error font-bold">휴장</span>}
          </div>
          <p className="text-sm font-bold text-base-content/60">
            {isOwnerAssetEtf ? (
              <span>이 종목은 {ownerNickname}님의 자산을 추종하는 ETF입니다.</span>
            ) : (
              <span>시가총액 {formatMoney(stock.market_cap)}</span>
            )}
          </p>
          <p className="mt-1 text-sm font-black text-primary">{listingInfoText}</p>
          <p className="mt-1 text-xs font-bold text-base-content/50">
            오늘 거래량 {Number(stock.todayTradeVolume || 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}주 · 오늘 거래대금 {formatMoney(stock.todayTradeValue || 0)}
          </p>
          {stock.description && (
            <p className="text-xs font-semibold text-base-content/50 mt-1 max-w-xl break-all">
              {stock.description}
            </p>
          )}
          {isAdmin && (stock.blueChipRampActive || stock.adminPriceTargetActive) && (
            <div className="mt-3 p-4 rounded-3xl bg-base-200/60 border border-base-300 max-w-xl text-sm text-base-content">
              <div className="font-bold flex items-center justify-between mb-2">
                <span>🎯 목표주가 이벤트 진행 중</span>
                <span className="badge badge-primary font-black">
                  도달률 {stock.blueChipRampActive ? (
                    `${Math.min(100, Math.floor((stock.current_price / stock.blueChipTargetPrice) * 100))}%`
                  ) : (
                    `${Math.min(100, Math.floor((stock.current_price / stock.adminPriceTarget) * 100))}%`
                  )}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="opacity-50">목표주가:</span>{" "}
                  <strong className="font-black">{formatMoney(stock.blueChipRampActive ? stock.blueChipTargetPrice : stock.adminPriceTarget)}</strong>
                </div>
                <div>
                  <span className="opacity-50">틱당 변동률:</span>{" "}
                  <strong className="font-black">
                    {stock.blueChipRampActive ? `+${stock.blueChipRampPercentPerTick}%` : `${stock.adminPriceTargetDirection === "up" ? "+" : "-"}${stock.adminPriceTargetPercentPerTick}%`}
                  </strong>
                </div>
                {stock.blueChipRampActive && stock.blueChipRampReason && (
                  <div className="col-span-2">
                    <span className="opacity-50">사유:</span>{" "}
                    <span className="font-bold text-base-content/85">{stock.blueChipRampReason}</span>
                  </div>
                )}
                {!stock.blueChipRampActive && stock.adminPriceTargetReason && (
                  <div className="col-span-2">
                    <span className="opacity-50">사유:</span>{" "}
                    <span className="font-bold text-base-content/85">{stock.adminPriceTargetReason}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="text-left md:text-right relative">
          <div className="absolute right-0 -top-6 text-xs font-bold text-base-content/50">
            다음 갱신 <span className="text-primary">{nextTickRemainingSeconds ?? "-"}초</span>
          </div>
          <div className={`text-4xl font-black tabular-nums ${isDelisted ? "text-base-content/30" : ""}`}>
            <AnimatedMoney value={stock.current_price} />
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

      <StockRiskNotice stock={stock} />

      <BaseCard className="mb-6 rounded-3xl border border-base-300 bg-base-100 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-black tracking-widest text-primary">MARKET DYNAMICS</p>
            <h2 className="section-title text-xl mt-1">추세와 시장 이벤트</h2>
            <p className="mt-2 text-sm font-bold text-base-content/60">
              현재 추세는 일정 시간 유지되며, 매 틱마다 다시 추첨되지 않아요.
            </p>
          </div>
          {stock.tradingHaltedUntil && new Date(stock.tradingHaltedUntil).getTime() > serverNow && (
            <span className="badge badge-error badge-lg rounded-2xl font-black">변동성 완화장치 발동</span>
          )}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-base-300 bg-base-200/40 p-4">
            <p className="text-xs font-bold text-base-content/50">현재 추세</p>
            <p className={`mt-1 font-black ${stock.trendRegime === "bull" ? "text-success" : stock.trendRegime === "bear" ? "text-error" : "text-base-content"}`}>
              {stock.trendRegime === "bull" ? "상승 추세" : stock.trendRegime === "bear" ? "하락 추세" : "횡보 추세"}
            </p>
          </div>
          <div className="rounded-2xl border border-base-300 bg-base-200/40 p-4">
            <p className="text-xs font-bold text-base-content/50">추세 기준 시가총액</p>
            <p className="mt-1 font-black tabular-nums">{formatMoney(stock.trendMarketCapBasis || stock.market_cap)}</p>
          </div>
          <div className="rounded-2xl border border-base-300 bg-base-200/40 p-4">
            <p className="text-xs font-bold text-base-content/50">숏 비중</p>
            <p className="mt-1 font-black tabular-nums">{(Number(shortInterestRatio || 0) * 100).toFixed(2)}%</p>
          </div>
          <div className="rounded-2xl border border-base-300 bg-base-200/40 p-4">
            <p className="text-xs font-bold text-base-content/50">거래 상태</p>
            <p className={`mt-1 font-black ${stock.tradingHaltedUntil && new Date(stock.tradingHaltedUntil).getTime() > serverNow ? "text-error" : "text-success"}`}>
              {stock.tradingHaltedUntil && new Date(stock.tradingHaltedUntil).getTime() > serverNow ? "거래 정지 중" : "정상 거래"}
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {corporateEvents.slice(0, 4).map((event) => (
            <div key={event.id} className="rounded-2xl border border-base-300 bg-base-100 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-black">{corporateEventLabel(event.eventType)}</p>
                <span className="badge badge-outline rounded-xl font-bold">{corporateEventStatus(event.status)}</span>
              </div>
              {event.eventType.startsWith("earnings_") && (
                <p className="mt-2 text-sm font-bold text-base-content/60 tabular-nums">
                  예상 {formatMoney(event.expectedProfit || 0)} · 실제 {formatMoney(event.actualProfit || 0)} · {(Number(event.surpriseRate || 0) * 100).toFixed(1)}%
                </p>
              )}
              {event.eventType === "dividend" && (
                <p className="mt-2 text-sm font-bold text-base-content/60 tabular-nums">예상 배당률 {(Number(event.dividendRate || 0) * 100).toFixed(2)}% · 기준일 {event.recordAt ? new Date(event.recordAt).toLocaleString("ko-KR") : "미정"}</p>
              )}
            </div>
          ))}
          {corporateEvents.length === 0 && (
            <p className="text-sm font-bold text-base-content/45">진행 중이거나 최근 발생한 회사 이벤트가 없어요.</p>
          )}
        </div>
      </BaseCard>

      {/* CHART */}
      <BaseCard className="mb-6 p-4">
        <StockChart history={history} isDelisted={isDelisted} />
      </BaseCard>

      {stock.status === 'newly_listed' && (isIpoOverheated || isIpoLimitNear) && (
        <BaseCard className={`mb-6 border-2 ${isIpoLimitNear ? "border-error/30 bg-error/10" : "border-warning/30 bg-warning/10"}`}>
          <p className="text-xs font-black uppercase tracking-widest text-base-content/50">
            IPO STATUS
          </p>
          <h2 className={`mt-1 text-xl font-black ${isIpoLimitNear ? "text-error" : "text-warning"}`}>
            {isIpoLimitNear ? "상한 근접" : "공모주 과열"}
          </h2>
          <p className="mt-2 text-sm font-bold leading-relaxed text-base-content/65">
            공모가 대비 {(offeringRate * 100).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% 오른 상태예요.
            추가 상승 확률이 낮아지고 하락 위험이 커져요.
          </p>
        </BaseCard>
      )}

      {stock.is_bluechip === 1 && (
        <BaseCard className=" mb-6 border-2 border-info/20 bg-info/5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black tracking-widest text-info mb-1">BLUE CHIP LIMIT</p>
              <h2 className="section-title text-xl mb-2">우량주 24시간 등락 제한</h2>
              <p className="text-sm font-bold text-base-content/60">
                하루 시작가 대비 -13% ~ +15% 범위 안에서만 움직입니다.
              </p>
            </div>
            <div className={`text-3xl font-black tabular-nums ${blueChipDailyChangeRate > 0 ? "text-success" : blueChipDailyChangeRate < 0 ? "text-error" : "text-base-content"}`}>
              {blueChipDailyChangePercent || "0.00%"}
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
            <div className="rounded-2xl bg-base-100/80 border border-base-300/50 p-4">
              <p className="text-xs font-bold text-base-content/50 mb-1">오늘 기준가</p>
              <p className="font-black tabular-nums">{formatMoney(stock.blue_chip_day_open_price || stock.current_price)}</p>
            </div>
            <div className="rounded-2xl bg-base-100/80 border border-success/20 p-4">
              <p className="text-xs font-bold text-base-content/50 mb-1">오늘 상한</p>
              <p className="font-black tabular-nums text-success">{formatMoney(stock.blue_chip_daily_high_limit_price || Math.floor(stock.current_price * 1.15))}</p>
            </div>
            <div className="rounded-2xl bg-base-100/80 border border-error/20 p-4">
              <p className="text-xs font-bold text-base-content/50 mb-1">오늘 하한</p>
              <p className="font-black tabular-nums text-error">{formatMoney(stock.blue_chip_daily_low_limit_price || Math.max(1, Math.floor(stock.current_price * 0.87)))}</p>
            </div>
            <div className="rounded-2xl bg-base-100/80 border border-info/20 p-4">
              <p className="text-xs font-bold text-base-content/50 mb-1">1틱 최대 변동</p>
              <p className="font-black tabular-nums text-info">±0.0016%</p>
            </div>
          </div>
        </BaseCard>
      )}

      {/* ADMIN CONTROL PANEL */}
      {isAdmin && (
        <BaseCard className=" mb-6 border-2 border-error/50 bg-error/5">
          <h2 className="section-title text-xl text-error mb-4">어드민 제어판</h2>
          <div className="flex flex-wrap gap-2">
            {!isTradingSuspended ? (
              <button 
                className="btn btn-error btn-sm" 
                onClick={() => executeAdminAction('/suspend')}
                disabled={busy}
              >
                거래 정지 시키기
              </button>
            ) : (
              <button 
                className="btn btn-success btn-sm" 
                onClick={() => executeAdminAction('/resume')}
                disabled={busy}
              >
                거래 정지 해제
              </button>
            )}
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
        </BaseCard>
      )}

      {/* ADMIN STOCK CONTROL PANEL */}
      {isAdmin && !isDelisted && (
        <div className="mb-6">
          <AdminStockControlPanel
            stock={stock}
            compact
            canEditCompanyProfile={isPrimaryAdmin}
            onActionComplete={async () => {
              await fetchStock();
              await refreshUser();
            }}
          />
        </div>
      )}

      <BaseCard className="mb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-black tracking-widest text-primary mb-1">PRICE ALERT</p>
            <h2 className="section-title text-xl mb-2">가격 알림</h2>
            <p className="text-sm font-bold text-base-content/55">
              현재가가 목표 가격 이상 또는 이하에 도달하면 알림에 기록됩니다.
            </p>
          </div>
          <div className="grid w-full gap-2 sm:grid-cols-[1fr_120px_96px] lg:max-w-xl">
            <input
              type="number"
              className="input input-bordered h-12 rounded-2xl"
              placeholder="목표 가격"
              value={alertTargetPrice}
              onChange={(event) => setAlertTargetPrice(event.target.value)}
            />
            <select
              className="select select-bordered h-12 rounded-2xl"
              value={alertDirection}
              onChange={(event) => setAlertDirection(event.target.value)}
            >
              <option value="above">이상</option>
              <option value="below">이하</option>
            </select>
            <button
              type="button"
              className="btn btn-primary h-12 rounded-2xl whitespace-nowrap"
              disabled={busy || !alertTargetPrice || Number(alertTargetPrice) <= 0}
              onClick={handleCreatePriceAlert}
            >
              추가
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2">
          {priceAlerts.length === 0 ? (
            <p className="rounded-2xl bg-base-200/60 p-4 text-center text-sm font-bold text-base-content/45">
              설정한 가격 알림이 없습니다.
            </p>
          ) : (
            priceAlerts.map((alert) => (
              <div key={alert.id} className="flex items-center justify-between gap-3 rounded-2xl border border-base-300 bg-base-100 p-3">
                <div className="min-w-0">
                  <p className="font-black tabular-nums">
                    {formatMoney(alert.targetPrice)} {alert.direction === "above" ? "이상" : "이하"}
                  </p>
                  <p className={`text-xs font-bold ${alert.triggeredAt ? "text-success" : "text-base-content/45"}`}>
                    {alert.triggeredAt
                      ? `도달 ${new Date(alert.triggeredAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                      : "대기 중"}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost rounded-xl"
                  disabled={busy}
                  onClick={() => handleDeletePriceAlert(alert.id)}
                >
                  삭제
                </button>
              </div>
            ))
          )}
        </div>
      </BaseCard>

      {/* TRADE FORMS */}
      <div className="grid gap-6 md:grid-cols-2">
        <BaseCard className="">
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
              <p className="text-sm font-bold text-base-content/70 mb-2">
                현재 공모가 <strong className="text-warning text-lg">{formatMoney(stock.offering_price)}</strong>로 무제한 구매 가능합니다.<br/>
                상장 후 가격이 어떻게 변동될지 예측해보세요!
              </p>
              <div className="mb-4 text-center">
                <span className="text-3xl font-black text-warning animate-pulse">
                  {ipoCountdownText}
                </span>
              </div>
              
              <div className="mb-4">
                <label className="text-xs font-bold text-base-content/50 mb-2 flex justify-between items-end gap-2">
                  <span>청약 예산 (수수료 포함)</span>
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
                      disabled={busy || !amountInput || Number(amountInput) <= 0 || !buyPreview || buyPreview.quantity <= 0}
                      onClick={handleBuyIpo}
                    >
                      {busy ? <span className="loading loading-spinner loading-sm"/> : buyPreview?.quantity > 0 ? `${Number(buyPreview.quantity).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}주 청약` : "공모가로 청약"}
                    </button>
                  </div>
                  {amountInput && Number(amountInput) > 0 && (
                    <div className="text-right text-xs text-primary font-bold pr-2">
                      {formatCompactMoney(amountInput)}
                    </div>
                  )}
                </div>
                <StockBuyPreview preview={buyPreview} />
                <div className="flex flex-wrap gap-1 mt-2">
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => addValue(10000)}>+1만</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => addValue(100000)}>+10만</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => addValue(1000000)}>+100만</button>
                  <button className="btn btn-xs rounded-lg bg-base-200 ml-auto" onClick={() => setPercent(0.1)}>10%</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => setPercent(0.25)}>25%</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => setPercent(0.5)}>50%</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => setPercent(1)}>100%</button>
                  <button className="btn btn-xs rounded-lg bg-base-200 font-bold text-warning" onClick={() => setPercent(1)}>전재산</button>
                  <button className="btn btn-xs rounded-lg btn-ghost" onClick={() => setAmountInput("")}>초기화</button>
                </div>
              </div>
              {message && <p className="text-success text-sm font-bold mt-2">{message}</p>}
            </div>
          ) : isOwnOwnerEtf ? (
            <div className="bg-warning/10 border-2 border-warning/20 p-6 rounded-2xl text-center">
              {data.hostileTakeoverEvent && (
                <div className="mb-4 rounded-2xl border border-error/20 bg-error/5 p-4 text-left">
                  <p className="font-black text-error">적대적 M&A 공개 입찰 진행 중</p>
                  <p className="mt-1 text-sm font-bold text-base-content/65 tabular-nums">
                    공격 자금 {formatMoney(data.hostileTakeoverEvent.attackCash)} · 현재 방어 {formatMoney(data.hostileTakeoverEvent.defenseCash)}
                  </p>
                  <button className="btn btn-error btn-sm mt-3 w-full rounded-2xl" disabled={busy} onClick={handleHostileDefense}>
                    방어 자금 투입
                  </button>
                </div>
              )}
              <h3 className="font-black text-warning text-lg mb-2">본인이 인수한 ETF는 거래할 수 없어요</h3>
              <p className="text-sm font-bold text-base-content/70">
                이 ETF는 인수자의 자산을 따라 움직이기 때문에, 자산 순환을 막기 위한 제한이에요.
              </p>
            </div>
          ) : (
            <div>
              {isOwnerAssetEtf && !isOwner && (
                <div className="mb-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                  <h3 className="font-black text-primary">거래 가능한 인수 ETF예요</h3>
                  <p className="mt-1 text-sm font-bold leading-relaxed text-base-content/65">
                    {ownerNickname}님의 자산 변화를 추종합니다. 인수자가 아닌 유저는 현물과 레버리지 거래를 할 수 있어요.
                  </p>
                  {data.hostileTakeover && (
                    <div className="mt-3 rounded-2xl bg-base-100/80 p-3 text-left text-xs font-bold">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <p><span className="block text-base-content/50">대상 회사 시가총액</span><strong className="tabular-nums">{formatMoney(data.hostileTakeover.targetMarketCap)}</strong></p>
                        <p><span className="block text-base-content/50">5배 자격 기준</span><strong className="tabular-nums">{formatMoney(hostileRequiredBalance)}</strong></p>
                        <p><span className="block text-base-content/50">내 총평가금액</span><strong className="tabular-nums">{formatMoney(data.hostileTakeover.userTotalEvaluatedAsset)}</strong></p>
                        <p><span className="block text-base-content/50">내 현금 / 인수 대금</span><strong className="tabular-nums">{formatMoney(data.hostileTakeover.userCashBalance)} / {formatMoney(hostileCost)}</strong></p>
                      </div>
                      {!data.hostileTakeover.valuationComplete && <p className="mt-2 text-error">총평가금액 산출이 불완전합니다.</p>}
                      <button
                        className="btn btn-outline btn-error mt-3 min-h-11 w-full rounded-2xl"
                        disabled={busy || !data.hostileTakeover.meetsAssetRequirement || !data.hostileTakeover.hasEnoughCash}
                        onClick={() => executeAction('/hostile-takeover/declare', '적대적 M&A 공개 입찰')}
                      >
                        적대적 M&A 공개 입찰 · 인수 대금 {formatMoney(hostileCost)}
                      </button>
                    </div>
                  )}
                  {false && data.hostileTakeover && (
                    <button
                      className="btn btn-outline btn-error mt-3 min-h-11 w-full rounded-2xl"
                      disabled={busy || !data.hostileTakeover.meetsAssetRequirement || !data.hostileTakeover.hasEnoughCash}
                      onClick={() => executeAction('/hostile-takeover/declare', '적대적 M&A 공개 입찰')}
                    >
                      적대적 M&A 공개 입찰 · 공격 자금 {formatMoney(hostileCost)} · 필요 보유액 {formatMoney(hostileRequiredBalance)}
                    </button>
                  )}
                </div>
              )}

              <div className="mb-4">
                <label className="text-xs font-bold text-base-content/50 block mb-2">레버리지 선택</label>
                <div className="join w-full">
                  {[1, 2, 5, 10, 50, 100].map(x => (
                    <button 
                      key={x} 
                      className={`join-item btn btn-sm flex-1 ${leverage === x ? (x >= 50 ? "btn-error" : "btn-primary") : "bg-base-200"}`}
                      disabled={x > 1 && (isLeverageBlocked || x > maxAllowedLeverage)}
                      onClick={() => { setLeverage(x); setShowLeverageWarning(false); }}
                    >
                      {x}x
                    </button>
                  ))}
                </div>
                <p className="text-[10px] mt-1 text-base-content/50 text-right">
                  {leverage === 1
                    ? "일반 현물 거래"
                    : isLeverageBlocked
                      ? "상장폐지 위험 종목은 레버리지 거래를 할 수 없어요."
                      : leverage > maxAllowedLeverage
                        ? `이 종목은 최대 ${maxAllowedLeverage}배까지만 가능해요.`
                        : leverage <= 5 ? "손익이 더 크게 움직여요." : leverage <= 10 ? "높은 변동성에 주의하세요." : leverage === 50 ? "작은 하락에도 청산될 수 있어요." : "매우 위험해요. 1% 하락에도 청산될 수 있어요."}
                </p>
              </div>

              <div className="mb-4">
                <label className="text-xs font-bold text-base-content/50 mb-2 flex justify-between items-end gap-2">
                  <span>{leverage === 1 ? "매수 예산 (수수료 포함)" : "포지션 예산 (수수료 포함)"}</span>
                  <span>보유 잔액: {formatMoney(user.balance)}</span>
                </label>
                <div className="flex flex-col gap-1">
                  <div className="flex gap-2">
                    {leverage > 1 && (
                      <div className="join mr-2 bg-base-200 p-1 rounded-2xl shrink-0">
                        <button 
                          className={`join-item btn btn-sm rounded-xl ${positionSide === 'long' ? 'btn-success text-white' : 'btn-ghost'}`}
                          onClick={() => setPositionSide('long')}
                        >
                          LONG
                        </button>
                        <button 
                          className={`join-item btn btn-sm rounded-xl ${positionSide === 'short' ? 'btn-error text-white' : 'btn-ghost'}`}
                          onClick={() => setPositionSide('short')}
                        >
                          SHORT
                        </button>
                      </div>
                    )}
                    <input 
                      type="number" 
                      className="input input-bordered flex-1 min-w-0 rounded-2xl" 
                      placeholder="0"
                      value={amountInput}
                      onChange={e => setAmountInput(e.target.value)}
                    />
                    <button 
                      className={`btn rounded-2xl px-6 shrink-0 ${leverage >= 50 ? "btn-error" : leverage > 1 ? (positionSide === 'long' ? "btn-success" : "btn-error") : "btn-primary"}`} 
                      disabled={busy || !amountInput || Number(amountInput) <= 0 || isTradeBlocked || isSelectedLeverageBlocked || (leverage === 1 && (!buyPreview || buyPreview.quantity <= 0))}
                      onClick={handleBuy}
                    >
                      {busy ? <span className="loading loading-spinner loading-sm"/> : (leverage === 1 ? (buyPreview?.quantity > 0 ? `${Number(buyPreview.quantity).toLocaleString("ko-KR")}주 매수` : "매수") : `${positionSide === 'long' ? 'LONG' : 'SHORT'} 오픈`)}
                    </button>
                  </div>
                  {amountInput && Number(amountInput) > 0 && (
                    <div className="text-right text-xs mt-1 font-bold text-primary pr-2">
                      {leverage === 1 ? `입력 예산: ${formatCompactMoney(amountInput)}` : formatCompactMoney(amountInput)}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-1 mt-2">
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => addValue(10000)}>+1만</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => addValue(100000)}>+10만</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => addValue(1000000)}>+100만</button>
                  <button className="btn btn-xs rounded-lg bg-base-200 ml-auto" onClick={() => setPercent(0.1)}>10%</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => setPercent(0.25)}>25%</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => setPercent(0.5)}>50%</button>
                  <button className="btn btn-xs rounded-lg bg-base-200" onClick={() => setPercent(1)}>100%</button>
                  <button className="btn btn-xs rounded-lg bg-base-200 font-bold text-primary" onClick={() => setPercent(1)}>전재산</button>
                  <button className="btn btn-xs rounded-lg btn-ghost" onClick={() => setAmountInput("")}>초기화</button>
                </div>
                {leverage === 1 && <StockBuyPreview preview={buyPreview} />}
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

              {message && <p className="text-success text-sm font-bold mt-2">{message}</p>}
            </div>
          )}
        </BaseCard>

        <BaseCard className="">
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
                  <>
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
                      disabled={busy || isTradeBlocked} 
                      onClick={handleSell}
                    >
                      {busy ? <span className="loading loading-spinner loading-xs"/> : "매도"}
                    </button>
                  </div>
                  {sellPreview && (
                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl bg-base-100/70 px-3 py-2 text-[11px] font-bold tabular-nums text-base-content/65">
                      <span>총 매도금액</span><span className="text-right">{formatMoney(sellPreview.grossSellAmount)}</span>
                      <span>매도 수수료</span><span className="text-right">{formatMoney(sellPreview.sellFee)}</span>
                      <span>매수 원가</span><span className="text-right">{formatMoney(sellPreview.costBasis)}</span>
                      <span>세전 실현수익</span><span className="text-right">{formatSignedMoney(sellPreview.realizedProfitBeforeTax)}</span>
                      <span>누진 양도소득세</span><span className="text-right">{formatMoney(sellPreview.capitalGainsTax)}</span>
                      <span>세후 순수익</span><span className="text-right">{formatSignedMoney(sellPreview.finalProfit)}</span>
                      <span>최종 수령액</span><span className="text-right">{formatMoney(sellPreview.finalReceiveAmount)}</span>
                      {sellPreview.capitalGainsTax > 0 && <span className="col-span-2 text-primary">양도소득세 전액이 오늘의 잭팟에 적립됩니다.</span>}
                    </div>
                  )}
                  </>
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
                  const rawUnrealized = p.side === "short"
                    ? (p.entry_price - stock.current_price) * p.quantity
                    : (stock.current_price - p.entry_price) * p.quantity;
                  const unrealized = Number.isFinite(Number(p.live_unrealized_pnl))
                    ? Number(p.live_unrealized_pnl)
                    : Math.floor(rawUnrealized);
                  const danger = p.side === "short"
                    ? stock.current_price >= p.entry_price + (p.liquidation_price - p.entry_price) * 0.8
                    : stock.current_price <= p.entry_price - (p.entry_price - p.liquidation_price) * 0.8;
                  
                  return (
                    <div key={p.id} className={`bg-base-200/50 p-4 rounded-2xl border ${danger ? "border-error/50" : "border-transparent"}`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-bold text-sm flex items-center gap-2">
                          <span className={p.side === 'short' ? 'text-error' : 'text-success'}>
                            {p.side === 'short' ? 'SHORT' : 'LONG'} {p.leverage}x
                          </span>
                          <span className="text-xs font-normal text-base-content/50">진입 {formatMoney(p.entry_price)}</span>
                        </span>
                        <span className={`font-bold text-sm ${unrealized >= 0 ? "text-success" : "text-error"}`}>
                          {formatSignedMoney(unrealized)} ({unrealized >= 0 ? "+" : ""}{((unrealized / p.margin_amount) * 100).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)
                        </span>
                      </div>
                      <div className="flex justify-between text-[11px] text-base-content/60 mb-3">
                        <span>증거금: {formatMoney(p.margin_amount)}</span>
                        <span>청산가: <span className="font-bold text-error">{formatMoney(p.liquidation_price)}</span></span>
                      </div>
                      {p.profit_cap_applied && (
                        <p className="mb-3 rounded-xl bg-warning/15 px-3 py-2 text-[11px] font-bold text-warning">
                          급등락 위험으로 수익 상한이 적용되었어요.
                        </p>
                      )}
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
        </BaseCard>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <StockTopList
          title="대주주 TOP 5"
          emptyText="아직 이 종목을 많이 보유한 유저가 없어요."
          rows={topHolders}
          type="holders"
        />
        <StockTopList
          title="레버리지 TOP 5"
          emptyText="아직 열린 레버리지 포지션이 없어요."
          rows={topPositions}
          type="positions"
        />
      </div>

      <BaseCard className="mt-6">
        <SectionHeader title="내 매매 기록" eyebrow="MY STOCK TRADES" className="mb-4" />
        {trades.length === 0 ? (
          <p className="rounded-2xl bg-base-200/60 p-5 text-center text-sm font-bold text-base-content/45">
            아직 이 종목의 매매 기록이 없어요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr className="text-xs">
                  <th>시간</th>
                  <th>구분</th>
                  <th className="text-right">수량</th>
                  <th className="text-right">당시 가격</th>
                  <th className="text-right">거래 금액</th>
                  <th className="text-right">수익</th>
                  <th className="text-right">수익률</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => {
                  const realizedPnl = Number(trade.realizedPnl || 0);
                  const hasPnl = realizedPnl !== 0;
                  const profitRate = Number(trade.profitRate);
                  const detail = trade.detail || {};
                  const feeAmount = Number(detail.buyFee || detail.sellFee || detail.openFee || detail.closeFee || 0);
                  const taxAmount = Number(detail.capitalGainsTax || 0);
                  const prizeContribution = Number(detail.prizeContribution || detail.jackpotPoolContribution || 0);
                  const finalReceiveAmount = Number(detail.finalReceiveAmount || detail.finalPayout || 0);
                  return (
                    <Fragment key={trade.id}>
                      <tr className="text-xs font-bold">
                        <td className="whitespace-nowrap text-base-content/50">
                          {new Date(trade.createdAt).toLocaleString("ko-KR", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="whitespace-nowrap">
                          <span className="badge badge-outline badge-sm font-black">
                            {formatTradeType(trade.tradeType, trade.leverage)}
                          </span>
                        </td>
                        <td className="text-right tabular-nums">
                          {Number(trade.quantity || 0).toLocaleString("ko-KR", {
                            maximumFractionDigits: 4,
                          })}
                        </td>
                        <td className="text-right tabular-nums">{formatMoney(trade.price)}</td>
                        <td className="text-right tabular-nums">{formatMoney(trade.amount)}</td>
                        <td className={`text-right tabular-nums ${hasPnl ? (realizedPnl > 0 ? "text-success" : "text-error") : "text-base-content/35"}`}>
                          {hasPnl ? formatSignedMoney(realizedPnl) : "-"}
                        </td>
                        <td className={`text-right tabular-nums ${hasPnl ? (profitRate > 0 ? "text-success" : "text-error") : "text-base-content/35"}`}>
                          {hasPnl && Number.isFinite(profitRate)
                            ? formatRate(profitRate)
                            : "-"}
                        </td>
                      </tr>
                      {(feeAmount > 0 || taxAmount > 0 || prizeContribution > 0 || finalReceiveAmount > 0) && (
                        <tr className="border-b border-base-200/70">
                          <td colSpan={7} className="pb-3 pt-0">
                            <div className="flex flex-wrap gap-2 rounded-xl bg-base-200/45 px-3 py-2 text-[11px] font-bold text-base-content/60">
                              {feeAmount > 0 && <span>거래 수수료 {formatMoney(feeAmount)}</span>}
                              {detail.realizedProfitBeforeTax !== undefined && <span>세전 수익 {formatSignedMoney(detail.realizedProfitBeforeTax)}</span>}
                              {detail.realizedPnlBeforeTax !== undefined && <span>세전 손익 {formatSignedMoney(detail.realizedPnlBeforeTax)}</span>}
                              {taxAmount > 0 && <span>누진 양도소득세 {formatMoney(taxAmount)}</span>}
                              {prizeContribution > 0 && <span>잭팟 적립 {formatMoney(prizeContribution)}</span>}
                              {finalReceiveAmount > 0 && <span>최종 수령 {formatMoney(finalReceiveAmount)}</span>}
                              {detail.taxType === "progressive" && <span className="text-primary">순수익 구간별 누진세</span>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </BaseCard>

      <BaseCard className="mt-6">
        <SectionHeader title="관련 공지/뉴스" eyebrow="RELATED NOTICES & NEWS" className="mb-4" />
        {events.length === 0 ? (
          <p className="rounded-2xl bg-base-200/60 p-5 text-center text-sm font-bold text-base-content/45">
            이 종목에 등록된 시장 공지 또는 뉴스가 없어요.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-base-300 bg-base-100">
            <ul className="divide-y divide-base-300">
              {events.map((ev) => {
                let badgeColor = "bg-base-200 text-base-content";
                let badgeText = "공지";
                if (ev.event_type === "admin_good_news") {
                  badgeColor = "bg-success/20 text-success";
                  badgeText = "호재";
                } else if (ev.event_type === "admin_bad_news") {
                  badgeColor = "bg-error/20 text-error";
                  badgeText = "악재";
                } else if (ev.event_type === "admin_blue_chip_selected") {
                  badgeColor = "bg-primary/20 text-primary";
                  badgeText = "우량주 선정";
                } else if (ev.event_type === "admin_price_target_started") {
                  if (ev.sentiment === "bad") {
                    badgeColor = "bg-error/20 text-error";
                    badgeText = "악재";
                  } else {
                    badgeColor = "bg-success/20 text-success";
                    badgeText = "호재";
                  }
                } else if (ev.event_type === "admin_stock_manual_adjust") {
                  badgeColor = "bg-base-300 text-base-content";
                  badgeText = "조정";
                }

                const hasChangeRate = ev.change_rate !== null && ev.change_rate !== undefined && ev.change_rate !== 0;
                const changeRateVal = Number(ev.change_rate || 0) * 100;
                const changeRateText = `${changeRateVal > 0 ? "+" : ""}${changeRateVal.toFixed(1)}%`;

                return (
                  <li key={ev.id} className="p-4 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[10px] font-black px-2 py-1 rounded-lg shrink-0 ${badgeColor}`}>
                        {badgeText}
                      </span>
                      <h4 className="font-black text-sm text-base-content flex-1">{ev.title}</h4>
                      {hasChangeRate && (
                        <span className={`badge badge-sm font-black ${changeRateVal > 0 ? "badge-success text-success-content" : "badge-error text-error-content"}`}>
                          {changeRateText}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-base-content/75 leading-relaxed font-bold break-all whitespace-pre-line">
                      {ev.message}
                    </p>
                    <span className="text-[9px] text-base-content/40 font-bold self-end">
                      {new Date(ev.created_at).toLocaleString("ko-KR")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </BaseCard>

      {/* ACQUISITION PANEL */}
      {!isAcquired && !isDelisted && stock.status !== 'ipo' && (
        <BaseCard className="mt-6 border-2 border-primary/20 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div>
            <h3 className="font-black text-lg mb-1 flex items-center gap-2">🏢 회사 인수 <span className="badge badge-primary badge-sm">ETF 전환</span></h3>
            <p className="text-sm text-base-content/60 leading-relaxed">
              인수 비용은 <strong>{formatMoney(acquisitionCost)}</strong>이며, 인수하려면 총 평가자산이 <strong>{formatMoney(acquisitionRequiredTotalAsset)}</strong> 이상이어야 해요.<br />
              현재 총 평가자산 <strong>{formatMoney(acquisitionUserTotalAsset)}</strong> · 인수 가능 현금 <strong>{formatMoney(acquisitionEstimatedCash)}</strong>
              {acquisitionEstimatedCash < acquisitionCost && " · 인수 비용만큼의 현금도 필요해요."}<br />
              인수된 회사는 '인수자 자산 추종 ETF'가 되어 오너의 자산 변화를 따라갑니다.
              {!canAcquireCompany && (
                <span className="mt-2 block font-black text-error">
                  {formatAcquisitionReason(acquisitionInfo.reason)}
                </span>
              )}
            </p>
          </div>
          <button 
            className="btn btn-primary rounded-2xl px-6 shrink-0" 
            disabled={!canAcquireCompany || busy}
            onClick={() => setShowAcquireConfirm(true)}
          >
            회사 인수하기
          </button>
        </BaseCard>
      )}

      {/* OWNER PANEL */}
      {isOwner && isAcquired && (
        <BaseCard className="mt-6 border-2 border-warning/30 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div>
            <h3 className="font-black text-lg mb-1 text-warning">👑 오너 권한</h3>
            <p className="text-sm text-base-content/60 leading-relaxed">
              당신은 이 회사의 소유자입니다. 회사를 상장폐지시키거나 다시 일반 주식으로 되돌릴 수 있으며, 회사 제목, 종목코드, 종목 설명을 수정할 수 있습니다.<br />
              일반 주식으로 되돌릴 경우, 인수에 사용했던 금액의 50%를 돌려받습니다.
            </p>
          </div>
          <div className="flex flex-col gap-2 shrink-0 w-full sm:w-auto">
            <button 
              className="btn btn-warning rounded-2xl w-full" 
              disabled={busy}
              onClick={() => {
                setEditName(stock.name);
                setEditSymbol(stock.symbol);
                setEditDescription(stock.description || "");
                setShowEditMetaModal(true);
              }}
            >
              회사 정보 수정
            </button>
            <button 
              className="btn btn-outline rounded-2xl w-full" 
              disabled={busy}
              onClick={() => executeAction('/revert-by-owner', '일반 주식으로 되돌리기')}
            >
              일반 주식으로 되돌리기 (50% 환불)
            </button>
            <button 
              className="btn btn-error btn-outline rounded-2xl w-full" 
              disabled={busy}
              onClick={() => setShowDelistConfirm(true)}
            >
              상장폐지 실행
            </button>
          </div>
        </BaseCard>
      )}

      {/* MODALS */}
      {showAcquireConfirm && (
        <ConfirmModal 
          isOpen={showAcquireConfirm}
          title="정말 회사를 인수할까요?" 
          message={`비용으로 ${formatMoney(acquisitionCost)}이 차감되며, 인수 전 총 평가자산 ${formatMoney(acquisitionRequiredTotalAsset)} 이상과 현금 ${formatMoney(acquisitionCost)} 이상이 필요합니다. 이 종목은 인수자 자산 추종 ETF로 변환됩니다.`}
          onConfirm={handleAcquire} 
          onCancel={() => setShowAcquireConfirm(false)}
          confirmText="회사 인수하기"
          isBusy={busy}
        />
      )}

      {showDelistConfirm && (
        <ConfirmModal 
          isOpen={showDelistConfirm}
          title="정말 이 회사를 상장폐지할까요?" 
          message="상장폐지되면 이 종목을 보유한 유저들의 주식 가치는 0원이 되며, 레버리지 포지션은 즉시 청산됩니다. 이 행동은 되돌릴 수 없습니다!" 
          isDanger 
          onConfirm={handleDelistByOwner} 
          onCancel={() => setShowDelistConfirm(false)}
          confirmText="상장폐지 실행"
          isBusy={busy}
        />
      )}

      {showEditMetaModal && (
        <div className="modal modal-open">
          <div className="modal-box rounded-3xl border border-base-300 shadow-xl max-w-md bg-base-100 text-base-content">
            <h3 className="font-black text-lg mb-4 text-base-content">🏢 회사 정보 수정</h3>
            <p className="text-xs text-base-content/50 mb-4">인수한 회사(ETF)의 이름, 종목코드, 설명을 원하는 대로 수정할 수 있습니다.</p>
            
            <div className="grid gap-4">
              <label className="form-control">
                <span className="label-text mb-1 font-bold">회사 제목</span>
                <input
                  className="input input-bordered w-full h-12 rounded-2xl font-bold"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="예: 행운글로벌"
                  maxLength={30}
                />
                <span className="text-[10px] text-base-content/40 mt-1 pl-1">회사명에는 비속어가 포함될 수 없습니다.</span>
              </label>

              <label className="form-control">
                <span className="label-text mb-1 font-bold">회사 종목코드 (심볼)</span>
                <input
                  className="input input-bordered w-full h-12 rounded-2xl font-bold uppercase"
                  type="text"
                  value={editSymbol}
                  onChange={(e) => setEditSymbol(e.target.value)}
                  placeholder="예: HW-GB"
                  maxLength={12}
                />
                <span className="text-[10px] text-base-content/40 mt-1 pl-1">영문 대문자, 숫자, 대시(-)로 이루어진 2~12자리 코드</span>
              </label>

              <label className="form-control">
                <span className="label-text mb-1 font-bold">종목 설명</span>
                <textarea
                  className="textarea textarea-bordered w-full min-h-[80px] rounded-2xl font-bold py-3"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="회사의 사업 분야나 투자 요약에 대해 간단히 입력해 주세요."
                  maxLength={200}
                />
              </label>
            </div>

            <div className="modal-action mt-6 gap-2">
              <button
                type="button"
                className="btn btn-outline rounded-2xl flex-1 h-12"
                onClick={() => setShowEditMetaModal(false)}
              >
                취소
              </button>
              <button
                type="button"
                className="btn btn-primary rounded-2xl flex-1 h-12"
                disabled={busy || !editName.trim() || !editSymbol.trim()}
                onClick={handleUpdateMeta}
              >
                {busy ? <span className="loading loading-spinner loading-sm" /> : "수정 완료"}
              </button>
            </div>
          </div>
        </div>
      )}

      <StockActionErrorDialog
        open={Boolean(actionError)}
        title={actionError?.title}
        message={actionError?.message}
        onClose={() => setActionError(null)}
      />

    </PageContainer>
  );
}

function formatRate(rate) {
  const value = Number(rate || 0) * 100;
  return `${value > 0 ? "+" : ""}${value.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

const EOK = 100_000_000;
const JO = 1_000_000_000_000;
const LEVERAGE_BLOCKED_STATUSES = new Set([
  "caution",
  "distress_review",
  "delist_review",
  "recovery",
  "final_crash",
  "delisted",
  "ipo_subscription",
]);

function isClientLeverageBlocked(stock) {
  return (
    stock.is_etf === 1 ||
    stock.isEtf === true ||
    LEVERAGE_BLOCKED_STATUSES.has(stock.status) ||
    LEVERAGE_BLOCKED_STATUSES.has(stock.delist_risk_status) ||
    Number(stock.market_cap || 0) < 60 * EOK ||
    stock.market_cap_tier === "danger_micro"
  );
}

function getClientMaxAllowedLeverage(stock) {
  if (isClientLeverageBlocked(stock)) return 1;
  if (stock.is_bluechip === 1 || stock.isBlueChip === true || stock.is_blue_chip === 1) return 100;
  const marketCap = Number(stock.market_cap || 0);
  if (marketCap >= 1 * JO) return 50;
  if (marketCap >= 5_000 * EOK) return 20;
  if (marketCap >= 1_000 * EOK) return 10;
  if (marketCap >= 300 * EOK) return 5;
  if (marketCap >= 100 * EOK) return 2;
  return 1;
}

function formatTradeType(type, leverage = 1) {
  const labels = {
    buy: "현물 매수",
    sell: "현물 매도",
    open_long: `롱 진입 ${leverage}x`,
    open_short: `숏 진입 ${leverage}x`,
    open_position: `포지션 진입 ${leverage}x`,
    close_long: `롱 청산 ${leverage}x`,
    close_short: `숏 청산 ${leverage}x`,
    close_position: `포지션 청산 ${leverage}x`,
    liquidation_long: `롱 강제청산 ${leverage}x`,
    liquidation_short: `숏 강제청산 ${leverage}x`,
    liquidation: `강제청산 ${leverage}x`,
    stock_auto_sell_acquire: "인수 전 자동매도",
    stock_auto_close_acquire: "인수 전 자동청산",
    acquire: "회사 인수",
    hostile_takeover: "적대적 M&A",
  };
  return labels[type] || type;
}

function formatAcquisitionReason(reason) {
  const labels = {
    bluechip: "우량주는 인수할 수 없어요.",
    already_acquired: "이미 인수된 종목이에요.",
    already_owns_company: "이미 인수한 회사가 있어요.",
    total_asset_required: "총 평가자산이 인수 조건보다 부족해요.",
    cash_required: "인수 비용으로 사용할 현금이 부족해요.",
    not_tradable: "현재 인수할 수 없는 종목이에요.",
  };
  return labels[reason] || "현재 인수 조건을 만족하지 못했어요.";
}

function StockTopList({ title, emptyText, rows, type }) {
  return (
    <BaseCard className=" min-w-0">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <p className="eyebrow">Stock ranking</p>
          <h2 className="section-title text-xl">{title}</h2>
        </div>
        <span className="badge badge-primary badge-outline font-black">
          TOP {Math.min(5, rows.length || 5)}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-base-200/50 p-5 text-center text-sm font-bold text-base-content/45">
          {emptyText}
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) =>
            type === "holders" ? (
              <article
                key={`${type}-${row.rank}-${row.userId}`}
                className="rounded-2xl border border-base-300/60 bg-base-100/80 p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block truncate text-base">
                      {row.rank}위 {row.nickname}
                    </strong>
                    <p className="mt-1 text-xs font-bold text-base-content/50">
                      보유 {Number(row.quantity).toLocaleString("ko-KR")}주 · 평균 {formatMoney(row.averagePrice)}
                    </p>
                  </div>
                  <strong className="shrink-0 tabular-nums text-primary">
                    {formatMoney(row.holdingValue)}
                  </strong>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-bold text-base-content/60">
                  <span>현재가 {formatMoney(row.currentPrice)}</span>
                  <span className={row.profit >= 0 ? "text-success" : "text-error"}>
                    손익 {formatSignedMoney(row.profit)} · {formatRate(row.profitRate)}
                  </span>
                </div>
              </article>
            ) : (
              <article
                key={`${type}-${row.rank}-${row.userId}`}
                className="rounded-2xl border border-base-300/60 bg-base-100/80 p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block truncate text-base">
                      {row.rank}위 {row.nickname}
                    </strong>
                    <p className="mt-1 text-xs font-bold text-base-content/50">
                      <span className={row.side === "short" ? "text-error" : "text-success"}>
                        {row.side === "short" ? "숏" : "롱"} {row.leverage}x
                      </span>
                    </p>
                  </div>
                  <strong className="shrink-0 tabular-nums text-primary">
                    {formatMoney(row.positionSize)}
                  </strong>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-bold text-base-content/60">
                  <span>보유 {Number(row.quantity).toLocaleString("ko-KR")}주</span>
                  <span>진입가 {formatMoney(row.entryPrice)}</span>
                  <span>현재가 {formatMoney(row.currentPrice)}</span>
                  <span>청산가 {formatMoney(row.liquidationPrice)}</span>
                  <span className={`col-span-2 ${row.unrealizedPnl >= 0 ? "text-success" : "text-error"}`}>
                    미실현 손익 {formatSignedMoney(row.unrealizedPnl)} · {formatRate(row.profitRate)}
                  </span>
                </div>
              </article>
            ),
          )}
        </div>
      )}
    </BaseCard>
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

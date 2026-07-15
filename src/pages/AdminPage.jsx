import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useEnterConfirm } from "../hooks/useEnterConfirm";
import { formatMoney } from "../utils/format";
import { PageContainer, SectionHeader, BaseCard } from "../components/ui";

const adminResetOptions = [
  {
    key: "balance",
    label: "자산·금액",
    description: "잔액과 최고 자산을 500만원으로, 누적 손익을 0원으로 초기화",
  },
  {
    key: "games",
    label: "게임 기록·횟수",
    description: "게임 로그, 진행 중 게임, 배팅액, 승리·패배 횟수를 초기화",
  },
  {
    key: "achievements",
    label: "업적",
    description: "획득한 모든 업적과 업적 보상 기록을 초기화",
  },
  {
    key: "history",
    label: "활동 기록",
    description: "자산 변동 기록과 보내고 받은 송금 기록을 삭제",
  },
  {
    key: "stocks",
    label: "주식·회사",
    description: "보유 주식, 포지션, 거래 기록을 삭제하고 인수한 회사를 상장폐지",
  },
  {
    key: "mine",
    label: "탄광",
    description: "채굴 기록, 채굴 횟수, 누적 채굴액과 마지막 채굴 시간을 초기화",
  },
  {
    key: "account",
    label: "계정 부가 상태",
    description: "닉네임 변경 횟수, 파산 횟수·날짜와 회생 신청 기록을 초기화",
  },
];

const allAdminResetTargets = adminResetOptions.map((option) => option.key);

export default function AdminPage() {
  const { user, authenticate, refreshUser } = useAuth();
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({
    users: [],
    total: 0,
    totalPages: 1,
    page: 1,
  });
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [activeUser, setActiveUser] = useState(null);
  const [newNickname, setNewNickname] = useState("");
  const [singleBalance, setSingleBalance] = useState("");
  const [singleTickets, setSingleTickets] = useState("");
  const [bulkBalance, setBulkBalance] = useState("");
  const [stocks, setStocks] = useState([]);
  const [stockAdjust, setStockAdjust] = useState({
    stockId: "",
    mode: "percent",
    direction: "up",
    value: "",
    targetPrice: "",
    reason: "",
    newsTitle: "",
    newsContent: "",
    publishNews: true,
  });
  const [stockTarget, setStockTarget] = useState({
    stockId: "",
    targetPrice: "",
    percentPerTick: "",
    reason: "",
    newsTitle: "",
    newsContent: "",
    publishNews: true,
  });
  const [blueChipModalOpen, setBlueChipModalOpen] = useState(false);
  const [blueChipStockId, setBlueChipStockId] = useState("");
  const [blueChipTargetPrice, setBlueChipTargetPrice] = useState("");
  const [blueChipRampPercent, setBlueChipRampPercent] = useState("30");
  const [blueChipReason, setBlueChipReason] = useState("우량주 편입 이벤트");
  const [blueChipNewsTitle, setBlueChipNewsTitle] = useState("");
  const [blueChipNewsContent, setBlueChipNewsContent] = useState("");
  const [blueChipPublishNews, setBlueChipPublishNews] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [marketOpen, setMarketOpen] = useState(null);
  const [seasonInfo, setSeasonInfo] = useState(null);
  const [seasonRewardPreview, setSeasonRewardPreview] = useState(null);
  const [etfInterestSummary, setEtfInterestSummary] = useState(null);
  const [jackpotInfo, setJackpotInfo] = useState(null);
  const [jackpotAmount, setJackpotAmount] = useState("");
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [economyAudit, setEconomyAudit] = useState(null);
  const [consistencyResult, setConsistencyResult] = useState(null);
  const [stockFeeConfig, setStockFeeConfig] = useState(null);
  const [suspendedGames, setSuspendedGames] = useState({});
  const [showAllSuspicious, setShowAllSuspicious] = useState(false);
  const [showAllConsistencyIssues, setShowAllConsistencyIssues] = useState(false);
  const [nicknameConfirmOpen, setNicknameConfirmOpen] = useState(false);
  const [balanceConfirm, setBalanceConfirm] = useState(null);
  const [resetConfirmIds, setResetConfirmIds] = useState([]);
  const [seasonConfirmOpen, setSeasonConfirmOpen] = useState(false);
  const [resetTargets, setResetTargets] = useState(() => [
    ...allAdminResetTargets,
  ]);

  const loadUsers = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api(
        `/admin/users/search?q=${encodeURIComponent(query)}&page=${page}&pageSize=50`,
      );
      setResult(data);
      if (activeUser) {
        const refreshed = data.users.find((item) => item.id === activeUser.id);
        if (refreshed) setActiveUser(refreshed);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [page, query]);

  useEffect(() => {
    api("/admin/stocks/market/status")
      .then((data) => setMarketOpen(data.marketOpen))
      .catch((requestError) => setError(requestError.message));
    api("/seasons/current")
      .then(setSeasonInfo)
      .catch(() => {});
    api("/admin/jackpot")
      .then((data) => {
        setJackpotInfo(data);
        setJackpotAmount(String(data.jackpotPool || 0));
      })
      .catch((requestError) => setError(requestError.message));
    api("/stocks")
      .then((data) => {
        const list = (data.stocks || []).filter((stock) => stock.status !== "delisted");
        setStocks(list);
        setStockAdjust((current) => ({
          ...current,
          stockId: current.stockId || String(list[0]?.id || ""),
        }));
        setStockTarget((current) => ({
          ...current,
          stockId: current.stockId || String(list[0]?.id || ""),
        }));
        setBlueChipStockId((current) => current || String(list[0]?.id || ""));
      })
      .catch(() => {});
    loadAdminInsights();
  }, []);

  const loadAdminInsights = async () => {
    try {
      const [summary, audit, feeConfig, gameStatus] = await Promise.all([
        api("/admin/dashboard/summary"),
        api("/admin/economy/audit"),
        api("/stocks/fees/config"),
        api("/admin/games/status"),
      ]);
      setDashboardSummary(summary);
      setEconomyAudit(audit);
      setStockFeeConfig(feeConfig);
      setSuspendedGames(gameStatus.suspended || {});
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleToggleGameSuspend = async (gameType, suspend) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const action = suspend ? "suspend" : "resume";
      const res = await api(`/admin/games/${gameType}/${action}`, { method: "POST" });
      setMessage(res.message);
      setSuspendedGames((prev) => ({
        ...prev,
        [gameType]: suspend,
      }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const currentPageIds = useMemo(
    () => result.users.map((item) => item.id),
    [result.users],
  );
  const allCurrentPageSelected =
    currentPageIds.length > 0 &&
    currentPageIds.every((id) => selectedIds.has(id));

  const updateUsers = (updatedUsers) => {
    const byId = new Map(updatedUsers.map((item) => [item.id, item]));
    setResult((current) => ({
      ...current,
      users: current.users.map((item) => byId.get(item.id) || item),
    }));
    setActiveUser((current) => (current ? byId.get(current.id) || current : null));
  };

  const selectActiveUser = (item) => {
    setActiveUser(item || null);
    setNewNickname(item?.nickname || "");
    setSingleBalance(item ? String(item.balance ?? "") : "");
    setSingleTickets(item ? String(item.jackpotTickets ?? 0) : "");
    setMessage("");
    setError("");
  };

  const toggleUser = (userId) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleCurrentPage = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allCurrentPageSelected) {
        currentPageIds.forEach((id) => next.delete(id));
      } else {
        currentPageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const search = () => {
    setPage(1);
    setQuery(draftQuery.trim());
  };

  const forceChangeNickname = async () => {
    setNicknameConfirmOpen(false);
    if (!activeUser || !newNickname.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api(`/admin/users/${activeUser.id}/nickname`, {
        method: "POST",
        body: JSON.stringify({ newNickname }),
      });
      updateUsers([data.user]);
      setNewNickname("");
      setMessage(data.message);
      if (activeUser.id === user.id) await refreshUser();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const applyBalance = async () => {
    const pending = balanceConfirm;
    setBalanceConfirm(null);
    if (!pending?.ids.length) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api("/admin/users/bulk/balance", {
        method: "POST",
        body: JSON.stringify({
          userIds: pending.ids,
          balance: pending.balance,
        }),
      });
      updateUsers(data.users);
      setSingleBalance("");
      setBulkBalance("");
      setMessage(data.message);
      if (pending.ids.includes(user.id)) await refreshUser();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const applyUserOverride = async () => {
    if (!activeUser) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api(`/admin/users/${activeUser.id}/override`, {
        method: "PATCH",
        body: JSON.stringify({
          nickname: newNickname,
          balance: Number(singleBalance),
          luckTicketCount: Number(singleTickets),
        }),
      });
      updateUsers([data.user]);
      selectActiveUser(data.user);
      setMessage(data.message);
      if (activeUser.id === user.id) await refreshUser();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const applyStockAdjustment = async () => {
    if (!stockAdjust.stockId) return;
    const isSetPrice = stockAdjust.mode === "set_price";
    if (!isSetPrice && stockAdjust.value === "") return;
    if (isSetPrice && stockAdjust.targetPrice === "") return;

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api(`/admin/stocks/${stockAdjust.stockId}/manual-adjust`, {
        method: "POST",
        body: JSON.stringify({
          mode: stockAdjust.mode,
          direction: isSetPrice ? undefined : stockAdjust.direction,
          value: isSetPrice ? undefined : Number(stockAdjust.value),
          targetPrice: isSetPrice ? Number(stockAdjust.targetPrice) : undefined,
          reason: stockAdjust.reason,
          newsTitle: stockAdjust.newsTitle,
          newsContent: stockAdjust.newsContent,
          publishNews: stockAdjust.publishNews,
        }),
      });
      setMessage(data.message);
      const stockData = await api("/stocks");
      const list = (stockData.stocks || []).filter((stock) => stock.status !== "delisted");
      setStocks(list);
      setStockAdjust((current) => ({ ...current, value: "", targetPrice: "", reason: "", newsTitle: "", newsContent: "", publishNews: true }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const applyStockTargetPriceEvent = async () => {
    if (!stockTarget.stockId || stockTarget.targetPrice === "" || stockTarget.percentPerTick === "") return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api(`/admin/stocks/${stockTarget.stockId}/target-price`, {
        method: "POST",
        body: JSON.stringify({
          targetPrice: Number(stockTarget.targetPrice),
          percentPerTick: Number(stockTarget.percentPerTick),
          reason: stockTarget.reason,
          newsTitle: stockTarget.newsTitle,
          newsContent: stockTarget.newsContent,
          publishNews: stockTarget.publishNews,
        }),
      });
      setMessage(data.message);
      setStockTarget((current) => ({
        ...current,
        targetPrice: "",
        percentPerTick: "",
        reason: "",
        newsTitle: "",
        newsContent: "",
        publishNews: true,
      }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const applyBlueChipDesignation = async () => {
    if (!blueChipStockId || blueChipTargetPrice === "" || blueChipRampPercent === "") return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api(`/admin/stocks/${blueChipStockId}/blue-chip`, {
        method: "POST",
        body: JSON.stringify({
          targetPrice: Number(blueChipTargetPrice),
          rampPercentPerTick: Number(blueChipRampPercent),
          reason: blueChipReason,
          newsTitle: blueChipNewsTitle,
          newsContent: blueChipNewsContent,
          publishNews: blueChipPublishNews,
        }),
      });
      setMessage(data.message);
      setBlueChipModalOpen(false);
      const stockData = await api("/stocks");
      const list = (stockData.stocks || []).filter((stock) => stock.status !== "delisted");
      setStocks(list);
      setBlueChipNewsTitle("");
      setBlueChipNewsContent("");
      setBlueChipPublishNews(true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const openReset = (ids) => {
    if (!ids.length) return;
    setResetTargets([...allAdminResetTargets]);
    setResetConfirmIds(ids);
  };

  const applyReset = async () => {
    const ids = resetConfirmIds;
    setResetConfirmIds([]);
    if (!ids.length || !resetTargets.length) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api("/admin/users/bulk/reset", {
        method: "POST",
        body: JSON.stringify({ userIds: ids, targets: resetTargets }),
      });
      updateUsers(data.users);
      setMessage(data.message);
      if (ids.includes(user.id)) await refreshUser();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const forceLogin = async () => {
    if (!activeUser) return;
    setBusy(true);
    setError("");
    try {
      const data = await api(`/admin/impersonate/${activeUser.id}`, {
        method: "POST",
      });
      await authenticate(data);
      window.location.replace("/");
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  };

  const toggleMarket = async (open) => {
    if (!window.confirm(`정말로 주식장을 ${open ? "개장" : "휴장"}하시겠습니까?`)) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const endpoint = open
        ? "/admin/stocks/market/open"
        : "/admin/stocks/market/close";
      const data = await api(endpoint, { method: "POST" });
      setMarketOpen(data.marketOpen);
      setMessage(data.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const endCurrentSeason = async () => {
    setSeasonConfirmOpen(false);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api("/admin/seasons/end-current", { method: "POST" });
      setMessage(data.message);
      const current = await api("/seasons/current");
      setSeasonInfo(current);
      await loadUsers();
      await refreshUser();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const previewSeasonRewards = async () => {
    setBusy(true);
    setError("");
    try {
      setSeasonRewardPreview(await api("/admin/seasons/reward-preview"));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const settleEtfInterest = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api("/admin/etf-interest/settle-current", { method: "POST" });
      setMessage(`${data.hourKey} ETF 이자 정산: ${data.results.length}명`);
      setEtfInterestSummary(await api("/admin/etf-interest/missing"));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const catchUpEtfInterest = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api("/admin/etf-interest/catch-up", {
        method: "POST",
        body: JSON.stringify({ maxHours: 24 }),
      });
      setMessage(`ETF 이자 보정: 지급 ${data.paid.length}건 · 스냅샷 없음 ${data.skipped.length}건`);
      setEtfInterestSummary(await api("/admin/etf-interest/missing"));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const rebuildAssetSnapshots = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api("/admin/assets/snapshots/rebuild", { method: "POST" });
      setMessage(`총평가금액 스냅샷 ${data.userCount}명 재구축 완료`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const setJackpotPoolAmount = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api("/admin/jackpot", {
        method: "POST",
        body: JSON.stringify({ amount: Number(jackpotAmount) }),
      });
      setJackpotInfo(data);
      setJackpotAmount(String(data.jackpotPool || 0));
      setMessage(data.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const resetJackpotPoolAmount = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api("/admin/jackpot/reset", { method: "POST" });
      setJackpotInfo(data);
      setJackpotAmount("0");
      setMessage(data.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const drawJackpotManually = async () => {
    if (!window.confirm("오늘의 잭팟을 강제로 추첨하시겠습니까?")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api("/admin/jackpot/draw", { method: "POST" });
      setJackpotInfo(data);
      setJackpotAmount("0");
      setMessage(data.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const runEconomyAuditNow = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api("/admin/economy/audit/run", { method: "POST" });
      setEconomyAudit(data);
      const summary = await api("/admin/dashboard/summary");
      setDashboardSummary(summary);
      setMessage("경제 안정성 감사를 실행했습니다.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const runConsistencyCheckNow = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api("/admin/economy/consistency-check", { method: "POST" });
      setConsistencyResult(data);
      setMessage("자산 일관성 점검을 실행했습니다.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const selectedIdList = [...selectedIds];
  const selectedStock = stocks.find((stock) => String(stock.id) === String(stockAdjust.stockId));
  const suspiciousIssues = economyAudit?.suspiciousUsers || [];
  const displayedSuspiciousIssues = showAllSuspicious
    ? suspiciousIssues
    : suspiciousIssues.slice(0, 3);
  const consistencyIssues = consistencyResult?.issues || [];
  const displayedConsistencyIssues = showAllConsistencyIssues
    ? consistencyIssues
    : consistencyIssues.slice(0, 3);

  return (
    <PageContainer>
      <SectionHeader title="관리자 제어" eyebrow="ADMIN CONTROL CENTER" className="mb-6" />
      <p className="mt-2 text-sm font-bold text-base-content/55 mb-6">
        전체 플레이어를 검색·선택하고 단일 또는 일괄 작업을 실행합니다.
      </p>

      {dashboardSummary && (
        <section className="mb-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <BaseCard className="rounded-2xl border border-base-300 p-4 shadow-sm">
              <span className="text-xs font-black text-base-content/50">전체 유저</span>
              <strong className="mt-1 block text-xl font-black tabular-nums">
                {dashboardSummary.totalUsers.toLocaleString("ko-KR")}명
              </strong>
            </BaseCard>
            <BaseCard className="rounded-2xl border border-base-300 p-4 shadow-sm">
              <span className="text-xs font-black text-base-content/50">총 현금 자산</span>
              <strong className="mt-1 block text-xl font-black text-primary tabular-nums">
                {formatMoney(dashboardSummary.totalCashAssets)}
              </strong>
            </BaseCard>
            <BaseCard className="rounded-2xl border border-base-300 p-4 shadow-sm">
              <span className="text-xs font-black text-base-content/50">주식 평가액</span>
              <strong className="mt-1 block text-xl font-black tabular-nums">
                {formatMoney(dashboardSummary.totalStockValue)}
              </strong>
            </BaseCard>
            <BaseCard className="rounded-2xl border border-base-300 p-4 shadow-sm">
              <span className="text-xs font-black text-base-content/50">의심 계정</span>
              <strong className="mt-1 block text-xl font-black text-error tabular-nums">
                {dashboardSummary.suspiciousAccountCount.toLocaleString("ko-KR")}개
              </strong>
            </BaseCard>
            <BaseCard className="rounded-2xl border border-base-300 p-4 shadow-sm">
              <span className="text-xs font-black text-base-content/50">오늘 생성 자산</span>
              <strong className="mt-1 block text-lg font-black text-success tabular-nums">
                {formatMoney(dashboardSummary.todayCreatedAssets)}
              </strong>
            </BaseCard>
            <BaseCard className="rounded-2xl border border-base-300 p-4 shadow-sm">
              <span className="text-xs font-black text-base-content/50">오늘 제거 자산</span>
              <strong className="mt-1 block text-lg font-black text-error tabular-nums">
                {formatMoney(dashboardSummary.todayRemovedAssets)}
              </strong>
            </BaseCard>
            <BaseCard className="rounded-2xl border border-base-300 p-4 shadow-sm">
              <span className="text-xs font-black text-base-content/50">오늘 잭팟</span>
              <strong className="mt-1 block text-lg font-black text-warning tabular-nums">
                {formatMoney(dashboardSummary.todayJackpotPool)}
              </strong>
            </BaseCard>
            <BaseCard className="rounded-2xl border border-base-300 p-4 shadow-sm">
              <span className="text-xs font-black text-base-content/50">주식 위험 이벤트</span>
              <strong className="mt-1 block text-lg font-black tabular-nums">
                목표 {dashboardSummary.targetPriceEventCount} · 우량 {dashboardSummary.blueChipRampCount} · 부실 심사 {dashboardSummary.distressReviewCount || 0} · 상장폐지 심사 {dashboardSummary.delistReviewCount}
              </strong>
            </BaseCard>
          </div>
        </section>
      )}

      <section className="mb-6 grid gap-4 lg:grid-cols-2">
        <BaseCard className="rounded-3xl border border-base-300 p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <SectionHeader title="경제 안정성 감사" eyebrow="AUDIT" className="mb-2" />
              <p className="text-sm font-bold text-base-content/55">
                급격한 자산 증가, 파산·송금 루프, 레버리지 과수익을 점검합니다.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary min-h-11 rounded-2xl whitespace-nowrap"
              disabled={busy}
              onClick={runEconomyAuditNow}
            >
              감사 실행
            </button>
          </div>
          <div className="mt-4 rounded-2xl bg-base-200/55 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs font-black text-base-content/50">최근 결과</span>
                <strong className="mt-1 block text-lg font-black tabular-nums">
                  의심 항목 {Number(economyAudit?.summary?.suspiciousCount || 0).toLocaleString("ko-KR")}개
                </strong>
              </div>
              {suspiciousIssues.length > 3 && (
                <button
                  type="button"
                  className="btn btn-xs btn-outline min-h-8 rounded-xl"
                  onClick={() => setShowAllSuspicious((value) => !value)}
                >
                  {showAllSuspicious ? "접기" : `전체보기 ${suspiciousIssues.length.toLocaleString("ko-KR")}개`}
                </button>
              )}
            </div>
            <div className="mt-3 max-h-96 overflow-y-auto pr-1">
              {displayedSuspiciousIssues.map((issue, index) => (
                <div key={`${issue.reason}-${index}`} className="mb-2 rounded-xl bg-base-100/80 p-3 text-xs font-bold text-base-content/65">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-black text-base-content">
                      {issue.nickname || `user ${issue.userId || "-"}`}
                    </span>
                    {issue.createdAt && (
                      <span className="text-[10px] text-base-content/40">
                        {new Date(issue.createdAt).toLocaleString("ko-KR")}
                      </span>
                    )}
                  </div>
                  <p className="mt-1">{issue.reason}</p>
                  {(issue.beforeAsset !== null && issue.beforeAsset !== undefined) || (issue.afterAsset !== null && issue.afterAsset !== undefined) ? (
                    <p className="mt-1 tabular-nums text-base-content/50">
                      {issue.beforeAsset !== null && issue.beforeAsset !== undefined ? `전 ${formatMoney(issue.beforeAsset)}` : ""}
                      {issue.beforeAsset !== null && issue.beforeAsset !== undefined && issue.afterAsset !== null && issue.afterAsset !== undefined ? " → " : ""}
                      {issue.afterAsset !== null && issue.afterAsset !== undefined ? `후 ${formatMoney(issue.afterAsset)}` : ""}
                    </p>
                  ) : null}
                </div>
              ))}
              {suspiciousIssues.length === 0 && (
                <p className="text-xs font-bold text-base-content/45">의심 항목 없음</p>
              )}
            </div>
          </div>
        </BaseCard>

        <BaseCard className="rounded-3xl border border-base-300 p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <SectionHeader title="자산 일관성 점검" eyebrow="CONSISTENCY" className="mb-2" />
              <p className="text-sm font-bold text-base-content/55">
                음수 잔액, 음수 보유량, 비정상 포지션 손익을 탐지만 합니다.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-outline min-h-11 rounded-2xl whitespace-nowrap"
              disabled={busy}
              onClick={runConsistencyCheckNow}
            >
              점검 실행
            </button>
          </div>
          <div className="mt-4 rounded-2xl bg-base-200/55 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs font-black text-base-content/50">최근 실행 결과</span>
                <strong className="mt-1 block text-lg font-black tabular-nums">
                  {consistencyResult?.summary?.status || "아직 실행 안 함"}
                </strong>
              </div>
              {consistencyIssues.length > 3 && (
                <button
                  type="button"
                  className="btn btn-xs btn-outline min-h-8 rounded-xl"
                  onClick={() => setShowAllConsistencyIssues((value) => !value)}
                >
                  {showAllConsistencyIssues ? "접기" : `전체보기 ${consistencyIssues.length.toLocaleString("ko-KR")}개`}
                </button>
              )}
            </div>
            <div className="mt-3 max-h-96 overflow-y-auto pr-1">
              {displayedConsistencyIssues.map((issue, index) => (
                <p key={`${issue.message}-${index}`} className="mt-2 rounded-xl bg-base-100/80 p-3 text-xs font-bold text-base-content/60">
                  {issue.nickname || `user ${issue.userId || "-"}`} · {issue.message}
                </p>
              ))}
              {consistencyResult && consistencyIssues.length === 0 && (
                <p className="text-xs font-bold text-base-content/45">검출된 문제가 없습니다.</p>
              )}
            </div>
          </div>
        </BaseCard>
      </section>

      {stockFeeConfig && (
        <BaseCard className="mb-6 rounded-3xl border border-warning/25 p-5 shadow-sm">
          <SectionHeader title="주식 수수료·누진세 설정" eyebrow="STOCK ECONOMY" className="mb-3" />
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl bg-base-200/55 p-4">
              <p className="text-xs font-black text-base-content/50">거래 수수료율</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm font-bold">
                <span>현물 매수 {(stockFeeConfig.fees.spotBuyFeeRate * 100).toFixed(2)}%</span>
                <span>현물 매도 {(stockFeeConfig.fees.spotSellFeeRate * 100).toFixed(2)}%</span>
                <span>레버리지 진입 {(stockFeeConfig.fees.leverageOpenFeeRate * 100).toFixed(3)}%</span>
                <span>레버리지 청산 {(stockFeeConfig.fees.leverageCloseFeeRate * 100).toFixed(3)}%</span>
              </div>
            </div>
            <div className="rounded-2xl bg-base-200/55 p-4">
              <p className="text-xs font-black text-base-content/50">누진 양도소득세</p>
              <div className="mt-2 grid gap-1 text-xs font-bold">
                {stockFeeConfig.taxBrackets.map((bracket, index) => (
                  <div key={`${bracket.label}-${index}`} className="flex justify-between gap-3">
                    <span>{bracket.label}</span>
                    <span className="tabular-nums">{(bracket.rate * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] font-bold text-base-content/45">
                원금 제외. 수수료 차감 후 순수익에만 구간별 초과분 과세.
              </p>
              <p className="mt-1 text-[11px] font-bold text-primary">
                징수한 양도소득세 전액은 오늘의 잭팟에 적립되며, 주식 수익의 별도 1% 공제는 없습니다.
              </p>
            </div>
          </div>
        </BaseCard>
      )}

      <BaseCard className="border-2 border-primary/20">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="section-title text-xl">전체 플레이어</h2>
            <p className="mt-1 text-xs font-bold text-base-content/50">
              총 {result.total.toLocaleString("ko-KR")}명 · 선택{" "}
              {selectedIds.size.toLocaleString("ko-KR")}명
            </p>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row lg:max-w-2xl">
            <input
              className="input input-bordered h-12 min-w-0 flex-1 rounded-2xl"
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") search();
              }}
              placeholder="아이디 또는 닉네임 검색"
            />
            <button
              type="button"
              className="btn btn-primary h-12 whitespace-nowrap rounded-2xl"
              disabled={busy}
              onClick={search}
            >
              검색
            </button>
            {query && (
              <button
                type="button"
                className="btn btn-outline h-12 whitespace-nowrap rounded-2xl"
                disabled={busy}
                onClick={() => {
                  setDraftQuery("");
                  setQuery("");
                  setPage(1);
                }}
              >
                전체 보기
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-sm btn-outline rounded-xl"
            disabled={!currentPageIds.length}
            onClick={toggleCurrentPage}
          >
            {allCurrentPageSelected ? "현재 페이지 선택 해제" : "현재 페이지 전체 선택"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost rounded-xl"
            disabled={!selectedIds.size}
            onClick={() => setSelectedIds(new Set())}
          >
            전체 선택 해제
          </button>
        </div>

        <div className="mt-4 grid gap-2">
          {result.users.map((item) => (
            <article
              key={item.id}
              className={`grid gap-3 rounded-2xl border p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center ${
                activeUser?.id === item.id
                  ? "border-primary bg-primary/10"
                  : "border-base-300 bg-base-100"
              }`}
            >
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary"
                  checked={selectedIds.has(item.id)}
                  onChange={() => toggleUser(item.id)}
                  aria-label={`${item.nickname} 선택`}
                />
              </label>
              <button
                type="button"
                className="min-w-0 text-left"
                onClick={() => {
                  selectActiveUser(item);
                }}
              >
                <strong className="block truncate">{item.nickname}</strong>
                <span className="text-xs font-bold text-base-content/45">
                  @{item.username} · 가입 {new Date(item.createdAt).toLocaleDateString("ko-KR")}
                </span>
              </button>
              <div className="text-left sm:text-right">
                <strong className="tabular-nums text-primary">
                  {formatMoney(item.balance)}
                </strong>
                {item.isAdmin && (
                  <span className="badge badge-warning badge-sm ml-2">관리자</span>
                )}
              </div>
            </article>
          ))}
          {!busy && result.users.length === 0 && (
            <p className="rounded-2xl bg-base-200 p-6 text-center text-sm font-bold text-base-content/50">
              표시할 플레이어가 없습니다.
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            className="btn btn-sm btn-outline rounded-xl"
            disabled={busy || page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            이전
          </button>
          <span className="text-sm font-black tabular-nums">
            {result.page} / {result.totalPages}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-outline rounded-xl"
            disabled={busy || page >= result.totalPages}
            onClick={() =>
              setPage((current) => Math.min(result.totalPages, current + 1))
            }
          >
            다음
          </button>
        </div>
      </BaseCard>

      <BaseCard className="mt-6 border-2 border-secondary/30">
        <SectionHeader
          title={`선택한 ${selectedIds.size.toLocaleString("ko-KR")}명 일괄 설정`}
          eyebrow="BULK ACTIONS"
          className="mb-2"
        />
        <p className="text-xs font-bold text-base-content/50">
          관리자 본인도 선택 대상에 포함할 수 있습니다. 선택한 사용자가 없으면 실행 버튼은 비활성화됩니다.
        </p>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
          <input
            className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
            type="number"
            min="0"
            step="1"
            value={bulkBalance}
            onChange={(event) => setBulkBalance(event.target.value)}
            placeholder="모두에게 적용할 새 자산"
          />
          <button
            type="button"
            className="btn btn-warning h-12 whitespace-nowrap rounded-2xl"
            disabled={busy || selectedIds.size === 0 || bulkBalance === ""}
            onClick={() =>
              setBalanceConfirm({
                ids: selectedIdList,
                balance: Number(bulkBalance),
                label: `선택한 ${selectedIds.size}명`,
              })
            }
          >
            자산 일괄 변경
          </button>
          <button
            type="button"
            className="btn btn-error h-12 whitespace-nowrap rounded-2xl"
            disabled={busy || selectedIds.size === 0}
            onClick={() => openReset(selectedIdList)}
          >
            선택 항목 일괄 초기화
          </button>
        </div>
      </BaseCard>

      <BaseCard className="mt-6 border-2 border-primary/25">
        <SectionHeader title="개인 강제 설정" eyebrow="SINGLE PLAYER OVERRIDE" className="mb-2" />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
          <label className="form-control flex-row items-center gap-3 min-w-0">
            <span className="label-text font-bold whitespace-nowrap">유저 선택</span>
            <select
              className="select select-bordered w-full h-12 min-w-0 rounded-2xl"
              value={activeUser?.id || ""}
              onChange={(event) => {
                const selected = result.users.find((item) => String(item.id) === event.target.value);
                selectActiveUser(selected || null);
              }}
            >
              <option value="">수정할 유저를 선택하세요</option>
              {result.users.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nickname} (@{item.username})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-warning h-12 rounded-2xl"
            disabled={busy || !activeUser}
            onClick={forceLogin}
          >
            이 계정으로 강제 로그인
          </button>
          <button
            type="button"
            className="btn btn-error h-12 rounded-2xl"
            disabled={busy || !activeUser}
            onClick={() => openReset(activeUser ? [activeUser.id] : [])}
          >
            초기화 항목 선택
          </button>
        </div>

        {activeUser ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-base-300 bg-base-200/50 p-4">
                <span className="text-xs font-bold text-base-content/45">현재 자산</span>
                <strong className="mt-1 block tabular-nums">{formatMoney(activeUser.balance)}</strong>
              </div>
              <div className="rounded-2xl border border-base-300 bg-base-200/50 p-4">
                <span className="text-xs font-bold text-base-content/45">총평가금액</span>
                <strong className={`mt-1 block tabular-nums ${activeUser.assetValuationComplete === false ? "text-error" : ""}`}>
                  {activeUser.assetValuationComplete === false
                    ? "평가 오류"
                    : formatMoney(activeUser.totalEvaluatedAsset)}
                </strong>
              </div>
              <div className="rounded-2xl border border-base-300 bg-base-200/50 p-4">
                <span className="text-xs font-bold text-base-content/45">행운권 보유량</span>
                <strong className="mt-1 block tabular-nums">
                  {(activeUser.jackpotTickets || 0).toLocaleString("ko-KR")}장
                </strong>
              </div>
              <div className="rounded-2xl border border-base-300 bg-base-200/50 p-4">
                <span className="text-xs font-bold text-base-content/45">획득 업적</span>
                <strong className="mt-1 block tabular-nums">
                  {(activeUser.achievementCount || 0).toLocaleString("ko-KR")}개
                </strong>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <label className="form-control">
                <span className="label-text mb-1 block font-bold">닉네임</span>
                <input
                  className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
                  value={newNickname}
                  maxLength="12"
                  onChange={(event) => setNewNickname(event.target.value)}
                  placeholder="새 닉네임 2~12자"
                />
              </label>
              <label className="form-control">
                <span className="label-text mb-1 block font-bold">자산</span>
                <input
                  className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
                  type="number"
                  min="0"
                  step="1"
                  value={singleBalance}
                  onChange={(event) => setSingleBalance(event.target.value)}
                  placeholder="새 자산"
                />
              </label>
              <label className="form-control">
                <span className="label-text mb-1 block font-bold">행운권 보유량</span>
                <input
                  className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
                  type="number"
                  min="0"
                  step="1"
                  value={singleTickets}
                  onChange={(event) => setSingleTickets(event.target.value)}
                  placeholder="행운권 장수"
                />
              </label>
            </div>
            <button
              type="button"
              className="btn btn-primary mt-4 h-12 w-full rounded-2xl"
              disabled={busy || !newNickname.trim() || singleBalance === "" || singleTickets === ""}
              onClick={applyUserOverride}
            >
              개인 강제 설정 저장
            </button>
          </>
        ) : (
          <p className="mt-4 rounded-2xl bg-base-200 p-5 text-center text-sm font-bold text-base-content/50">
            위 목록 또는 선택창에서 유저를 고르면 닉네임, 자산, 행운권 보유량을 바로 설정할 수 있습니다.
          </p>
        )}
      </BaseCard>

      <BaseCard className="mt-6 border-2 border-primary/20">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeader title="주식장 제어" eyebrow="STOCK MARKET" className="mb-0" />
          <span
            className={`badge font-black ${
              marketOpen === false
                ? "badge-error"
                : marketOpen === true
                  ? "badge-success"
                  : "badge-ghost"
            }`}
          >
            {marketOpen === false
              ? "휴장 중"
              : marketOpen === true
                ? "개장 중"
                : "상태 확인 중"}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            className="btn btn-success h-12 rounded-2xl"
            disabled={busy || marketOpen === true}
            onClick={() => toggleMarket(true)}
          >
            주식장 개장
          </button>
          <button
            type="button"
            className="btn btn-error h-12 rounded-2xl"
            disabled={busy || marketOpen === false}
            onClick={() => toggleMarket(false)}
          >
            주식장 휴장
          </button>
          <button
            type="button"
            className="btn btn-info h-12 rounded-2xl"
            onClick={() => {
              if (stocks.length > 0) {
                setBlueChipStockId(String(stocks[0].id));
                setBlueChipTargetPrice("");
                setBlueChipRampPercent("30");
                setBlueChipReason("우량주 편입 이벤트");
                setBlueChipModalOpen(true);
              }
            }}
          >
            우량주 선정 및 급등 설정
          </button>
        </div>
      </BaseCard>

      <BaseCard className="mt-6 border-2 border-warning/25">
        <SectionHeader title="미니게임 제어" eyebrow="MINIGAMES CONTROL" className="mb-2" />
        <p className="text-xs font-bold text-base-content/50 mb-4">
          각 미니게임을 점검 상태로 전환하거나 정지를 해제합니다. 정지된 미니게임은 일반 유저의 진입이 차단됩니다.
        </p>
        <div className="overflow-x-auto">
          <table className="table w-full text-sm">
            <thead>
              <tr className="border-b border-base-300">
                <th className="bg-transparent font-black text-xs text-base-content/50">게임 이름</th>
                <th className="bg-transparent font-black text-xs text-base-content/50">현재 상태</th>
                <th className="bg-transparent font-black text-xs text-base-content/50 text-right">제어</th>
              </tr>
            </thead>
            <tbody>
              {[
                { key: "risk-button", name: "위험버튼 ☝️" },
                { key: "card-draw", name: "1부터 10 카드 🃏" },
                { key: "bomb-dodge", name: "폭탄 숫자 피하기 💣" },
                { key: "slot", name: "3자리 슬롯 🎰" },
                { key: "dart", name: "다트 던지기 🎯" },
                { key: "cup", name: "컵 속 행운 🥤" }
              ].map((g) => {
                const isSuspended = suspendedGames[g.key] === true;
                return (
                  <tr key={g.key} className="border-b border-base-200/50 hover:bg-base-200/20">
                    <td className="font-bold">{g.name}</td>
                    <td>
                      <span className={`badge badge-sm font-black rounded-lg ${isSuspended ? "badge-error text-white" : "badge-success text-white"}`}>
                        {isSuspended ? "정지됨 (점검 중)" : "정상 운영 중"}
                      </span>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className={`btn btn-xs rounded-lg font-black ${isSuspended ? "btn-success" : "btn-error"}`}
                        disabled={busy}
                        onClick={() => handleToggleGameSuspend(g.key, !isSuspended)}
                      >
                        {isSuspended ? "정지 해제" : "게임 정지"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </BaseCard>

      <BaseCard className="mt-6 border-2 border-info/25">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionHeader title="주가 즉시 조정" eyebrow="ADMIN STOCK CONTROL" className="mb-1" />
            <p className="text-xs font-bold text-base-content/50">
              선택한 종목의 현재가를 기준으로 퍼센트, 금액, 또는 직접 값을 정하여 즉시 조정합니다.
            </p>
          </div>
          <span className="badge badge-info badge-outline font-black">
            현재가 {selectedStock ? formatMoney(selectedStock.current_price || selectedStock.currentPrice) : "-"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="form-control min-w-0">
            <span className="label-text mb-1 block font-bold">종목 선택</span>
            <select
              className="select select-bordered w-full h-12 min-w-0 rounded-2xl"
              value={stockAdjust.stockId}
              onChange={(event) =>
                setStockAdjust((current) => ({ ...current, stockId: event.target.value }))
              }
            >
              {stocks.map((stock) => (
                <option key={stock.id} value={stock.id}>
                  {stock.name} · {formatMoney(stock.current_price || stock.currentPrice)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control min-w-0">
            <span className="label-text mb-1 block font-bold">사유</span>
            <input
              className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
              value={stockAdjust.reason}
              onChange={(event) =>
                setStockAdjust((current) => ({ ...current, reason: event.target.value }))
              }
              placeholder="사유 입력 (선택)"
              maxLength={120}
            />
          </label>
          <label className="form-control">
            <span className="label-text mb-1 block font-bold">조정 방식</span>
            <select
              className="select select-bordered w-full h-12 rounded-2xl"
              value={stockAdjust.mode}
              onChange={(event) =>
                setStockAdjust((current) => ({ ...current, mode: event.target.value }))
              }
            >
              <option value="percent">퍼센트(%)</option>
              <option value="amount">금액(원)</option>
              <option value="set_price">직접 가격설정(원)</option>
            </select>
          </label>
          {stockAdjust.mode !== "set_price" && (
            <label className="form-control">
              <span className="label-text mb-1 font-bold">조정 방향</span>
              <select
                className="select select-bordered h-12 rounded-2xl"
                value={stockAdjust.direction}
                onChange={(event) =>
                  setStockAdjust((current) => ({ ...current, direction: event.target.value }))
                }
              >
                <option value="up">상승</option>
                <option value="down">하락</option>
              </select>
            </label>
          )}
          <label className="form-control min-w-0">
            <span className="label-text mb-1 block font-bold">공지 제목 (선택)</span>
            <input
              className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
              value={stockAdjust.newsTitle}
              onChange={(event) =>
                setStockAdjust((current) => ({ ...current, newsTitle: event.target.value }))
              }
              placeholder="예: 신규 사업 기대감"
              maxLength={100}
            />
          </label>
          <label className="form-control min-w-0">
            <span className="label-text mb-1 block font-bold">공지 내용 (선택)</span>
            <textarea
              className="textarea textarea-bordered w-full h-12 min-w-0 rounded-2xl py-2 min-h-[48px]"
              value={stockAdjust.newsContent}
              onChange={(event) =>
                setStockAdjust((current) => ({ ...current, newsContent: event.target.value }))
              }
              placeholder={(() => {
                const selectedStockAdjustObj = stocks.find(s => String(s.id) === String(stockAdjust.stockId));
                const currentPriceAdjust = selectedStockAdjustObj ? (selectedStockAdjustObj.current_price || selectedStockAdjustObj.currentPrice) : 0;
                const adjustIsUp = stockAdjust.mode === "set_price" 
                  ? (Number(stockAdjust.targetPrice || 0) > currentPriceAdjust) 
                  : (stockAdjust.direction === "up");
                return adjustIsUp 
                  ? "예: 신규 사업 기대감으로 주가가 상승했어요." 
                  : "예: 실적 부진 우려로 주가가 하락했어요.";
              })()}
            />
          </label>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            className="checkbox checkbox-primary rounded-lg"
            checked={stockAdjust.publishNews}
            onChange={(event) =>
              setStockAdjust((current) => ({ ...current, publishNews: event.target.checked }))
            }
            id="adjustPublishNews"
          />
          <label htmlFor="adjustPublishNews" className="text-xs font-bold text-base-content/70 cursor-pointer">
            시장 공지 발행 및 행운소식 등록
          </label>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
          {stockAdjust.mode === "set_price" ? (
            <input
              className="input input-bordered h-12 min-w-0 rounded-2xl text-right tabular-nums"
              type="number"
              min="1"
              value={stockAdjust.targetPrice}
              onChange={(event) =>
                setStockAdjust((current) => ({ ...current, targetPrice: event.target.value }))
              }
              placeholder="예: 5000"
            />
          ) : (
            <input
              className="input input-bordered h-12 min-w-0 rounded-2xl text-right tabular-nums"
              type="number"
              min="0"
              step={stockAdjust.mode === "percent" ? "0.1" : "1"}
              value={stockAdjust.value}
              onChange={(event) =>
                setStockAdjust((current) => ({ ...current, value: event.target.value }))
              }
              placeholder={stockAdjust.mode === "percent" ? "예: 5" : "예: 500"}
            />
          )}
          <button
            type="button"
            className="btn btn-primary h-12 whitespace-nowrap rounded-2xl"
            disabled={
              busy ||
              !stockAdjust.stockId ||
              (stockAdjust.mode !== "set_price" && stockAdjust.value === "") ||
              (stockAdjust.mode === "set_price" && stockAdjust.targetPrice === "")
            }
            onClick={applyStockAdjustment}
          >
            즉시 적용
          </button>
        </div>
      </BaseCard>

      <BaseCard className="mt-6 border-2 border-info/25">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionHeader title="목표주가 이벤트" eyebrow="ADMIN TARGET PRICE" className="mb-1" />
            <p className="text-xs font-bold text-base-content/50">
              선택한 종목의 가격이 목표주가에 도달할 때까지 틱당 지정한 비율만큼 변동시킵니다.
            </p>
          </div>
          <span className="badge badge-info badge-outline font-black">
            현재가 {stocks.find(s => String(s.id) === String(stockTarget.stockId)) ? formatMoney(stocks.find(s => String(s.id) === String(stockTarget.stockId)).current_price || stocks.find(s => String(s.id) === String(stockTarget.stockId)).currentPrice) : "-"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="form-control min-w-0">
            <span className="label-text mb-1 block font-bold">종목 선택</span>
            <select
              className="select select-bordered w-full h-12 min-w-0 rounded-2xl"
              value={stockTarget.stockId}
              onChange={(event) =>
                setStockTarget((current) => ({ ...current, stockId: event.target.value }))
              }
            >
              {stocks.map((stock) => (
                <option key={stock.id} value={stock.id}>
                  {stock.name} · {formatMoney(stock.current_price || stock.currentPrice)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control min-w-0">
            <span className="label-text mb-1 block font-bold">사유</span>
            <input
              className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
              value={stockTarget.reason}
              onChange={(event) =>
                setStockTarget((current) => ({ ...current, reason: event.target.value }))
              }
              placeholder="사유 입력 (선택)"
              maxLength={120}
            />
          </label>
          <label className="form-control">
            <span className="label-text mb-1 block font-bold">목표주가</span>
            <input
              className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
              type="number"
              min="1"
              value={stockTarget.targetPrice}
              onChange={(event) =>
                setStockTarget((current) => ({ ...current, targetPrice: event.target.value }))
              }
              placeholder="예: 30000"
            />
          </label>
          <label className="form-control">
            <span className="label-text mb-1 block font-bold">tick당 변동률 (%)</span>
            <input
              className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
              type="number"
              min="1"
              max="100"
              value={stockTarget.percentPerTick}
              onChange={(event) =>
                setStockTarget((current) => ({ ...current, percentPerTick: event.target.value }))
              }
              placeholder="예: 20"
            />
          </label>
          <label className="form-control min-w-0">
            <span className="label-text mb-1 block font-bold">공지 제목 (선택)</span>
            <input
              className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
              value={stockTarget.newsTitle}
              onChange={(event) =>
                setStockTarget((current) => ({ ...current, newsTitle: event.target.value }))
              }
              placeholder="예: 신규 사업 기대감"
              maxLength={100}
            />
          </label>
          <label className="form-control min-w-0">
            <span className="label-text mb-1 block font-bold">공지 내용 (선택)</span>
            <textarea
              className="textarea textarea-bordered w-full h-12 min-w-0 rounded-2xl py-2 min-h-[48px]"
              value={stockTarget.newsContent}
              onChange={(event) =>
                setStockTarget((current) => ({ ...current, newsContent: event.target.value }))
              }
              placeholder={(() => {
                const targetStockObj = stocks.find(s => String(s.id) === String(stockTarget.stockId));
                const currentPrice = targetStockObj ? (targetStockObj.current_price || targetStockObj.currentPrice) : 0;
                const isTargetUp = Number(stockTarget.targetPrice || 0) > currentPrice;
                return isTargetUp 
                  ? "예: 신규 사업 기대감으로 상승 이벤트가 시작되었어요." 
                  : "예: 실적 부진 우려로 하락 이벤트가 시작되었어요.";
              })()}
            />
          </label>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            className="checkbox checkbox-primary rounded-lg"
            checked={stockTarget.publishNews}
            onChange={(event) =>
              setStockTarget((current) => ({ ...current, publishNews: event.target.checked }))
            }
            id="targetPublishNews"
          />
          <label htmlFor="targetPublishNews" className="text-xs font-bold text-base-content/70 cursor-pointer">
            시장 공지 발행 및 행운소식 등록
          </label>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm font-bold text-base-content/60">
            예상 방향:{" "}
            {stocks.find(s => String(s.id) === String(stockTarget.stockId)) && stockTarget.targetPrice ? (
              Number(stockTarget.targetPrice) > (stocks.find(s => String(s.id) === String(stockTarget.stockId)).current_price || stocks.find(s => String(s.id) === String(stockTarget.stockId)).currentPrice) ? (
                <span className="text-error font-black">상승 ▲</span>
              ) : (
                <span className="text-primary font-black">하락 ▼</span>
              )
            ) : (
              "-"
            )}
          </span>
          <button
            type="button"
            className="btn btn-primary h-12 whitespace-nowrap rounded-2xl px-6"
            disabled={busy || !stockTarget.stockId || stockTarget.targetPrice === "" || stockTarget.percentPerTick === ""}
            onClick={applyStockTargetPriceEvent}
          >
            목표주가 이벤트 시작
          </button>
        </div>
      </BaseCard>

      <BaseCard className="mt-6 border-2 border-warning/30">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionHeader title="오늘의 잭팟 제어" eyebrow="DAILY JACKPOT" className="mb-1" />
            <p className="text-xs font-bold text-base-content/50">
              운영자가 오늘의 잭팟 누적 상금액을 직접 설정하거나 0원으로 초기화할 수 있습니다.
            </p>
          </div>
          <span className="badge badge-warning badge-outline font-black">
            현재 {formatMoney(jackpotInfo?.jackpotPool || 0)}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-base-200/70 p-4">
            <span className="text-xs font-bold text-base-content/45">전체 응모 수</span>
            <strong className="mt-1 block font-black tabular-nums">
              {(jackpotInfo?.totalAppliedTickets || 0).toLocaleString("ko-KR")}장
            </strong>
          </div>
          <div className="rounded-2xl bg-base-200/70 p-4">
            <span className="text-xs font-bold text-base-content/45">응모 인원</span>
            <strong className="mt-1 block font-black tabular-nums">
              {(jackpotInfo?.totalParticipants || 0).toLocaleString("ko-KR")}명
            </strong>
          </div>
          <div className="rounded-2xl bg-base-200/70 p-4">
            <span className="text-xs font-bold text-base-content/45">기준 날짜</span>
            <strong className="mt-1 block font-black tabular-nums">
              {jackpotInfo?.date || "-"}
            </strong>
          </div>
        </div>
        <div className="mt-4 grid gap-2 lg:grid-cols-[1fr_auto_auto_auto]">
          <input
            className="input input-bordered h-12 min-w-0 rounded-2xl text-right tabular-nums"
            type="number"
            min="0"
            step="1"
            value={jackpotAmount}
            onChange={(event) => setJackpotAmount(event.target.value)}
            placeholder="설정할 잭팟 금액"
          />
          <button
            type="button"
            className="btn btn-warning h-12 whitespace-nowrap rounded-2xl"
            disabled={busy || jackpotAmount === ""}
            onClick={setJackpotPoolAmount}
          >
            잭팟 금액 설정
          </button>
          <button
            type="button"
            className="btn btn-outline h-12 whitespace-nowrap rounded-2xl"
            disabled={busy}
            onClick={resetJackpotPoolAmount}
          >
            잭팟 초기화
          </button>
          <button
            type="button"
            className="btn btn-error text-white font-bold h-12 whitespace-nowrap rounded-2xl"
            disabled={busy}
            onClick={drawJackpotManually}
          >
            🎰 잭팟 강제 추첨
          </button>
        </div>
      </BaseCard>

      <BaseCard className="mt-6 border-2 border-warning/30">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <SectionHeader title="시즌 제어" eyebrow="SEASON" className="mb-1" />
            <p className="text-xs font-bold text-base-content/50">
              시즌 종료 시 주식과 포지션을 정산하고 다음 시즌 시작 자산을 지급합니다.
            </p>
          </div>
          <span className="badge badge-warning badge-outline font-black">
            시즌 {seasonInfo?.season?.seasonNumber || "-"}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-base-200 p-4">
            <span className="text-xs font-bold text-base-content/45">상태</span>
            <strong className="mt-1 block font-black">
              {seasonInfo?.season?.status === "active" ? "진행 중" : "확인 중"}
            </strong>
          </div>
          <div className="rounded-2xl bg-base-200 p-4 sm:col-span-2">
            <span className="text-xs font-bold text-base-content/45">시작 시간</span>
            <strong className="mt-1 block font-black">
              {seasonInfo?.season?.startedAt
                ? new Date(seasonInfo.season.startedAt).toLocaleString("ko-KR")
                : "-"}
            </strong>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-base-300 bg-base-100 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-black">시즌 회사 보상 미리보기</p>
              <p className="text-xs font-bold text-base-content/50">사용자 1·2·3위에게 회사 시총 2·3·4위가 매핑됩니다. 순위 현금 보너스는 없습니다.</p>
            </div>
            <button type="button" className="btn btn-sm btn-outline rounded-xl" disabled={busy} onClick={previewSeasonRewards}>미리보기</button>
          </div>
          {seasonRewardPreview && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {seasonRewardPreview.mappings.map((mapping) => (
                <div key={mapping.winnerRank} className="rounded-xl bg-base-200/60 p-3 text-xs font-bold">
                  <p className="text-primary">사용자 {mapping.winnerRank}위 → 회사 {mapping.companyRank}위</p>
                  <p className="mt-1">{mapping.winnerUsername} → {mapping.sourceStockName}</p>
                  <p className="mt-1 tabular-nums text-base-content/55">{formatMoney(mapping.sourceMarketCap)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <p className="font-black">ETF 이자·총평가금액 관리</p>
          <p className="mt-1 text-xs font-bold text-base-content/50">
            시간당 0.1%는 사용자·KST 시간당 한 번만 지급됩니다.
            {etfInterestSummary ? ` 현재 누락 ${etfInterestSummary.missingCount}건` : ""}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <button type="button" className="btn btn-sm btn-primary rounded-xl" disabled={busy} onClick={settleEtfInterest}>현재 시간 정산</button>
            <button type="button" className="btn btn-sm btn-outline rounded-xl" disabled={busy} onClick={catchUpEtfInterest}>24시간 누락 검사·보정</button>
            <button type="button" className="btn btn-sm btn-outline rounded-xl" disabled={busy} onClick={rebuildAssetSnapshots}>자산 스냅샷 재구축</button>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-warning mt-4 h-12 w-full rounded-2xl"
          disabled={busy || user.username !== "admin"}
          onClick={() => setSeasonConfirmOpen(true)}
        >
          현재 시즌 종료하고 다음 시즌 시작
        </button>
        {user.username !== "admin" && (
          <p className="mt-2 text-xs font-bold text-error">
            시즌 종료는 username이 admin인 계정만 실행할 수 있습니다.
          </p>
        )}
      </BaseCard>

      {seasonConfirmOpen && (
        <AdminConfirmModal
          title="현재 시즌을 종료하고 다음 시즌을 시작할까요?"
          beforeLabel="시즌 번호"
          beforeValue={`시즌 ${seasonInfo?.season?.seasonNumber || ""}`}
          afterLabel="정산 대상"
          afterValue={`${(result?.total || 0).toLocaleString("ko-KR")}명`}
          onConfirm={endCurrentSeason}
          onClose={() => setSeasonConfirmOpen(false)}
        />
      )}

      {blueChipModalOpen && (
        <div className="modal modal-open">
          <div className="modal-box rounded-3xl border border-base-300 shadow-xl max-w-md bg-base-100">
            <h3 className="font-black text-lg text-base-content mb-4">⭐ 우량주 선정 및 급등 시작</h3>
            
            <div className="grid gap-3">
              <label className="form-control">
                <span className="label-text mb-1 font-bold">대상 종목</span>
                <select
                  className="select select-bordered w-full h-12 rounded-2xl"
                  value={blueChipStockId}
                  onChange={(event) => setBlueChipStockId(event.target.value)}
                >
                  {stocks.map((stock) => (
                    <option key={stock.id} value={stock.id}>
                      {stock.name} ({stock.is_bluechip === 1 ? "우량주" : "일반"})
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-2xl bg-base-200/50 p-3 text-sm">
                <span className="text-xs font-bold text-base-content/50">현재가</span>
                <strong className="block text-primary text-base font-black">
                  {formatMoney(stocks.find(s => String(s.id) === String(blueChipStockId))?.current_price || stocks.find(s => String(s.id) === String(blueChipStockId))?.currentPrice || 0)}
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

              <label className="form-control">
                <span className="label-text mb-1 font-bold">공지 제목 (선택)</span>
                <input
                  className="input input-bordered w-full h-12 rounded-2xl"
                  value={blueChipNewsTitle}
                  onChange={(event) => setBlueChipNewsTitle(event.target.value)}
                  placeholder="예: 우량주 지정 및 특별 혜택"
                  maxLength={100}
                />
              </label>

              <label className="form-control">
                <span className="label-text mb-1 font-bold">공지 내용 (선택)</span>
                <textarea
                  className="textarea textarea-bordered w-full h-12 min-h-[48px] py-2 rounded-2xl"
                  value={blueChipNewsContent}
                  onChange={(event) => setBlueChipNewsContent(event.target.value)}
                  placeholder={(() => {
                    const targetStockObj = stocks.find(s => String(s.id) === String(blueChipStockId));
                    const name = targetStockObj ? targetStockObj.name : "";
                    const moneyText = blueChipTargetPrice ? Number(blueChipTargetPrice).toLocaleString("ko-KR") : "0";
                    return `예: ${name}이(가) 우량주로 선정되었어요. 목표주가 ${moneyText}원을 향해 상승 이벤트가 시작됩니다.`;
                  })()}
                />
              </label>

              <div className="flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary rounded-lg"
                  checked={blueChipPublishNews}
                  onChange={(event) => setBlueChipPublishNews(event.target.checked)}
                  id="blueChipPublishNews"
                />
                <label htmlFor="blueChipPublishNews" className="text-xs font-bold text-base-content/70 cursor-pointer">
                  시장 공지 발행 및 행운소식 등록
                </label>
              </div>
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
                disabled={busy || !blueChipStockId || blueChipTargetPrice === "" || blueChipRampPercent === ""}
                onClick={applyBlueChipDesignation}
              >
                선택 및 급등 시작
              </button>
            </div>
          </div>
        </div>
      )}

      <p
        className={`mt-3 min-h-6 text-sm font-bold ${
          error ? "text-error" : "text-success"
        }`}
        aria-live="polite"
      >
        {error || message || "\u00a0"}
      </p>

      {nicknameConfirmOpen && (
        <AdminConfirmModal
          title="이 유저의 닉네임을 변경할까요?"
          beforeLabel="기존 닉네임"
          beforeValue={activeUser?.nickname}
          afterLabel="새 닉네임"
          afterValue={newNickname}
          onConfirm={forceChangeNickname}
          onClose={() => setNicknameConfirmOpen(false)}
        />
      )}
      {balanceConfirm && (
        <AdminConfirmModal
          title={`${balanceConfirm.label}의 자산을 변경할까요?`}
          beforeLabel="적용 대상"
          beforeValue={`${balanceConfirm.ids.length}명`}
          afterLabel="새 자산"
          afterValue={formatMoney(balanceConfirm.balance)}
          onConfirm={applyBalance}
          onClose={() => setBalanceConfirm(null)}
        />
      )}
      {resetConfirmIds.length > 0 && (
        <AdminResetModal
          targetCount={resetConfirmIds.length}
          selectedTargets={resetTargets}
          onToggle={(target) =>
            setResetTargets((current) =>
              current.includes(target)
                ? current.filter((item) => item !== target)
                : [...current, target],
            )
          }
          onSelectAll={() => setResetTargets([...allAdminResetTargets])}
          onClearAll={() => setResetTargets([])}
          onConfirm={applyReset}
          onClose={() => setResetConfirmIds([])}
        />
      )}
      {seasonConfirmOpen && (
        <AdminConfirmModal
          title="현재 시즌을 종료할까요?"
          beforeLabel="정산 대상"
          beforeValue={`시즌 ${seasonInfo?.season?.seasonNumber || "-"}`}
          afterLabel="처리"
          afterValue="주식·포지션 정산, 랭킹 저장, 다음 시즌 시작"
          onConfirm={endCurrentSeason}
          onClose={() => setSeasonConfirmOpen(false)}
        />
      )}
    </PageContainer>
  );
}

function AdminResetModal({
  targetCount,
  selectedTargets,
  onToggle,
  onSelectAll,
  onClearAll,
  onConfirm,
  onClose,
}) {
  const hasSelection = selectedTargets.length > 0;
  const allSelected = selectedTargets.length === adminResetOptions.length;

  return (
    <div
      className="modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-reset-title"
    >
      <div className="modal-box max-w-3xl rounded-[2rem]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Selective reset</p>
            <h2 id="admin-reset-title" className="mt-1 text-xl font-black text-error">
              {targetCount.toLocaleString("ko-KR")}명의 데이터를 초기화할까요?
            </h2>
          </div>
          <span className="badge badge-error badge-outline font-black">
            {selectedTargets.length} / {adminResetOptions.length}개 선택
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-sm btn-outline rounded-xl"
            disabled={allSelected}
            onClick={onSelectAll}
          >
            전체 선택
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost rounded-xl"
            disabled={!hasSelection}
            onClick={onClearAll}
          >
            전체 해제
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {adminResetOptions.map((option) => {
            const checked = selectedTargets.includes(option.key);
            return (
              <label
                key={option.key}
                className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${
                  checked
                    ? "border-error/45 bg-error/10"
                    : "border-base-300 bg-base-100"
                }`}
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-error mt-0.5"
                  checked={checked}
                  onChange={() => onToggle(option.key)}
                />
                <span className="min-w-0">
                  <strong className="block text-sm">{option.label}</strong>
                  <span className="mt-1 block text-xs leading-relaxed text-base-content/55">
                    {option.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        <p className="mt-4 rounded-2xl bg-warning/15 px-4 py-3 text-xs leading-relaxed text-base-content/70">
          초기화한 데이터는 복구할 수 없습니다. 자산을 선택하면 각 대상의 현재
          잔액은 5,000,000원으로 설정됩니다.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn btn-outline rounded-2xl"
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            className="btn btn-error rounded-2xl"
            disabled={!hasSelection}
            onClick={onConfirm}
          >
            선택 항목 초기화
          </button>
        </div>
      </div>
      <button
        className="modal-backdrop"
        type="button"
        aria-label="닫기"
        onClick={onClose}
      />
    </div>
  );
}

function AdminConfirmModal({
  title,
  beforeLabel,
  beforeValue,
  afterLabel,
  afterValue,
  onConfirm,
  onClose,
}) {
  useEnterConfirm(true, onConfirm);

  return (
    <div className="modal modal-open" role="dialog">
      <div className="modal-box rounded-[2rem] text-center">
        <h2 className="mb-3 text-xl font-black text-error">{title}</h2>
        <p className="mb-1 text-sm">
          {beforeLabel}: <strong>{beforeValue}</strong>
        </p>
        <p className="mb-4 text-sm">
          {afterLabel}: <strong>{afterValue}</strong>
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn btn-outline rounded-2xl"
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            className="btn btn-error rounded-2xl"
            onClick={onConfirm}
          >
            확인 (Enter)
          </button>
        </div>
      </div>
      <button
        className="modal-backdrop"
        type="button"
        aria-label="닫기"
        onClick={onClose}
      />
    </div>
  );
}

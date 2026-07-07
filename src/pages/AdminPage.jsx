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
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [marketOpen, setMarketOpen] = useState(null);
  const [seasonInfo, setSeasonInfo] = useState(null);
  const [jackpotInfo, setJackpotInfo] = useState(null);
  const [jackpotAmount, setJackpotAmount] = useState("");
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
      })
      .catch(() => {});
  }, []);

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
    if (!stockAdjust.stockId || stockAdjust.value === "") return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api(`/admin/stocks/${stockAdjust.stockId}/manual-adjust`, {
        method: "POST",
        body: JSON.stringify({
          mode: stockAdjust.mode,
          direction: stockAdjust.direction,
          value: Number(stockAdjust.value),
          reason: stockAdjust.reason,
        }),
      });
      setMessage(data.message);
      const stockData = await api("/stocks");
      const list = (stockData.stocks || []).filter((stock) => stock.status !== "delisted");
      setStocks(list);
      setStockAdjust((current) => ({ ...current, value: "", reason: "" }));
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

  const selectedIdList = [...selectedIds];
  const selectedStock = stocks.find((stock) => String(stock.id) === String(stockAdjust.stockId));

  return (
    <PageContainer>
      <SectionHeader title="관리자 제어" eyebrow="ADMIN CONTROL CENTER" className="mb-6" />
      <p className="mt-2 text-sm font-bold text-base-content/55 mb-6">
        전체 플레이어를 검색·선택하고 단일 또는 일괄 작업을 실행합니다.
      </p>

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
            className="input input-bordered h-12 min-w-0 rounded-2xl"
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
          <label className="form-control min-w-0">
            <span className="label-text mb-1 font-bold">유저 선택</span>
            <select
              className="select select-bordered h-12 min-w-0 rounded-2xl"
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
                <span className="text-xs font-bold text-base-content/45">총 평가자산</span>
                <strong className="mt-1 block tabular-nums">
                  {formatMoney(activeUser.totalEvaluatedAsset || activeUser.balance)}
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
                <span className="label-text mb-1 font-bold">닉네임</span>
                <input
                  className="input input-bordered h-12 min-w-0 rounded-2xl"
                  value={newNickname}
                  maxLength="12"
                  onChange={(event) => setNewNickname(event.target.value)}
                  placeholder="새 닉네임 2~12자"
                />
              </label>
              <label className="form-control">
                <span className="label-text mb-1 font-bold">자산</span>
                <input
                  className="input input-bordered h-12 min-w-0 rounded-2xl"
                  type="number"
                  min="0"
                  step="1"
                  value={singleBalance}
                  onChange={(event) => setSingleBalance(event.target.value)}
                  placeholder="새 자산"
                />
              </label>
              <label className="form-control">
                <span className="label-text mb-1 font-bold">행운권 보유량</span>
                <input
                  className="input input-bordered h-12 min-w-0 rounded-2xl"
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
        <div className="mt-4 grid grid-cols-2 gap-2">
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
        </div>
      </BaseCard>

      <BaseCard className="mt-6 border-2 border-info/25">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionHeader title="주가 수동 조정" eyebrow="ADMIN STOCK CONTROL" className="mb-1" />
            <p className="text-xs font-bold text-base-content/50">
              선택한 종목의 현재가를 기준으로 퍼센트 또는 원 단위로 즉시 조정합니다.
            </p>
          </div>
          <span className="badge badge-info badge-outline font-black">
            현재가 {selectedStock ? formatMoney(selectedStock.current_price || selectedStock.currentPrice) : "-"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="form-control min-w-0">
            <span className="label-text mb-1 font-bold">종목 선택</span>
            <select
              className="select select-bordered h-12 min-w-0 rounded-2xl"
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
            <span className="label-text mb-1 font-bold">사유</span>
            <input
              className="input input-bordered h-12 min-w-0 rounded-2xl"
              value={stockAdjust.reason}
              onChange={(event) =>
                setStockAdjust((current) => ({ ...current, reason: event.target.value }))
              }
              placeholder="사유 입력 (선택)"
              maxLength={120}
            />
          </label>
          <label className="form-control">
            <span className="label-text mb-1 font-bold">조정 방식</span>
            <select
              className="select select-bordered h-12 rounded-2xl"
              value={stockAdjust.mode}
              onChange={(event) =>
                setStockAdjust((current) => ({ ...current, mode: event.target.value }))
              }
            >
              <option value="percent">퍼센트(%)</option>
              <option value="amount">금액(원)</option>
            </select>
          </label>
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
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
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
          <button
            type="button"
            className="btn btn-primary h-12 whitespace-nowrap rounded-2xl"
            disabled={busy || !stockAdjust.stockId || stockAdjust.value === ""}
            onClick={applyStockAdjustment}
          >
            주가 조정 적용
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
        <div className="mt-4 grid gap-2 lg:grid-cols-[1fr_auto_auto]">
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

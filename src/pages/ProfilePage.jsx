import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { gameMeta } from "../data/games";
import { formatDate, formatMoney, formatPercent, formatSignedMoney } from "../utils/format";

const rangeTabs = [
  { key: "day", label: "하루" },
  { key: "week", label: "일주일" },
  { key: "month", label: "한달" },
];

export default function ProfilePage() {
  const { user, logout, refreshUser } = useAuth();
  const [summary, setSummary] = useState(null);
  const [gameStats, setGameStats] = useState([]);
  const [range, setRange] = useState("day");
  const [scaleMode, setScaleMode] = useState("zoom");
  const [history, setHistory] = useState(null);
  const [newNickname, setNewNickname] = useState("");
  const [nicknameMessage, setNicknameMessage] = useState("");
  const [nicknameError, setNicknameError] = useState("");
  const [nicknameBusy, setNicknameBusy] = useState(false);
  const [bankruptcyBusy, setBankruptcyBusy] = useState(false);
  const [bankruptcyMessage, setBankruptcyMessage] = useState("");
  const achievements = user.achievements || [];

  const loadProfile = async () => {
    const [summaryData, statsData] = await Promise.all([
      api("/profile/summary"),
      api("/profile/game-stats"),
    ]);
    setSummary(summaryData.summary);
    setGameStats(statsData.stats);
  };

  useEffect(() => {
    loadProfile().catch(() => {});
  }, [user.balance]);

  useEffect(() => {
    api(`/profile/asset-history?range=${range}`).then(setHistory).catch(() => {});
  }, [range, user.balance]);

  const changeNickname = async () => {
    setNicknameBusy(true);
    setNicknameMessage("");
    setNicknameError("");
    try {
      const data = await api("/profile/nickname", {
        method: "PATCH",
        body: JSON.stringify({ newNickname }),
      });
      setNicknameMessage(data.message);
      setNewNickname("");
      await refreshUser();
      await loadProfile();
    } catch (error) {
      setNicknameError(error.message);
    } finally {
      setNicknameBusy(false);
    }
  };

  const applyBankruptcy = async () => {
    setBankruptcyBusy(true);
    setBankruptcyMessage("");
    try {
      const data = await api("/bankruptcy/apply", { method: "POST" });
      setBankruptcyMessage(data.message);
      await refreshUser();
      await loadProfile();
    } catch (error) {
      setBankruptcyMessage(error.message);
    } finally {
      setBankruptcyBusy(false);
    }
  };

  const values = summary
    ? [
        ["현재 자산", formatMoney(summary.balance)],
        ["최고 자산", formatMoney(summary.highestBalance)],
        ["총 수익", formatMoney(summary.grossProfit), "text-success"],
        ["총 손실", formatMoney(summary.grossLoss), "text-error"],
        ["순수익", formatSignedMoney(summary.netGameProfit), summary.netGameProfit >= 0 ? "text-success" : "text-error"],
        ["총 게임횟수", `${summary.totalGames.toLocaleString()}판`],
        ["총 배팅횟수", `${summary.totalBets.toLocaleString()}회`],
        ["총 획득 금액", formatMoney(summary.totalPayout)],
        ["총 잃은 금액", formatMoney(summary.totalLostAmount)],
        ["획득 업적", `${summary.achievementCount}개`],
        ["누적 파산 횟수", `${summary.bankruptcyCount.toLocaleString("ko-KR")}회`],
      ]
    : [];

  return (
    <div className="page-content">
      <p className="eyebrow">My pocket</p>
      <h1 className="text-3xl font-black">{user.nickname}님의 행운주머니</h1>
      <p className="mt-2 text-sm text-base-content/55">@{user.username} · 가입 {formatDate(user.createdAt)}</p>

      <div className="my-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {values.map(([label, value, color]) => (
          <ProfileStat key={label} label={label} value={value} color={color} />
        ))}
      </div>

      <section className="soft-card mb-6">
        <div className="grid min-w-0 gap-4 md:grid-cols-[1fr_1.2fr] md:items-center">
          <div>
            <p className="eyebrow">Nickname</p>
            <h2 className="section-title text-xl">닉네임 변경</h2>
            <p className="mt-2 text-sm text-base-content/55">
              현재 닉네임: <strong className="text-primary">{user.nickname}</strong>
            </p>
            <p className="mt-1 text-xs font-bold text-base-content/55">
              최초 1회는 무료예요. 이후 변경에는 500,000원이 필요해요.
            </p>
            <p className={`mt-1 text-xs font-black ${user.nicknameChangeCount === 0 ? "text-success" : "text-error"}`}>
              {user.nicknameChangeCount === 0 ? "무료 변경 가능" : "변경 비용 500,000원"}
            </p>
          </div>
          <div>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row">
              <input
                className="input input-bordered h-12 min-w-0 flex-1 rounded-2xl"
                value={newNickname}
                maxLength="12"
                onChange={(event) => setNewNickname(event.target.value)}
                placeholder="새 닉네임 2~12자"
              />
              <button
                type="button"
                className="btn btn-primary h-12 shrink-0 whitespace-nowrap rounded-2xl px-6"
                disabled={
                  nicknameBusy ||
                  !newNickname.trim() ||
                  (user.nicknameChangeCount >= 1 && user.balance < 500000)
                }
                onClick={changeNickname}
              >
                {nicknameBusy ? <span className="loading loading-spinner loading-sm" /> : "변경"}
              </button>
            </div>
            <p
              className={`mt-2 h-6 overflow-hidden text-sm font-bold leading-6 ${nicknameError ? "text-error" : "text-success"}`}
              aria-live="polite"
            >
              {nicknameError || nicknameMessage || "\u00a0"}
            </p>
          </div>
        </div>
      </section>

      {user.balance < 500000 && (
        <div className="grid gap-4 mb-6 sm:grid-cols-2">
          <section className="soft-card border-2 border-error">
            <h2 className="section-title">⛏ 탄광에서 자원 캐기</h2>
            <p className="my-2 text-sm leading-relaxed">
              파산신청 대신 곡괭이를 들고 직접 자산을 캐볼까요? 1,000,000원이 될 때까지 캘 수 있어요.
            </p>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs font-bold text-base-content/50">
                총 {user.mineTotalEarned?.toLocaleString("ko-KR") || 0}원 획득
              </span>
              <Link to="/mine" className="btn btn-error rounded-2xl">
                탄광가기
              </Link>
            </div>
          </section>

          <section className="soft-card border-2 border-warning">
            <h2 className="section-title">🌱 파산신청으로 다시 시작하기</h2>
            <p className="my-2 text-sm leading-relaxed">
              현재 자산이 낮아요. 파산신청으로 자산을 정확히 1,000,000원으로 재설정할 수 있어요.
            </p>
            <p className="mb-4 text-xs font-bold text-base-content/50">
              누적 {user.bankruptcyCount.toLocaleString("ko-KR")}회
              {user.lastBankruptcyAt ? ` · 마지막 신청 ${formatDate(user.lastBankruptcyAt)}` : " · 아직 신청 내역 없음"}
            </p>
            <button
              type="button"
              className="btn btn-warning whitespace-nowrap rounded-2xl"
              onClick={applyBankruptcy}
              disabled={bankruptcyBusy}
            >
              {bankruptcyBusy ? <span className="loading loading-spinner loading-sm" /> : "파산신청"}
            </button>
            <p className="mt-3 min-h-5 text-sm font-bold" aria-live="polite">{bankruptcyMessage}</p>
          </section>
        </div>
      )}

      <section className="soft-card asset-chart-card mb-8 min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Asset history</p>
            <h2 className="section-title text-xl">재산 변화 그래프</h2>
            <p className="mt-1 text-xs font-bold text-base-content/45">주머니가 자란 흐름을 기간별로 살펴보세요.</p>
          </div>
          <div className="join shrink-0">
            {rangeTabs.map((tab) => (
              <button
                type="button"
                key={tab.key}
                className={`btn btn-sm join-item ${range === tab.key ? "btn-primary" : "bg-base-200"}`}
                onClick={() => setRange(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        {history ? (
          <>
            <div className="my-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ChartValue label="시작 자산" value={formatMoney(history.startBalance)} />
              <ChartValue label="마지막 자산" value={formatMoney(history.endBalance)} />
              <ChartValue
                label="변화량"
                value={formatSignedMoney(history.change)}
                color={history.change >= 0 ? "text-success" : "text-error"}
              />
              <ChartValue
                label="변화율"
                value={`${history.startBalance > 0 && history.change >= 0 ? "+" : ""}${history.startBalance > 0 ? ((history.change / history.startBalance) * 100).toFixed(2) : "0.00"}%`}
                color={history.change >= 0 ? "text-success" : "text-error"}
              />
            </div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-xs font-black text-base-content/45">그래프 기준</span>
              <div className="rounded-2xl bg-base-200 p-1">
                {[
                  ["zoom", "변화 확대"],
                  ["full", "전체 보기"],
                ].map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    className={`rounded-xl px-3 py-1.5 text-xs font-black whitespace-nowrap transition ${scaleMode === key ? "bg-base-100 text-primary shadow-sm" : "text-base-content/50"}`}
                    onClick={() => setScaleMode(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <AssetChart points={history.points} range={range} scaleMode={scaleMode} />
            <RecentAssetEvents points={history.points} range={range} />
          </>
        ) : (
          <div className="loading-block mt-4 min-h-64" />
        )}
      </section>

      <section className="mb-8">
        <div className="mb-4">
          <p className="eyebrow">Game statistics</p>
          <h2 className="section-title text-xl">게임별 통계</h2>
        </div>
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {gameStats.map((stat) => {
            const meta = gameMeta[stat.gameType];
            return (
              <article className="soft-card min-w-0" key={stat.gameType}>
                <div className="mb-4 flex items-center gap-3">
                  <span className={`grid size-11 place-items-center rounded-xl text-xl ${meta.color}`}>{meta.icon}</span>
                  <div>
                    <h3 className="font-black">{meta.title}</h3>
                    <p className="text-xs text-base-content/50">승률 {formatPercent(stat.winRate)}</p>
                  </div>
                  <strong className="ml-auto text-primary">{stat.totalGames}판</strong>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  <GameStat label="배팅횟수" value={`${stat.totalBets}회`} />
                  <GameStat label="승 / 패" value={`${stat.wins} / ${stat.losses}`} />
                  <GameStat label="총 배팅금" value={formatMoney(stat.totalBet)} />
                  <GameStat label="얻은 금액" value={formatMoney(stat.totalPayout)} />
                  <GameStat label="잃은 금액" value={formatMoney(stat.lostAmount)} />
                  <GameStat label="순수익" value={formatSignedMoney(stat.netProfit)} color={stat.netProfit >= 0 ? "text-success" : "text-error"} />
                  <GameStat label="최고 단일 획득" value={formatMoney(stat.maxPayout)} wide />
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="eyebrow">Achievements</p>
            <h2 className="section-title text-xl">업적 수집함</h2>
          </div>
          <span className="text-sm font-bold">
            {achievements.filter((item) => item.unlockedAt).length}/{achievements.length}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {achievements.map((achievement) => (
            <article
              className={`rounded-2xl p-4 shadow-sm ${achievement.unlockedAt ? "achievement-pop bg-warning/25" : "bg-base-100 opacity-55"}`}
              key={achievement.key}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-base-100 text-2xl">
                  {achievement.unlockedAt ? "🏅" : "🔒"}
                </span>
                <div className="min-w-0">
                  <h3 className="font-black">{achievement.title}</h3>
                  <p className="text-xs text-base-content/55">{achievement.description}</p>
                </div>
                <strong className="ml-auto shrink-0 text-xs text-warning-content">
                  {formatMoney(achievement.reward)}
                </strong>
              </div>
            </article>
          ))}
        </div>
      </section>

      {user.isAdmin && <AdminPanel />}

      <button className="btn btn-outline btn-error mt-8 w-full rounded-2xl" onClick={logout}>로그아웃</button>
    </div>
  );
}

function AdminPanel() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [newNickname, setNewNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api(`/admin/users/search?q=${encodeURIComponent(query.trim())}`);
      setUsers(data.users);
      if (!data.users.length) setError("검색 결과가 없어요.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const forceChange = async () => {
    if (!selected || !newNickname.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api(`/admin/users/${selected.id}/nickname`, {
        method: "POST",
        body: JSON.stringify({ newNickname }),
      });
      setSelected(data.user);
      setUsers((current) =>
        current.map((item) => (item.id === data.user.id ? data.user : item)));
      setNewNickname("");
      setMessage(data.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="soft-card mt-8 border-2 border-primary/25">
      <p className="eyebrow">Admin only</p>
      <h2 className="section-title text-xl">관리자 닉네임 변경</h2>
      <p className="mt-2 text-xs text-base-content/50">
        아이디 또는 닉네임으로 대상을 찾은 뒤 강제로 변경할 수 있어요. 비용과 변경 횟수는 증가하지 않아요.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          className="input input-bordered h-12 min-w-0 flex-1 rounded-2xl"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") search();
          }}
          placeholder="아이디 또는 닉네임"
        />
        <button
          type="button"
          className="btn btn-primary h-12 whitespace-nowrap rounded-2xl"
          disabled={busy || !query.trim()}
          onClick={search}
        >
          검색
        </button>
      </div>
      {users.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {users.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`rounded-2xl border p-3 text-left ${selected?.id === item.id ? "border-primary bg-primary/10" : "border-base-300 bg-base-100"}`}
              onClick={() => {
                setSelected(item);
                setNewNickname("");
                setError("");
                setMessage("");
              }}
            >
              <strong className="block truncate">{item.nickname}</strong>
              <span className="text-xs text-base-content/45">@{item.username}</span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="mt-4 rounded-2xl bg-base-200/60 p-4">
          <p className="mb-3 text-sm font-bold">
            대상: <span className="text-primary">{selected.nickname}</span> (@{selected.username})
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="input input-bordered h-12 min-w-0 flex-1 rounded-2xl"
              value={newNickname}
              maxLength="12"
              onChange={(event) => setNewNickname(event.target.value)}
              placeholder="새 닉네임 2~12자"
            />
            <button
              type="button"
              className="btn btn-error h-12 whitespace-nowrap rounded-2xl"
              disabled={busy || !newNickname.trim()}
              onClick={forceChange}
            >
              강제 변경
            </button>
          </div>
        </div>
      )}
      <p
        className={`mt-2 h-6 overflow-hidden text-sm font-bold leading-6 ${error ? "text-error" : "text-success"}`}
        aria-live="polite"
      >
        {error || message || "\u00a0"}
      </p>
    </section>
  );
}

function ProfileStat({ label, value, color = "" }) {
  return (
    <div className="soft-card min-w-0 p-4">
      <div className="text-xs font-bold text-base-content/50">{label}</div>
      <strong className={`profile-stat-value mt-2 block tabular-nums ${color}`}>{value}</strong>
    </div>
  );
}

function ChartValue({ label, value, color = "" }) {
  return (
    <div className="rounded-xl bg-base-200/60 p-3 text-center">
      <span className="block text-[10px] font-bold text-base-content/45">{label}</span>
      <strong className={`mt-1 block truncate text-xs tabular-nums sm:text-sm ${color}`}>{value}</strong>
    </div>
  );
}

function GameStat({ label, value, color = "", wide = false }) {
  return (
    <div className={`rounded-xl bg-base-200/60 p-2 ${wide ? "col-span-2 sm:col-span-3" : ""}`}>
      <span className="block text-[10px] text-base-content/45">{label}</span>
      <strong className={`mt-1 block truncate tabular-nums ${color}`}>{value}</strong>
    </div>
  );
}

function AssetChart({ points, range, scaleMode }) {
  const graph = useMemo(() => {
    const width = 800;
    const height = 330;
    const padding = { left: 78, right: 22, top: 20, bottom: 48 };
    const balances = points.map((point) => point.balance);
    const rawMin = Math.min(...balances);
    const rawMax = Math.max(...balances);
    const rawSpread = Math.max(1, rawMax - rawMin);
    const zoomPadding = Math.max(rawSpread * 0.08, rawMax * 0.005, 1000);
    const min = scaleMode === "zoom"
      ? Math.max(0, rawMin - zoomPadding)
      : Math.min(0, rawMin);
    const max = scaleMode === "zoom"
      ? rawMax + zoomPadding
      : Math.max(rawMax * 1.05, rawMax + 1000);
    const spread = Math.max(1, max - min);
    const times = points.map((point) => new Date(point.createdAt).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const timeSpread = Math.max(1, maxTime - minTime);
    const eventSpacing = scaleMode === "zoom";
    const plotted = points.map((point, index) => ({
      ...point,
      x: points.length === 1
        ? width / 2
        : padding.left + (
          eventSpacing
            ? index / (points.length - 1)
            : (times[index] - minTime) / timeSpread
        ) * (width - padding.left - padding.right),
      y: height - padding.bottom - ((point.balance - min) / spread) * (height - padding.top - padding.bottom),
    }));
    const path = plotted.reduce((value, point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      const previous = plotted[index - 1];
      const controlX = (previous.x + point.x) / 2;
      return `${value} C ${controlX} ${previous.y}, ${controlX} ${point.y}, ${point.x} ${point.y}`;
    }, "");
    return {
      width,
      height,
      padding,
      plotted,
      path,
      min,
      max,
      minTime,
      maxTime,
      eventSpacing,
    };
  }, [points, scaleMode]);

  const label = (value) =>
    new Intl.DateTimeFormat("ko-KR", range === "day"
      ? { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }
      : range === "week"
        ? { weekday: "short", month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }
        : { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(value));

  const compactMoney = (value) =>
    `${Math.round(value).toLocaleString("ko-KR")}`;

  if (points.length < 2) {
    return <div className="empty-state py-16">아직 표시할 변화가 충분하지 않아요.</div>;
  }

  const gridRatios = [0, 0.25, 0.5, 0.75, 1];
  const xRatios = [0, 0.33, 0.66, 1];
  const chartBottom = graph.height - graph.padding.bottom;

  return (
    <div className="asset-chart min-w-0">
      <svg viewBox={`0 0 ${graph.width} ${graph.height}`} className="h-auto w-full" role="img" aria-label="선택 기간의 자산 변화 라인 그래프">
        <defs>
          <linearGradient id="asset-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#65c3c8" stopOpacity=".32" />
            <stop offset="100%" stopColor="#65c3c8" stopOpacity=".02" />
          </linearGradient>
          <filter id="asset-line-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {gridRatios.map((ratio) => {
          const y = graph.padding.top + ratio * (graph.height - graph.padding.top - graph.padding.bottom);
          const value = graph.max - ratio * (graph.max - graph.min);
          return (
            <g key={ratio}>
              <line x1={graph.padding.left} x2={graph.width - graph.padding.right} y1={y} y2={y} stroke="currentColor" strokeOpacity=".08" strokeDasharray="4 5" />
              <text x={graph.padding.left - 10} y={y + 4} textAnchor="end" className="asset-axis-label">{compactMoney(value)}</text>
            </g>
          );
        })}
        <path d={`${graph.path} L ${graph.plotted.at(-1).x} ${chartBottom} L ${graph.plotted[0].x} ${chartBottom} Z`} fill="url(#asset-area)" />
        <path d={graph.path} fill="none" stroke="#65c3c8" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" filter="url(#asset-line-glow)" />
        {graph.plotted.map((point) => (
          <g key={point.id} tabIndex="0" role="img" aria-label={`${label(point.createdAt)} ${formatMoney(point.balance)}`}>
            <title>{label(point.createdAt)} · {formatMoney(point.balance)} · {formatSignedMoney(point.amount)}</title>
            <circle cx={point.x} cy={point.y} r="9" fill="transparent" />
            {graph.plotted.length <= 30 && (
              <circle cx={point.x} cy={point.y} r="5" fill="#65c3c8" stroke="white" strokeWidth="3" />
            )}
          </g>
        ))}
        {xRatios.map((ratio) => {
          const x = graph.padding.left + ratio * (graph.width - graph.padding.left - graph.padding.right);
          const eventIndex = Math.round(ratio * (points.length - 1));
          const time = graph.eventSpacing
            ? new Date(points[eventIndex].createdAt).getTime()
            : graph.minTime + ratio * (graph.maxTime - graph.minTime);
          return (
            <text key={ratio} x={x} y={graph.height - 15} textAnchor={ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"} className="asset-axis-label">
              {label(time)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

const assetEventLabels = {
  game_win: "게임 성공",
  game_loss: "게임 결과",
  achievement_reward: "업적 보상",
  bonus_code: "행운코드",
  transfer_in: "송금 받음",
  transfer_out: "송금 보냄",
  nickname_change_fee: "닉네임 변경",
  support_grant: "지원금",
  bankruptcy_reset: "파산신청",
  signup_grant: "가입 선물",
  mine_reward: "탄광 획득",
};

function RecentAssetEvents({ points, range }) {
  const recent = points
    .filter((point) => !["range_start", "current"].includes(point.eventType) && point.amount !== 0)
    .slice(-3)
    .reverse();
  if (!recent.length) return null;

  const timeLabel = (value) =>
    new Intl.DateTimeFormat("ko-KR", range === "day"
      ? { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }
      : { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(value));

  return (
    <div className="mt-5 border-t border-base-300/60 pt-4">
      <h3 className="mb-3 text-xs font-black text-base-content/45">최근 주요 자산 이벤트</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        {recent.map((point) => (
          <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-base-200/55 p-3" key={point.id}>
            <span className={`grid size-8 shrink-0 place-items-center rounded-xl ${point.amount >= 0 ? "bg-success/15" : "bg-error/15"}`}>
              {point.amount >= 0 ? "↗" : "↘"}
            </span>
            <div className="min-w-0">
              <span className="block truncate text-[11px] font-bold text-base-content/50">
                {assetEventLabels[point.eventType] || "자산 변화"} · {timeLabel(point.createdAt)}
              </span>
              <strong className={`block truncate text-xs tabular-nums ${point.amount >= 0 ? "text-success" : "text-error"}`}>
                {formatSignedMoney(point.amount)}
              </strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

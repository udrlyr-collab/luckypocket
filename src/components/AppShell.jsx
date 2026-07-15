import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useEnterConfirm } from "../hooks/useEnterConfirm";
import { formatMoney } from "../utils/format";
import JackpotResultDialog from "./JackpotResultDialog";

const links = [
  { to: "/", label: "홈", icon: "🏠", end: true },
  { to: "/ranking", label: "리더보드", icon: "🏆" },
  { to: "/history", label: "기록", icon: "📒" },
  { to: "/wallet", label: "나누기", icon: "💸" },
  { to: "/stocks", label: "주식", icon: "📈" },
  { to: "/profile", label: "내 정보", icon: "👛" },
];
const adminLink = { to: "/admin", label: "관리자", icon: "🛠️" };

function linkClass({ isActive }) {
  return `whitespace-nowrap rounded-2xl px-3 py-2 text-sm font-black transition ${isActive ? "bg-primary text-primary-content shadow-sm" : "hover:bg-base-200"}`;
}

export default function AppShell() {
  const { user, logout, refreshUser, isActionSuspended } = useAuth();
  const navigate = useNavigate();
  const [bankruptcyOpen, setBankruptcyOpen] = useState(false);
  const [bankruptcyBusy, setBankruptcyBusy] = useState(false);
  const [bankruptcyError, setBankruptcyError] = useState("");
  const [seasonNotice, setSeasonNotice] = useState(null);
  const [seasonTop3, setSeasonTop3] = useState([]);
  const [seasonBusy, setSeasonBusy] = useState(false);
  const [seasonError, setSeasonError] = useState("");
  const navigationLinks = user.isAdmin ? [...links, adminLink] : links;

  useEffect(() => {
    if (user.bankruptcyShouldPrompt) setBankruptcyOpen(true);
  }, [user.bankruptcyShouldPrompt]);

  useEffect(() => {
    let mounted = true;
    api("/seasons/current")
      .then((data) => {
        if (!mounted) return;
        setSeasonTop3(data.latestEnded?.top3 || []);
        setSeasonNotice(data.notice || null);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [user.id]);

  const applyBankruptcy = async () => {
    setBankruptcyBusy(true);
    setBankruptcyError("");
    try {
      await api("/bankruptcy/apply", { method: "POST" });
      await refreshUser();
      setBankruptcyOpen(false);
    } catch (error) {
      setBankruptcyError(error.message);
    } finally {
      setBankruptcyBusy(false);
    }
  };

  const dismissBankruptcy = async () => {
    setBankruptcyBusy(true);
    setBankruptcyError("");
    try {
      await api("/bankruptcy/dismiss", { method: "POST" });
      await refreshUser();
      setBankruptcyOpen(false);
    } catch (error) {
      setBankruptcyError(error.message);
    } finally {
      setBankruptcyBusy(false);
    }
  };

  const closeSeasonNotice = async () => {
    if (!seasonNotice) return;
    setSeasonBusy(true);
    setSeasonError("");
    try {
      await api(`/seasons/notices/${seasonNotice.id}/seen`, { method: "POST" });
      setSeasonNotice(null);
      await refreshUser();
    } catch (error) {
      setSeasonError(error.message);
    } finally {
      setSeasonBusy(false);
    }
  };

  useEnterConfirm(bankruptcyOpen && !bankruptcyBusy, applyBankruptcy);

  return (
    <div className="app-layout bg-grid">
      <div className="virtual-banner">🍀 현금 결제·충전·출금이 없는 숫자 게임입니다</div>
      {isActionSuspended && (
        <div className="bg-amber-950/50 border-b border-amber-500/25 py-2 px-4 text-center text-xs font-black text-amber-300 flex items-center justify-center gap-2 z-40 Outfit">
          <span>⚠️</span>
          <span>
            재산 정지 상태입니다. 신규 매수 및 미니게임 이용이 불가합니다. (만료: {new Date(user.suspendedActionUntil).toLocaleString("ko-KR")})
          </span>
          {user.suspendedActionReason && (
            <span className="opacity-75 font-bold border-l border-amber-500/30 pl-2">
              사유: {user.suspendedActionReason}
            </span>
          )}
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-base-300/55 bg-base-100/92 backdrop-blur-xl">
        <div className="shell-container flex h-[4.5rem] items-center justify-between gap-3">
          <NavLink to="/" className="flex items-center gap-2">
            <span className="grid size-10 place-items-center rounded-2xl bg-primary text-xl shadow-md shadow-primary/20">👛</span>
            <div>
              <div className="font-black leading-none">행운주머니</div>
              <div className="mt-1 hidden text-[10px] font-bold text-base-content/45 sm:block">숫자로 키우는 나만의 주머니</div>
            </div>
          </NavLink>
          <nav className="hidden items-center gap-1 md:flex" aria-label="주요 메뉴">
            {navigationLinks.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={linkClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex min-w-0 items-center gap-4">
            <div className="hidden min-w-0 text-right lg:block pr-4 border-r border-base-300">
              <span className="block truncate text-sm font-black">{user.nickname}님</span>
              <span className="text-[10px] font-bold text-base-content/40">오늘도 행운 가득</span>
            </div>
            <div className="hidden min-w-0 text-right lg:block">
              <span className={`block truncate text-sm font-black ${user.assetValuationComplete === false ? "text-error" : "text-primary"}`}>
                {user.assetValuationComplete === false ? "평가 오류" : formatMoney(user.totalEvaluatedAsset)}
              </span>
              <span className="text-[10px] font-bold text-base-content/40">총평가금액</span>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm hidden whitespace-nowrap rounded-xl xl:inline-flex"
              onClick={logout}
            >
              로그아웃
            </button>
            <NavLink
              to="/profile"
              className="grid size-10 shrink-0 place-items-center rounded-2xl bg-secondary/35 text-lg md:hidden"
              aria-label="내 정보"
            >
              🐣
            </NavLink>
          </div>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <nav
        className={`fixed inset-x-0 bottom-0 z-40 grid border-t border-base-300 bg-base-100 p-2 md:hidden ${
          user.isAdmin ? "grid-cols-7" : "grid-cols-6"
        }`}
        aria-label="모바일 메뉴"
      >
        {navigationLinks.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              `flex flex-col items-center whitespace-nowrap rounded-2xl py-2 text-[11px] font-black ${isActive ? "bg-primary/15 text-primary" : ""}`
            }
          >
            <span className="text-lg">{link.icon}</span>
            {link.label}
          </NavLink>
        ))}
      </nav>
      {bankruptcyOpen && (
        <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="bankruptcy-title">
          <div className="modal-box rounded-[2rem] text-center">
            <div className="mb-3 text-5xl" aria-hidden="true">🌱</div>
            <h2 id="bankruptcy-title" className="text-2xl font-black">파산신청을 할까요?</h2>
            <p className="mt-3 text-sm leading-relaxed text-base-content/65">
              현재 자산이 500,000원 미만이에요. 파산신청을 하면 자산이
              정확히 1,000,000원으로 재설정돼요.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-base-content/65">
              직접 다시 벌고 싶다면 탄광에서 자원을 캐볼 수 있어요.<br />
              탄광은 언제든 이용할 수 있어요.
            </p>
            <p className="mt-2 text-xs font-bold text-base-content/45">
              파산 횟수는 기록과 리더보드에 표시돼요.
            </p>
            <p className="mt-3 min-h-5 text-sm font-bold text-error" aria-live="polite">
              {bankruptcyError}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                className="btn btn-sm sm:btn-md rounded-2xl"
                disabled={bankruptcyBusy}
                onClick={dismissBankruptcy}
              >
                아니요
              </button>
              <button
                type="button"
                className="btn btn-sm sm:btn-md btn-secondary rounded-2xl"
                disabled={bankruptcyBusy}
                onClick={() => {
                  setBankruptcyOpen(false);
                  navigate("/mine");
                }}
              >
                ⛏ 탄광가기
              </button>
              <button
                type="button"
                className="btn btn-sm sm:btn-md btn-primary rounded-2xl"
                disabled={bankruptcyBusy}
                onClick={applyBankruptcy}
              >
                {bankruptcyBusy ? <span className="loading loading-spinner loading-sm" /> : "파산신청"}
              </button>
            </div>
          </div>
        </div>
      )}
      {seasonNotice && (
        <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="season-title">
          <div className="modal-box rounded-[2rem]">
            <div className="text-center">
              <div className="mb-3 text-5xl" aria-hidden="true">🎉</div>
              <p className="eyebrow">New season</p>
              <h2 id="season-title" className="text-2xl font-black">
                시즌 {seasonNotice.seasonNumber}이 시작되었어요
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-base-content/65">
                이전 시즌 기록이 정산되었고, 새 시즌 시작 자산이 지급되었습니다.
              </p>
            </div>

            <div className="mt-5 rounded-3xl bg-base-200/70 p-4">
              <h3 className="mb-3 text-sm font-black">이전 시즌 TOP 3</h3>
              {seasonTop3.length > 0 ? (
                <div className="grid gap-2">
                  {seasonTop3.map((row) => (
                    <div key={row.userId} className="flex items-center justify-between gap-3 rounded-2xl bg-base-100 px-3 py-2">
                      <span className="min-w-0 font-black">
                        <span className="block">{row.rank}위 · {row.nickname}</span>
                        <span className="block truncate text-xs text-secondary">
                          {row.rewardCompanyName
                            ? `시총 ${row.rewardCompanyRank}위 회사 → ${row.rewardCompanyName}`
                            : "ETF 보상 기록 확인 중"}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-black text-primary tabular-nums">
                        {formatMoney(row.finalTotalEvaluatedAsset)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl bg-base-100 p-4 text-center text-sm font-bold text-base-content/50">
                  아직 종료된 시즌 기록이 없습니다.
                </p>
              )}
            </div>

            <p className="mt-3 min-h-5 text-center text-sm font-bold text-error" aria-live="polite">
              {seasonError}
            </p>
            <button
              type="button"
              className="btn btn-primary mt-2 h-12 w-full rounded-2xl"
              disabled={seasonBusy}
              onClick={closeSeasonNotice}
            >
              {seasonBusy ? <span className="loading loading-spinner loading-sm" /> : "확인"}
            </button>
          </div>
        </div>
      )}
      <JackpotResultDialog />
    </div>
  );
}

import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import PageContainer from "./PageContainer";
import { useEnterConfirm } from "../hooks/useEnterConfirm";

const links = [
  { to: "/", label: "홈", icon: "🏠", end: true },
  { to: "/ranking", label: "리더보드", icon: "🏆" },
  { to: "/history", label: "기록", icon: "📒" },
  { to: "/wallet", label: "나누기", icon: "💸" },
  { to: "/profile", label: "내 정보", icon: "👛" },
];

function linkClass({ isActive }) {
  return `whitespace-nowrap rounded-2xl px-3 py-2 text-sm font-black transition ${isActive ? "bg-primary text-primary-content shadow-sm" : "hover:bg-base-200"}`;
}

export default function AppShell() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [bankruptcyOpen, setBankruptcyOpen] = useState(false);
  const [bankruptcyBusy, setBankruptcyBusy] = useState(false);
  const [bankruptcyError, setBankruptcyError] = useState("");

  useEffect(() => {
    if (user.bankruptcyShouldPrompt) setBankruptcyOpen(true);
  }, [user.bankruptcyShouldPrompt]);

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

  useEnterConfirm(bankruptcyOpen && !bankruptcyBusy, applyBankruptcy);

  return (
    <div className="app-layout bg-grid">
      <div className="virtual-banner">🍀 현금 결제·충전·출금이 없는 숫자 게임입니다</div>
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
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={linkClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex min-w-0 items-center gap-2">
            <div className="hidden min-w-0 text-right lg:block">
              <span className="block max-w-28 truncate text-sm font-black">{user.nickname}님</span>
              <span className="text-[10px] font-bold text-base-content/40">오늘도 행운 가득</span>
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
        <PageContainer>
          <Outlet />
        </PageContainer>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-base-300 bg-base-100 p-2 md:hidden" aria-label="모바일 메뉴">
        {links.map((link) => (
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
    </div>
  );
}

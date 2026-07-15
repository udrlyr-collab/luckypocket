import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell";
import { useAuth } from "./context/AuthContext";
import BombDodgeGame from "./games/BombDodgeGame";
import CardDrawGame from "./games/CardDrawGame";
import DartGame from "./games/DartGame";
import RiskButtonGame from "./games/RiskButtonGame";
import SlotMachineGame from "./games/SlotMachineGame";
import CupLuckGame from "./games/CupLuckGame";
import TimingGame from "./games/TimingGame";
import AuthPage from "./pages/AuthPage";
import HistoryPage from "./pages/HistoryPage";
import HomePage from "./pages/HomePage";
import MinePage from "./pages/MinePage";
import ProfilePage from "./pages/ProfilePage";
import RankingPage from "./pages/RankingPage";
import WalletPage from "./pages/WalletPage";
import StockMarketPage from "./pages/StockMarketPage";
import StockDetailPage from "./pages/StockDetailPage";
import AdminPage from "./pages/AdminPage";
import { useAppVersionRefresh } from "./hooks/useAppVersionRefresh";

export default function App() {
  useAppVersionRefresh();
  const { user, loading, suspension, logout } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-base-200">
        <div className="text-center">
          <span className="loading loading-ring loading-lg text-primary" />
          <p className="mt-3 text-sm font-bold">행운 주머니를 여는 중...</p>
        </div>
      </div>
    );
  }
  
  if (suspension && suspension.type === "access") {
    return (
      <div className="grid min-h-screen place-items-center bg-black p-4 relative overflow-hidden">
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-red-950/20 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-red-950/20 blur-[120px] pointer-events-none" />

        <div className="max-w-md w-full rounded-3xl border border-red-500/20 bg-base-900/80 backdrop-blur-xl p-8 text-center shadow-2xl shadow-red-900/10 z-10">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center border border-red-500/20 mb-6">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>

          <h2 className="text-2xl font-black text-white tracking-tight mb-2 Outfit">계정 이용이 제한되었습니다</h2>
          <p className="text-sm text-base-content/60 mb-6">행운주머니 운영 정책을 위반하여 콘텐츠 접근이 금지되었습니다.</p>

          <div className="rounded-2xl bg-base-950 p-5 text-left border border-base-800 mb-6 text-sm">
            <div className="mb-3">
              <span className="text-base-content/40 block text-xs font-bold uppercase tracking-wider mb-0.5">정지 사유</span>
              <span className="text-white font-medium">{suspension.reason || "사유 미지정"}</span>
            </div>
            <div>
              <span className="text-base-content/40 block text-xs font-bold uppercase tracking-wider mb-0.5">제한 만료 시점</span>
              <span className="text-red-400 font-bold">
                {new Date(suspension.until).toLocaleString("ko-KR")}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={logout}
              className="btn btn-primary rounded-2xl font-bold w-full"
            >
              다른 계정으로 로그인
            </button>
            <p className="text-xs text-base-content/40 mt-2">정지 조치에 이의가 있는 경우 관리자에게 문의해 주세요.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="/games/risk" element={<RiskButtonGame />} />
        <Route path="/games/cards" element={<CardDrawGame />} />
        <Route path="/games/bombs" element={<BombDodgeGame />} />
        <Route path="/games/slot" element={<SlotMachineGame />} />
        <Route path="/games/dart" element={<DartGame />} />
        <Route path="/games/cup" element={<CupLuckGame />} />
        <Route path="/games/timing" element={<TimingGame />} />
        <Route path="/mine" element={<MinePage />} />
        <Route path="/ranking" element={<RankingPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/admin"
          element={user.isAdmin ? <AdminPage /> : <Navigate to="/" replace />}
        />
        <Route path="/stocks" element={<StockMarketPage />} />
        <Route path="/stocks/:id" element={<StockDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

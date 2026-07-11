import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell";
import { useAuth } from "./context/AuthContext";
import BombDodgeGame from "./games/BombDodgeGame";
import CardDrawGame from "./games/CardDrawGame";
import DartGame from "./games/DartGame";
import RiskButtonGame from "./games/RiskButtonGame";
import SlotMachineGame from "./games/SlotMachineGame";
import CupLuckGame from "./games/CupLuckGame";
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
  const { user, loading } = useAuth();
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

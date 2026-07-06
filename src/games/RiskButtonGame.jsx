import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import BetInput from "../components/BetInput";
import { ErrorAlert, GameShell, Stat } from "../components/GameShell";
import ResultModal from "../components/ResultModal";
import { useAuth } from "../context/AuthContext";
import { riskStages } from "../data/games";
import { formatMoney, formatPercent } from "../utils/format";

export default function RiskButtonGame() {
  const { user, refreshUser } = useAuth();
  const [bet, setBet] = useState("10000");
  const [game, setGame] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stagePop, setStagePop] = useState(false);
  const [failureImpact, setFailureImpact] = useState(false);

  useEffect(() => {
    api("/games/active").then((data) => setGame(data.risk || null)).catch(() => {});
  }, []);

  const next = riskStages[game?.stage || 0] || null;
  const stats = useMemo(() => {
    const displayed =
      next || (game?.stage ? riskStages[game.stage - 1] : riskStages[0]);
    return { ...displayed, chance: displayed.cumulative };
  }, [game?.stage, next]);

  const request = async (path, body, resultDelay = 0) => {
    setBusy(true);
    setError("");
    try {
      const data = await api(path, { method: "POST", body: JSON.stringify(body || {}) });
      if (data.finished) {
        if (!data.won) {
          setFailureImpact(true);
          window.setTimeout(() => setFailureImpact(false), 700);
        }
        if (resultDelay) await new Promise((resolve) => setTimeout(resolve, resultDelay));
        setGame(null);
        setResult(data);
      } else {
        setGame(data.game);
        if (path.endsWith("/press")) {
          setStagePop(true);
          window.setTimeout(() => setStagePop(false), 500);
        }
      }
      await refreshUser();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <GameShell
      icon="☝️"
      title="위험버튼"
      description="한 단계씩 도전하고, 원하는 순간에 커진 금액을 확정하세요."
      stats={stats}
      betAmount={Number(bet)}
    >
      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <BetInput balance={user.balance} value={bet} onChange={setBet} disabled={Boolean(game)} />
        <section className={`soft-card text-center ${stagePop ? "glow-success bounce-soft" : ""} ${failureImpact ? "board-impact flash-error" : ""}`}>
          {stagePop && (
            <div className="coin-particles" aria-hidden="true">
              <span>●</span><span>●</span><span>●</span>
            </div>
          )}
          {!game ? (
            <>
              <div className="mx-auto mb-4 grid size-32 place-items-center rounded-full bg-error/15 shadow-inner">
                <div className="grid size-24 place-items-center rounded-full bg-error text-5xl shadow-lg shadow-error/30">☝️</div>
              </div>
              <h2 className="text-xl font-black">첫 버튼의 성공 확률은 88%</h2>
              <p className="mt-2 text-sm text-base-content/55">고단계일수록 희귀하지만 확정 금액은 크게 올라가요.</p>
              <button
                className="btn btn-error mt-5 h-14 w-full rounded-2xl text-base"
                disabled={busy || user.balance < 1000}
                onClick={() => request("/games/risk-button/start", { betAmount: Number(bet) })}
              >
                위험버튼 게임 시작
              </button>
            </>
          ) : (
            <>
              <div className="mb-5 flex items-center justify-center gap-2">
                {riskStages.map((_, index) => (
                  <div
                    key={index}
                    className={`grid size-9 place-items-center rounded-full text-sm font-black ${index < game.stage ? "bg-success text-success-content" : index === game.stage ? "bg-error text-error-content animate-pulse" : "bg-base-200"}`}
                  >
                    {index + 1}
                  </div>
                ))}
              </div>
              <p className="text-sm font-bold text-base-content/55">현재 {game.stage}단계 성공</p>
              <p className="my-2 text-3xl font-black text-primary tabular-nums">
                {game.stage ? formatMoney(game.cashoutAmount) : "아직 확정 전"}
              </p>
              <div className="my-5 grid grid-cols-3 gap-2">
                <Stat label="누적 생존" value={formatPercent(game.cumulativeChance)} />
                <Stat label="다음 생존" value={next ? formatPercent(next.chance) : "완주!"} />
                <Stat label="다음 금액" value={game.nextAmount ? formatMoney(game.nextAmount) : "MAX"} accent />
              </div>
              <button
                className={`danger-button btn h-16 w-full rounded-2xl text-lg ${
                  (game.stage + 1) <= 2
                    ? "btn-primary"
                    : (game.stage + 1) <= 4
                      ? "btn-warning"
                      : "btn-error"
                }`}
                disabled={busy || !next || (game.stage >= 5 && game.betAmount > 100000)}
                onClick={() => request("/games/risk-button/press", null, 700)}
              >
                {busy ? <span className="loading loading-spinner" /> : next ? "위험 버튼 누르기" : "7단계 완주!"}
              </button>
              {game.stage >= 5 && game.betAmount > 100000 && (
                <p className="mt-2 text-xs font-bold text-error">
                  6단계 이상은 배팅금 100,000원 이하만 도전할 수 있어요.
                </p>
              )}
              <button
                className="btn btn-success mt-3 h-12 w-full rounded-2xl"
                disabled={busy || game.stage < 1}
                onClick={() => request("/games/risk-button/cashout", null, 600)}
              >
                {game.stage < 1 ? "먼저 한 단계 도전해요" : `${formatMoney(game.cashoutAmount)} 금액 확정`}
              </button>
            </>
          )}
          <ErrorAlert message={error} />
        </section>
      </div>
      <ResultModal result={result} onClose={() => setResult(null)}>
        {result?.detail?.failedAt && (
          <p className="mt-3 text-sm">{result.detail.failedAt}단계에서 아쉽게 멈췄어요.</p>
        )}
        {result?.detail?.stage && (
          <p className="mt-3 text-sm">{result.detail.stage}단계 배당을 안전하게 확정했어요.</p>
        )}
      </ResultModal>
    </GameShell>
  );
}

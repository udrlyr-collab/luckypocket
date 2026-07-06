import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import BetInput from "../components/BetInput";
import { ErrorAlert, GameShell, Stat } from "../components/GameShell";
import ResultModal from "../components/ResultModal";
import { useAuth } from "../context/AuthContext";
import { formatMoney, formatPercent, formatSignedMoney } from "../utils/format";

function combination(n, k) {
  const size = Math.min(k, n - k);
  let value = 1;
  for (let index = 1; index <= size; index += 1) {
    value = (value * (n - size + index)) / index;
  }
  return value;
}

function stageFor(bombCount, safeCount) {
  const chance = combination(16 - bombCount, safeCount) / combination(16, safeCount);
  const targetRtp = 1.02;
  return {
    chance,
    targetRtp,
    multiplier: Number((targetRtp / chance).toFixed(2)),
  };
}

export default function BombDodgeGame() {
  const { user, refreshUser } = useAuth();
  const [bet, setBet] = useState("10000");
  const [bombCount, setBombCount] = useState(2);
  const [game, setGame] = useState(null);
  const [finishedBoard, setFinishedBoard] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [impact, setImpact] = useState(false);

  useEffect(() => {
    api("/games/active")
      .then((data) => {
        setGame(data.bomb || null);
        if (data.bomb) setBombCount(data.bomb.bombCount);
      })
      .catch(() => {});
  }, []);

  const displayedStage = useMemo(() => {
    if (game?.safeCount > 0) {
      return {
        chance: game.cumulativeChance,
        multiplier: game.multiplier,
        expectedLabel: `${game.targetRtp >= 1 ? "+" : ""}${((game.targetRtp - 1) * 100).toFixed(2)}%`,
      };
    }
    const first = stageFor(bombCount, 1);
    return {
      chance: first.chance,
      multiplier: first.multiplier,
      expectedLabel: `${first.targetRtp >= 1 ? "+" : ""}${((first.targetRtp - 1) * 100).toFixed(2)}%`,
    };
  }, [bombCount, game]);

  const start = async () => {
    setBusy(true);
    setError("");
    setFinishedBoard(null);
    setResult(null);
    try {
      const data = await api("/games/bomb-dodge/start", {
        method: "POST",
        body: JSON.stringify({ betAmount: Number(bet), bombCount }),
      });
      setGame(data.game);
      await refreshUser();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const finish = async (data, delay, exploded = false) => {
    setGame(null);
    setFinishedBoard({
      openedNumbers: data.detail.openedNumbers || [],
      bombNumbers: data.detail.bombNumbers || [],
      pickedNumber: data.detail.pickedNumber || null,
      exploded,
    });
    if (exploded) {
      setImpact(true);
      window.setTimeout(() => setImpact(false), 650);
    }
    await refreshUser();
    await new Promise((resolve) => setTimeout(resolve, delay));
    setResult(data);
  };

  const pick = async (number) => {
    setBusy(true);
    setError("");
    try {
      const data = await api("/games/bomb-dodge/pick", {
        method: "POST",
        body: JSON.stringify({ number }),
      });
      if (data.finished) await finish(data, 800, true);
      else setGame(data.game);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const cashout = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api("/games/bomb-dodge/cashout", {
        method: "POST",
        body: "{}",
      });
      await finish(data, 700, false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const openedNumbers = game?.openedNumbers || finishedBoard?.openedNumbers || [];
  const bombNumbers = finishedBoard?.bombNumbers || [];

  return (
    <GameShell
      icon="💣"
      title="폭탄 숫자 피하기"
      description="4×4 보드에서 폭탄 수와 금액 확정 타이밍을 직접 선택하세요."
      stats={displayedStage}
      betAmount={Number(bet)}
    >
      <div className="grid min-w-0 gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="min-w-0 space-y-5">
          <BetInput balance={user.balance} value={bet} onChange={setBet} disabled={Boolean(game)} />
          <section className="soft-card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-black">폭탄 개수</h2>
              <strong className="text-error">{bombCount}개</strong>
            </div>
            <input
              className="range range-error"
              type="range"
              min="1"
              max="8"
              step="1"
              value={bombCount}
              disabled={Boolean(game)}
              onChange={(event) => setBombCount(Number(event.target.value))}
            />
            <div className="mt-2 flex justify-between text-xs text-base-content/50">
              <span>안정형 · 1개</span>
              <span>고위험 · 8개</span>
            </div>
          </section>
        </div>

        <section className={`soft-card min-w-0 ${impact ? "board-impact flash-error" : ""}`}>
          <div className="grid grid-cols-4 gap-2 sm:gap-3">
            {Array.from({ length: 16 }, (_, index) => index + 1).map((number) => {
              const opened = openedNumbers.includes(number);
              const bomb = bombNumbers.includes(number);
              const exploded = finishedBoard?.pickedNumber === number;
              return (
                <button
                  type="button"
                  className={`bomb-tile ${opened ? "safe-tile bounce-soft" : ""} ${
                    bomb ? `exploded-tile ${exploded ? "ripple-explosion" : ""}` : ""
                  }`}
                  key={number}
                  disabled={!game || opened || busy}
                  onClick={() => pick(number)}
                >
                  {bomb ? "💣" : opened ? "🌱" : number}
                </button>
              );
            })}
          </div>

          {game ? (
            <>
              <div className="my-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="폭탄" value={`${game.bombCount}개`} />
                <Stat label="안전 칸" value={`${game.safeCount}/${game.safeTotal}`} />
                <Stat label="다음 성공" value={game.nextChance ? formatPercent(game.nextChance) : "완주"} />
                <Stat label="현재 배당" value={`${game.multiplier.toFixed(2)}배`} accent />
              </div>
              <div className="mb-4 rounded-2xl bg-base-200 p-4 text-center">
                <span className="text-xs text-base-content/55">현재 확정 가능 금액</span>
                <strong className="mt-1 block text-2xl text-primary tabular-nums">
                  {formatMoney(game.cashoutAmount)}
                </strong>
                <span className="text-xs font-bold text-success">
                  예상 수익 {formatSignedMoney(game.cashoutAmount - game.betAmount)}
                </span>
              </div>
              <button
                className="btn btn-success h-13 w-full rounded-2xl"
                disabled={busy || game.safeCount < 1}
                onClick={cashout}
              >
                {game.safeCount ? `${formatMoney(game.cashoutAmount)} 금액 확정` : "안전 칸을 먼저 골라요"}
              </button>
            </>
          ) : (
            <div className="mt-5">
              {finishedBoard && (
                <p className="mb-3 text-center text-sm font-bold text-base-content/60">
                  폭탄 위치는 새 게임을 시작할 때까지 그대로 보여요.
                </p>
              )}
              <button
                className="btn btn-primary h-14 w-full rounded-2xl"
                onClick={start}
                disabled={busy || user.balance < 1000}
              >
                {busy ? <span className="loading loading-spinner" /> : finishedBoard ? "새 게임 시작" : "폭탄 배치하고 시작"}
              </button>
            </div>
          )}
          <ErrorAlert message={error} />
        </section>
      </div>

      <ResultModal result={result} onClose={() => setResult(null)}>
        <p className="mt-3 text-sm">
          안전 칸 {result?.detail?.safeCount || 0}개를 열었어요.
          {result?.detail?.bombNumbers && ` 폭탄은 ${result.detail.bombNumbers.join(", ")}번이에요.`}
        </p>
      </ResultModal>
    </GameShell>
  );
}

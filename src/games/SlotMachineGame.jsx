import { useEffect, useState } from "react";
import { api } from "../api/client";
import BetInput from "../components/BetInput";
import { ErrorAlert, GameShell } from "../components/GameShell";
import ResultModal from "../components/ResultModal";
import { useAuth } from "../context/AuthContext";

const rewards = [
  ["777", "0.1%", "현재 자산 777배"],
  ["같은 숫자 3개", "0.9%", "27배"],
  ["연속 숫자", "1.6%", "8.8배"],
  ["같은 숫자 2개", "27.0%", "1.75배"],
  ["꽝", "70.4%", "0배"],
];

export default function SlotMachineGame() {
  const { user, refreshUser } = useAuth();
  const [bet, setBet] = useState("10000");
  const [numbers, setNumbers] = useState([7, 7, 7]);
  const [stopped, setStopped] = useState([true, true, true]);
  const [locking, setLocking] = useState(-1);
  const [visualResult, setVisualResult] = useState(null);
  const [result, setResult] = useState(null);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState("");
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    api("/logs?gameType=slot")
      .then((data) => setRecent(data.logs.slice(0, 5).map((log) => log.detail.numbers)))
      .catch(() => {});
  }, []);

  const play = async () => {
    setSpinning(true);
    setStopped([false, false, false]);
    setVisualResult(null);
    setResult(null);
    setError("");
    try {
      const data = await api("/games/slot/play", {
        method: "POST",
        body: JSON.stringify({ betAmount: Number(bet) }),
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      for (let index = 0; index < 3; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        setNumbers((current) => current.map((number, itemIndex) =>
          itemIndex === index ? data.detail.numbers[index] : number));
        setStopped((current) => current.map((value, itemIndex) =>
          itemIndex === index ? true : value));
        setLocking(index);
        window.setTimeout(() => setLocking(-1), 260);
      }
      setVisualResult(data);
      setRecent((current) => [data.detail.numbers, ...current].slice(0, 5));
      await refreshUser();
      await new Promise((resolve) => setTimeout(resolve, 800));
      setResult(data);
    } catch (requestError) {
      setError(requestError.message);
      setStopped([true, true, true]);
    } finally {
      setSpinning(false);
    }
  };

  return (
    <GameShell
      icon="🎰"
      title="3자리 슬롯머신"
      description="세 릴이 하나씩 멈추며 행운의 숫자 조합을 완성해요."
      stats={{
        chance: 0.296,
        multiplier: 0,
        multiplierLabel: "자산 연동",
        expectedLabel: "자산에 따라 변동",
      }}
      betAmount={Number(bet)}
    >
      <div className="grid min-w-0 gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="min-w-0 space-y-5">
          <section className="soft-card">
            <h2 className="mb-1 font-black">보상표 · 777 자산 연동</h2>
            <p className="mb-3 text-xs font-bold leading-relaxed text-base-content/55">
              777 당첨 시 게임 시작 전 현금 자산이 777배가 돼요. 업적 보상은 별도로 지급돼요.
            </p>
            <div className="space-y-2">
              {rewards.map(([name, chance, multiplier]) => (
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 rounded-xl bg-base-200/60 p-3 text-sm" key={name}>
                  <strong>{name}</strong>
                  <span>{chance}</span>
                  <strong className="text-primary">{multiplier}</strong>
                </div>
              ))}
            </div>
          </section>
          <BetInput balance={user.balance} value={bet} onChange={setBet} />
        </div>

        <section className={`soft-card min-w-0 bg-gradient-to-b from-violet-100 to-base-100 text-center ${
          visualResult?.detail?.outcome === "777" ? "glow-warning jackpot-shake" : ""
        }`}>
          <div className="slot-window">
            {numbers.map((number, index) => (
              <div
                className={`slot-reel ${!stopped[index] ? `slot-spinning slot-delay-${index}` : ""} ${
                  locking === index ? "reel-lock" : ""
                }`}
                key={index}
              >
                {!stopped[index] ? "✦" : number}
              </div>
            ))}
          </div>
          <div className="mt-5 min-h-12 rounded-2xl bg-base-100/65 p-3 font-black">
            {spinning && !visualResult && "숫자 릴이 돌아가고 있어요…"}
            {visualResult && (
              <>
                <span className="block text-lg">{visualResult.detail.label}</span>
                <span className="text-xs font-bold text-base-content/55">
                  {visualResult.won ? "행운 조합을 찾았어요!" : "이번엔 행운이 살짝 숨어버렸어요"}
                </span>
              </>
            )}
            {!spinning && !visualResult && "세 숫자에 행운을 맡겨 보세요"}
          </div>
          <button
            className="btn btn-secondary mt-4 h-16 w-full rounded-2xl text-lg"
            onClick={play}
            disabled={spinning || user.balance < 1000}
          >
            {spinning ? <span className="loading loading-dots loading-lg" /> : "행운 슬롯 돌리기"}
          </button>

          {recent.length > 0 && (
            <div className="mt-5 text-left">
              <h3 className="mb-2 text-sm font-black">최근 슬롯 결과</h3>
              <div className="flex flex-wrap gap-2">
                {recent.map((entry, index) => (
                  <span className="badge badge-lg bg-base-100 font-black tabular-nums" key={`${entry.join("")}-${index}`}>
                    {entry.join(" · ")}
                  </span>
                ))}
              </div>
            </div>
          )}
          <ErrorAlert message={error} />
        </section>
      </div>

      <ResultModal
        result={result}
        onClose={() => setResult(null)}
        successMessage={result?.detail?.outcome === "777" ? "777 잭팟! 행운이 폭발했어요" : "성공! 자산이 통통 늘어났어요"}
        failureMessage="이번엔 행운이 살짝 숨어버렸어요"
      >
        <p className="mt-3 text-lg font-black">
          {result?.detail?.numbers.join(" · ")} — {result?.detail?.label}
        </p>
      </ResultModal>
    </GameShell>
  );
}

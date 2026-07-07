import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import BetInput from "../components/BetInput";
import { ErrorAlert, GameShell } from "../components/GameShell";
import { BaseCard } from "../components/ui";
import ResultModal from "../components/ResultModal";
import { useAuth } from "../context/AuthContext";
import { cardBets } from "../data/games";
import { formatMoney } from "../utils/format";

export default function CardDrawGame() {
  const { user, refreshUser } = useAuth();
  const [bet, setBet] = useState("10000");
  const [condition, setCondition] = useState("odd");
  const [selectedNumber, setSelectedNumber] = useState(7);
  const [result, setResult] = useState(null);
  const [visualResult, setVisualResult] = useState(null);
  const [lastNumber, setLastNumber] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [benefits, setBenefits] = useState(null);
  const [useLuckTicket, setUseLuckTicket] = useState(false);
  const spec = useMemo(() => cardBets.find((item) => item.key === condition), [condition]);
  const luckTicketDisabled =
    !benefits?.luckTickets?.remaining ||
    Number(bet || 0) > (benefits?.luckTickets?.maxBetAmount || 0);

  useEffect(() => {
    api("/games/daily-benefits")
      .then(setBenefits)
      .catch(() => {});
  }, [user.balance]);

  useEffect(() => {
    if (luckTicketDisabled) setUseLuckTicket(false);
  }, [luckTicketDisabled]);

  const play = async () => {
    setBusy(true);
    setError("");
    setLastNumber(null);
    setVisualResult(null);
    setPhase("shuffle");
    try {
      const data = await api("/games/card-draw/play", {
        method: "POST",
        body: JSON.stringify({
          betAmount: Number(bet),
          condition,
          selectedNumber: condition === "exact" ? selectedNumber : undefined,
          useLuckTicket,
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      setLastNumber(data.detail.number);
      setVisualResult(data);
      setPhase("reveal");
      await new Promise((resolve) => setTimeout(resolve, 1100));
      setPhase("settled");
      await refreshUser();
      api("/games/daily-benefits").then(setBenefits).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 700));
      setResult(data);
    } catch (requestError) {
      setError(requestError.message);
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GameShell
      icon="🃏"
      title="1부터 10까지 카드"
      description="카드가 열리기 전에 성공 조건을 골라 보세요."
      stats={spec}
      betAmount={Number(bet)}
    >
      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-5">
          <BetInput balance={user.balance} value={bet} onChange={setBet} />
          <BaseCard className=" border-2 border-secondary/20">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="checkbox checkbox-secondary mt-1"
                checked={useLuckTicket}
                disabled={busy || luckTicketDisabled}
                onChange={(event) => setUseLuckTicket(event.target.checked)}
              />
              <span>
                <strong className="block font-black">행운권 사용</strong>
                <span className="mt-1 block text-xs font-bold leading-relaxed text-base-content/55">
                  이 판은 보상이 3% 더 좋아져요. 남은 행운권{" "}
                  {(benefits?.luckTickets?.remaining || 0).toLocaleString("ko-KR")}장 ·
                  최대 {formatMoney(benefits?.luckTickets?.maxBetAmount || 100000)}
                </span>
              </span>
            </label>
          </BaseCard>
          <BaseCard>
            <h2 className="mb-3 font-black">어떤 숫자를 기다릴까요?</h2>
            <div className="grid grid-cols-2 gap-2">
              {cardBets.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={`btn h-auto min-h-12 rounded-xl py-2 text-xs ${condition === item.key ? "btn-primary" : "bg-base-200"}`}
                  onClick={() => setCondition(item.key)}
                >
                  <span>{item.label}</span>
                  <span className="block opacity-65">{item.multiplier}배</span>
                </button>
              ))}
            </div>
            {condition === "exact" && (
              <div className="mt-3 grid grid-cols-5 gap-2">
                {Array.from({ length: 10 }, (_, index) => index + 1).map((number) => (
                  <button
                    type="button"
                    key={number}
                    className={`btn btn-sm rounded-lg ${selectedNumber === number ? "btn-secondary" : "bg-base-100"}`}
                    onClick={() => setSelectedNumber(number)}
                  >
                    {number}
                  </button>
                ))}
              </div>
            )}
          </BaseCard>
        </div>
        <BaseCard>
          <div className="grid grid-cols-5 gap-2 sm:gap-3">
            {Array.from({ length: 10 }, (_, index) => index + 1).map((number) => (
              <div
                key={number}
                className={`playing-card ${phase === "shuffle" ? "card-shuffling" : ""} ${
                  lastNumber === number && phase === "reveal" ? "card-revealing" : ""
                } ${lastNumber === number && phase === "settled" ? (visualResult?.won ? "card-won" : "card-lost") : ""}`}
              >
                {lastNumber === number && phase !== "shuffle" ? number : <span>🍀</span>}
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-2xl bg-base-200 p-4 text-center">
            <p className="text-sm text-base-content/55">선택한 조건</p>
            <strong className="text-lg">{spec.label} · 총 {spec.multiplier}배 지급</strong>
          </div>
          <div className="mt-3 min-h-7 text-center font-black">
            {phase === "shuffle" && "카드들이 행운을 섞고 있어요…"}
            {phase === "reveal" && `${lastNumber}번 카드가 뒤집히고 있어요…`}
            {phase === "settled" && (visualResult?.won ? "성공 조건과 일치했어요!" : "이번 카드는 살짝 빗나갔어요")}
          </div>
          <button className="btn btn-primary mt-4 h-14 w-full rounded-2xl text-base" onClick={play} disabled={busy || user.balance < 1000}>
            {busy ? <span className="loading loading-dots" /> : "행운 카드 뽑기"}
          </button>
          <ErrorAlert message={error} />
        </BaseCard>
      </div>
      <ResultModal
        result={result}
        onClose={() => setResult(null)}
        failureMessage="아쉽지만 다음 카드가 기다리고 있어요"
      >
        <p className="mt-3 text-lg font-black">
          공개된 카드는 <span className="text-primary">{result?.detail?.number}</span>!
        </p>
      </ResultModal>
    </GameShell>
  );
}

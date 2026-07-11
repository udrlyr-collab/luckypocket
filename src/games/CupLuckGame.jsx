import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import BetInput from "../components/BetInput";
import { ErrorAlert, GameShell } from "../components/GameShell";
import ResultModal from "../components/ResultModal";
import { BaseCard } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { formatMoney } from "../utils/format";

const CUP_COUNTS = [3, 4, 5, 6, 7, 8];
const ROUND_STORAGE_KEY = "lucky-pocket:cup-round-id";

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function initialCupIds(count) {
  return Array.from({ length: count }, (_, index) => `cup-${index + 1}`);
}

function CupStage({
  cupIds,
  phase,
  luckyCupId,
  selectedCupId,
  winnerCupId,
  revealedCupIds,
  canPick,
  swapOffsets,
  onPick,
  stageRef,
}) {
  const isRevealPhase = phase === "revealing_selected" || phase === "revealing_all" || phase === "result";
  return (
    <div
      ref={stageRef}
      className={`cup-luck-board cup-count-${cupIds.length} phase-${phase}`}
      aria-live="polite"
    >
      {cupIds.map((cupId, index) => {
        const isLuckyPreview = luckyCupId === cupId && (phase === "showing_luck" || phase === "hiding_luck");
        const isRevealed = isRevealPhase && revealedCupIds.includes(cupId);
        const isWinner = isRevealed && winnerCupId === cupId;
        const isMiss = isRevealed && winnerCupId && winnerCupId !== cupId;
        return (
          <button
            key={cupId}
            type="button"
            className={`cup-luck-cup ${selectedCupId === cupId ? "is-selected" : ""} ${isLuckyPreview ? "is-lucky-preview" : ""} ${isRevealed ? "is-revealed" : ""} ${isWinner ? "is-winner" : ""} ${isMiss ? "is-miss" : ""}`}
            style={{ "--cup-shift": `${swapOffsets[cupId] || 0}px` }}
            disabled={!canPick}
            onClick={() => onPick(cupId)}
            aria-label={`컵 ${index + 1}${canPick ? " 선택" : ""}`}
          >
            <span className="cup-luck-shadow" aria-hidden="true" />
            {(isLuckyPreview || isRevealed) && (
              <span className={`cup-luck-ball ${isLuckyPreview ? "is-preview-ball" : ""}`} aria-hidden="true">🍀</span>
            )}
            <span className="cup-luck-icon" aria-hidden="true">🥤</span>
            <span className="cup-luck-number">{index + 1}</span>
            {isMiss && <span className="cup-luck-empty" aria-label="빈 컵">✦</span>}
          </button>
        );
      })}
    </div>
  );
}

export default function CupLuckGame() {
  const { user, refreshUser } = useAuth();
  const [cupCount, setCupCount] = useState(3);
  const [bet, setBet] = useState("10000");
  const [round, setRound] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [cupIds, setCupIds] = useState(initialCupIds(3));
  const [luckyCupId, setLuckyCupId] = useState(null);
  const [selectedCupId, setSelectedCupId] = useState(null);
  const [revealedCupIds, setRevealedCupIds] = useState([]);
  const [pendingResult, setPendingResult] = useState(null);
  const [result, setResult] = useState(null);
  const [swapOffsets, setSwapOffsets] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);
  const stageRef = useRef(null);
  const aliveRef = useRef(true);

  const stats = useMemo(() => ({
    chance: 1 / cupCount,
    multiplier: cupCount,
    expectedLabel: "기본 RTP 100%",
  }), [cupCount]);
  const canPick = phase === "awaiting_pick" && !busy;
  const timing = (milliseconds) => Math.max(reducedMotion ? 30 : 90, reducedMotion ? milliseconds * 0.25 : milliseconds);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    const recover = async () => {
      const storedId = window.localStorage.getItem(ROUND_STORAGE_KEY);
      try {
        const data = storedId
          ? await api(`/games/cup/rounds/${storedId}`)
          : await api("/games/cup/active");
        const activeRound = data.round;
        if (!aliveRef.current || !activeRound) return;
        if (activeRound.status === "settled") {
          window.localStorage.removeItem(ROUND_STORAGE_KEY);
          setRound(activeRound);
          setCupCount(activeRound.cupCount);
          setCupIds(activeRound.cupIds?.length ? activeRound.cupIds : initialCupIds(activeRound.cupCount));
          setSelectedCupId(activeRound.selectedCupId);
          setRevealedCupIds(activeRound.cupIds || []);
          setPendingResult({ round: activeRound, won: activeRound.won });
          setResult({
            round: activeRound,
            won: activeRound.won,
            payout: activeRound.finalPayout,
            profit: Number(activeRound.finalPayout || 0) - Number(activeRound.betAmount || 0),
          });
          setPhase("result");
          return;
        }
        setRound(activeRound);
        setCupCount(activeRound.cupCount);
        setCupIds(activeRound.cupIds?.length ? activeRound.cupIds : initialCupIds(activeRound.cupCount));
        setPhase("awaiting_pick");
      } catch {
        if (storedId) window.localStorage.removeItem(ROUND_STORAGE_KEY);
      }
    };
    recover();
    return () => { aliveRef.current = false; };
  }, []);

  const runIntro = async (startedRound) => {
    const operations = startedRound.shuffleOperations || [];
    const workingCupIds = [...(startedRound.cupIds || initialCupIds(startedRound.cupCount))];
    setPhase("preparing");
    await wait(timing(260));
    if (!aliveRef.current) return;
    setPhase("showing_luck");
    await wait(timing(720));
    if (!aliveRef.current) return;
    setPhase("hiding_luck");
    await wait(timing(350));
    if (!aliveRef.current) return;
    setLuckyCupId(null);
    setPhase("shuffling");
    for (const operation of operations) {
      if (!aliveRef.current) return;
      const width = stageRef.current?.clientWidth || 480;
      const distance = (width / Math.max(1, startedRound.cupCount)) * (operation.toIndex - operation.fromIndex);
      const fromCupId = workingCupIds[operation.fromIndex];
      const toCupId = workingCupIds[operation.toIndex];
      if (!fromCupId || !toCupId) continue;
      const duration = timing(operation.durationMs || 320);
      setSwapOffsets({ [fromCupId]: distance, [toCupId]: -distance });
      await wait(Math.floor(duration / 2));
      if (!aliveRef.current) return;
      [workingCupIds[operation.fromIndex], workingCupIds[operation.toIndex]] = [
        workingCupIds[operation.toIndex],
        workingCupIds[operation.fromIndex],
      ];
      setCupIds([...workingCupIds]);
      setSwapOffsets({ [fromCupId]: -distance, [toCupId]: distance });
      await wait(Math.ceil(duration / 2));
      setSwapOffsets({});
    }
    if (!aliveRef.current) return;
    setCupIds([...workingCupIds]);
    setPhase("awaiting_pick");
  };

  const start = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    setPendingResult(null);
    setSelectedCupId(null);
    setRevealedCupIds([]);
    try {
      const data = await api("/games/cup/start", {
        method: "POST",
        body: JSON.stringify({ cupCount, betAmount: Number(bet) }),
      });
      const startedRound = data.round;
      setRound(startedRound);
      setCupIds(startedRound.cupIds || initialCupIds(startedRound.cupCount));
      setLuckyCupId(startedRound.luckyCupId);
      window.localStorage.setItem(ROUND_STORAGE_KEY, startedRound.id);
      void runIntro(startedRound);
      await refreshUser();
    } catch (requestError) {
      setError(requestError.message);
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  };

  const pickCup = async (cupId) => {
    if (!round || !canPick) return;
    setBusy(true);
    setError("");
    setSelectedCupId(cupId);
    setPhase("revealing_selected");
    try {
      const data = await api("/games/cup/pick", {
        method: "POST",
        body: JSON.stringify({ roundId: round.id, selectedCupId: cupId }),
      });
      if (!aliveRef.current) return;
      setPendingResult(data);
      setRevealedCupIds([cupId]);
      await wait(timing(680));
      if (!aliveRef.current) return;
      setPhase("revealing_all");
      for (const nextCupId of data.round.cupIds) {
        if (nextCupId === cupId) continue;
        setRevealedCupIds((current) => [...new Set([...current, nextCupId])]);
        await wait(timing(210));
      }
      await wait(timing(620));
      if (!aliveRef.current) return;
      setRound(data.round);
      setResult(data);
      setPhase("result");
      window.localStorage.removeItem(ROUND_STORAGE_KEY);
      await refreshUser();
    } catch (requestError) {
      setError(requestError.message);
      setSelectedCupId(null);
      setPhase("awaiting_pick");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    window.localStorage.removeItem(ROUND_STORAGE_KEY);
    setRound(null);
    setCupIds(initialCupIds(cupCount));
    setLuckyCupId(null);
    setSelectedCupId(null);
    setRevealedCupIds([]);
    setPendingResult(null);
    setPhase("resetting");
    window.setTimeout(() => setPhase("idle"), timing(160));
    setResult(null);
    setError("");
  };

  const stageRound = pendingResult?.round || result?.round || round;
  const stageCupIds = cupIds.length ? cupIds : initialCupIds(stageRound?.cupCount || cupCount);
  const stageWinnerCupId = pendingResult?.round?.winningCupId || result?.round?.winningCupId || null;
  const statusText = {
    idle: "컵 개수와 배팅 금액을 정한 뒤 시작하세요.",
    preparing: "컵을 준비하고 있어요.",
    showing_luck: "행운 공이 들어간 컵을 보여드려요.",
    hiding_luck: "컵을 닫고 있어요.",
    shuffling: "컵을 빠르게 섞고 있어요. 눈을 떼지 마세요!",
    awaiting_pick: "행운 공이 있을 컵 하나를 골라보세요.",
    revealing_selected: "선택한 컵을 열고 있어요.",
    revealing_all: "나머지 컵도 차례로 공개할게요.",
    result: pendingResult?.won ? "명중! 행운 공을 찾았어요." : "아쉽지만 행운 공은 다른 컵에 있었어요.",
  }[phase] || "컵을 정리하고 있어요.";

  return (
    <GameShell
      icon="🥤"
      title="컵 속 행운"
      description="공이 든 컵을 눈으로 확인한 뒤, 실제로 섞이는 컵을 따라가 보세요."
      stats={stats}
      betAmount={Number(bet)}
    >
      <div className="grid gap-6 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="space-y-6">
          <BaseCard>
            <h2 className="text-lg font-black sm:text-xl">컵 개수 선택</h2>
            <p className="mt-1 text-sm leading-relaxed text-base-content/60">컵이 많을수록 확률은 낮아지고 배당은 커져요.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CUP_COUNTS.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={`min-h-12 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${cupCount === count ? "border-primary bg-primary/5 shadow-sm" : "border-base-300 bg-base-100"}`}
                  disabled={phase !== "idle" || busy}
                  onClick={() => { setCupCount(count); setCupIds(initialCupIds(count)); }}
                >
                  <strong className="block font-black">컵 {count}개</strong>
                  <span className="mt-1 block text-xs font-bold text-base-content/60">확률 {(100 / count).toFixed(2)}% · {count}배</span>
                </button>
              ))}
            </div>
          </BaseCard>

          <BetInput balance={user.balance} value={bet} onChange={setBet} disabled={phase !== "idle" || busy} />

          <BaseCard className="border-primary/20 bg-primary/5">
            <p className="text-xs font-black tracking-widest text-primary">CUP RULE</p>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div><span className="block text-[11px] font-bold text-base-content/50">성공 확률</span><strong className="text-lg font-black tabular-nums">{(100 / cupCount).toFixed(2)}%</strong></div>
              <div><span className="block text-[11px] font-bold text-base-content/50">총 지급 배당</span><strong className="text-lg font-black tabular-nums">{cupCount}배</strong></div>
              <div><span className="block text-[11px] font-bold text-base-content/50">기본 RTP</span><strong className="text-lg font-black tabular-nums text-success">100%</strong></div>
            </div>
          </BaseCard>
        </div>

        <BaseCard className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black tracking-widest text-primary">LUCKY CUP</p>
              <h2 className="mt-1 text-lg font-black sm:text-xl">행운 공 찾기</h2>
              <p className="mt-1 min-h-10 text-sm leading-relaxed text-base-content/60">{statusText}</p>
            </div>
            {stageRound && <span className="badge badge-primary font-bold whitespace-nowrap">컵 {stageRound.cupCount}개 · {stageRound.multiplier}배</span>}
          </div>

          {phase === "idle" || phase === "resetting" ? (
            <button type="button" className="btn btn-primary mt-6 min-h-12 w-full rounded-2xl" onClick={start} disabled={busy || Number(bet) < 1000 || user.balance < 1000}>
              {busy ? <span className="loading loading-dots" /> : "컵 섞고 시작하기"}
            </button>
          ) : (
            <CupStage
              cupIds={stageCupIds}
              phase={phase}
              luckyCupId={luckyCupId}
              selectedCupId={selectedCupId}
              winnerCupId={stageWinnerCupId}
              revealedCupIds={revealedCupIds}
              canPick={canPick}
              swapOffsets={swapOffsets}
              onPick={pickCup}
              stageRef={stageRef}
            />
          )}
          {phase !== "idle" && !result && <p className="mt-5 min-h-6 text-center text-sm font-bold text-base-content/60">{canPick ? "원하는 컵을 한 번만 선택할 수 있어요." : "연출 중에는 컵을 선택할 수 없어요."}</p>}
          <ErrorAlert message={error} />
        </BaseCard>
      </div>

      <ResultModal result={result} onClose={reset} successMessage="컵 속 행운을 찾았어요!" failureMessage="다음 컵에 행운이 기다리고 있어요">
        {result && (
          <div className="mt-3 rounded-2xl bg-base-200/60 p-4 text-left text-sm font-bold leading-relaxed">
            <p>{result.won ? "선택한 컵에서 행운 공이 나왔어요." : `행운 공은 ${result.round.winningCupIndex + 1}번 컵에 있었어요.`}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 tabular-nums text-xs">
              <span>배당 <strong className="float-right">{result.round.multiplier}배</strong></span>
              <span>총 지급액 <strong className="float-right">{formatMoney(result.round.grossPayout)}</strong></span>
              <span>수익 <strong className="float-right">{formatMoney(Math.max(0, result.round.grossProfit))}</strong></span>
              <span>잭팟 적립 <strong className="float-right">{formatMoney(result.round.prizeContribution)}</strong></span>
              <span className="col-span-2">최종 지급액 <strong className="float-right text-success">{formatMoney(result.round.finalPayout)}</strong></span>
            </div>
          </div>
        )}
      </ResultModal>
    </GameShell>
  );
}

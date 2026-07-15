import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import BetInput from "../components/BetInput";
import { ErrorAlert, GameShell } from "../components/GameShell";
import ResultModal from "../components/ResultModal";
import { BaseCard } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { formatMoney } from "../utils/format";

const TIMING_GAME_MODES = {
  5: {
    nominalSeconds: 5,
    targetMinSeconds: 3,
    targetMaxSeconds: 7,
    failWindowSeconds: 0.60,
    maxMultiplier: 2.00,
    curvePower: 1.2,
    maxBetCashRate: 0.35
  },
  10: {
    nominalSeconds: 10,
    targetMinSeconds: 8,
    targetMaxSeconds: 12,
    failWindowSeconds: 1.00,
    maxMultiplier: 3.00,
    curvePower: 1.3,
    maxBetCashRate: 0.30
  },
  15: {
    nominalSeconds: 15,
    targetMinSeconds: 13,
    targetMaxSeconds: 17,
    failWindowSeconds: 1.50,
    maxMultiplier: 5.00,
    curvePower: 1.4,
    maxBetCashRate: 0.28
  },
  20: {
    nominalSeconds: 20,
    targetMinSeconds: 18,
    targetMaxSeconds: 22,
    failWindowSeconds: 2.00,
    maxMultiplier: 8.00,
    curvePower: 1.5,
    maxBetCashRate: 0.25
  },
  30: {
    nominalSeconds: 30,
    targetMinSeconds: 28,
    targetMaxSeconds: 32,
    failWindowSeconds: 3.00,
    maxMultiplier: 12.00,
    curvePower: 1.6,
    maxBetCashRate: 0.20
  },
  45: {
    nominalSeconds: 45,
    targetMinSeconds: 43,
    targetMaxSeconds: 47,
    failWindowSeconds: 4.00,
    maxMultiplier: 18.00,
    curvePower: 1.8,
    maxBetCashRate: 0.15
  },
  60: {
    nominalSeconds: 60,
    targetMinSeconds: 58,
    targetMaxSeconds: 62,
    failWindowSeconds: 5.00,
    maxMultiplier: 30.00,
    curvePower: 2.0,
    maxBetCashRate: 0.10
  }
};

const ROUND_STORAGE_KEY = "lucky-pocket:timing-round-id";

function getResultGrade(errorMs, failWindowMs) {
  const errorSec = errorMs / 1000;
  const failWindowSec = failWindowMs / 1000;

  if (errorSec <= 0.02) return "완벽해요!";
  if (errorSec <= 0.05) return "놀라운 감각이에요!";
  if (errorSec <= 0.10) return "거의 정확했어요!";
  if (errorSec <= failWindowSec * 0.35) return "좋은 감각이에요!";
  if (errorSec < failWindowSec) return "아슬아슬했어요!";
  return "시간을 놓쳤어요.";
}

export default function TimingGame() {
  const { user, refreshUser } = useAuth();
  
  const [mode, setMode] = useState(10);
  const [bet, setBet] = useState("10000");
  const [round, setRound] = useState(null);
  
  // idle -> starting -> waiting_for_start -> running_visible -> running_hidden -> stopping -> revealing -> result -> expired
  const [phase, setPhase] = useState("idle");
  const [elapsedText, setElapsedText] = useState("0.00");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [history, setHistory] = useState([]);

  // 페이드아웃 설정
  const [fadeStartMs, setFadeStartMs] = useState(2500);
  const [fadeDurationMs, setFadeDurationMs] = useState(750);
  
  // 애니메이션 / 시간 관련 refs
  const timeOffsetRef = useRef(0);
  const rttRef = useRef(50);
  const requestRef = useRef(null);
  const startsAtMsRef = useRef(0);
  const aliveRef = useRef(true);
  const stopButtonRef = useRef(null);

  // 1. Reduced Motion 미디어 쿼리 감지
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  // 2. 최근 5회 전적 로드
  const loadHistory = async () => {
    try {
      const data = await api("/logs");
      if (data && data.logs) {
        const timingLogs = data.logs
          .filter((log) => log.game_type === "timing")
          .slice(0, 5);
        setHistory(timingLogs);
      }
    } catch {}
  };

  useEffect(() => {
    loadHistory();
  }, [user.balance]);

  // 3. 진행 중 라운드 복구
  useEffect(() => {
    aliveRef.current = true;
    const recover = async () => {
      const storedId = window.localStorage.getItem(ROUND_STORAGE_KEY);
      try {
        const data = storedId
          ? await api(`/games/timing/rounds/${storedId}`)
          : await api("/games/timing/rounds/current");
        
        const activeRound = data.round;
        if (!aliveRef.current || !activeRound) {
          if (storedId) window.localStorage.removeItem(ROUND_STORAGE_KEY);
          return;
        }

        if (activeRound.status === "settled" || activeRound.status === "expired" || activeRound.status === "cancelled") {
          window.localStorage.removeItem(ROUND_STORAGE_KEY);
          if (activeRound.status === "settled") {
            setResult({
              round: activeRound,
              won: activeRound.multiplier > 0,
              payout: activeRound.finalPayout,
              profit: activeRound.finalPayout - activeRound.betAmount
            });
            setPhase("result");
          } else {
            setPhase("idle");
          }
          return;
        }

        // 라운드 복구
        setRound(activeRound);
        setMode(activeRound.modeSeconds);
        window.localStorage.setItem(ROUND_STORAGE_KEY, activeRound.id);
        
        // 서버 시각 동기화 오프셋 추정
        // 복구 시에는 단순 로컬 시각을 기준으로 재동기화
        timeOffsetRef.current = 0; 
        startsAtMsRef.current = new Date(activeRound.startsAt).getTime();
        
        // 페이드 설정 복구/초기화
        const randomStart = 2200 + Math.floor(Math.random() * 600);
        const randomDuration = reducedMotion ? 200 : (650 + Math.floor(Math.random() * 200));
        setFadeStartMs(randomStart);
        setFadeDurationMs(randomDuration);

        setPhase("waiting_for_start");
      } catch (err) {
        if (storedId) window.localStorage.removeItem(ROUND_STORAGE_KEY);
      }
    };
    recover();
    return () => { aliveRef.current = false; };
  }, [reducedMotion]);

  // 4. 프레임 갱신용 루프 (requestAnimationFrame)
  const updateTimer = () => {
    if (!aliveRef.current) return;
    const startsAtMs = startsAtMsRef.current;
    if (!startsAtMs) return;

    const nowServerMs = Date.now() - timeOffsetRef.current;
    const elapsedMs = nowServerMs - startsAtMs;

    if (elapsedMs < 0) {
      // 시작 전
      setElapsedText("0.00");
      setPhase("waiting_for_start");
      requestRef.current = requestAnimationFrame(updateTimer);
      return;
    }

    // 게임 진행
    const seconds = Math.max(0, elapsedMs / 1000);
    setElapsedText(seconds.toFixed(2));

    const totalExpirationMs = round ? (round.targetTimeMs + round.failWindowMs + 5000) : 35000;
    if (elapsedMs >= totalExpirationMs) {
      // 자동 만료 시점 도래
      setPhase("expired");
      void expireActiveRound();
      return;
    }

    // 페이드 상태 관리
    if (elapsedMs >= fadeStartMs) {
      setPhase("running_hidden");
    } else {
      setPhase("running_visible");
    }

    requestRef.current = requestAnimationFrame(updateTimer);
  };

  // requestAnimationFrame 수명 관리
  useEffect(() => {
    if (phase === "waiting_for_start" || phase === "running_visible" || phase === "running_hidden") {
      requestRef.current = requestAnimationFrame(updateTimer);
    } else {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
    }
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [phase, round, fadeStartMs, fadeDurationMs]);

  // 자동 만료 정산 트리거
  const expireActiveRound = async () => {
    window.localStorage.removeItem(ROUND_STORAGE_KEY);
    await refreshUser();
    setError("시간 초과로 인해 베팅금을 모두 잃었어요.");
    setPhase("idle");
    setRound(null);
    loadHistory();
  };

  // 5. 모드 카드 관련 계산
  const modeConfig = TIMING_GAME_MODES[mode];
  const maxBetLimit = useMemo(() => {
    return Math.floor(user.balance * modeConfig.maxBetCashRate);
  }, [user.balance, modeConfig]);

  // 빠른 비율 베팅 적용 (해당 모드 베팅 한도 기준)
  const applyBetRatio = (ratio) => {
    const calculated = Math.floor(maxBetLimit * ratio);
    setBet(Math.max(1000, calculated).toString());
  };

  // 6. 게임 시작 API 호출
  const start = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const apiCallStart = performance.now();
      const data = await api("/games/timing/start", {
        method: "POST",
        body: JSON.stringify({ modeSeconds: mode, betAmount: Number(bet) }),
      });
      const apiCallEnd = performance.now();
      
      // RTT 측정 보정치
      rttRef.current = Math.max(10, Math.min(1000, Math.floor(apiCallEnd - apiCallStart)));
      
      const startedRound = data.round;
      setRound(startedRound);
      window.localStorage.setItem(ROUND_STORAGE_KEY, startedRound.id);
      
      // 서버 시각 오프셋 구하기
      const serverNowTime = new Date(data.serverNow).getTime();
      timeOffsetRef.current = Date.now() - serverNowTime;
      
      startsAtMsRef.current = new Date(startedRound.startsAt).getTime();

      // 페이드 시각 랜덤 세팅
      const randomStart = 2200 + Math.floor(Math.random() * 600); // 2.2초 ~ 2.8초
      const randomDuration = reducedMotion ? 200 : (650 + Math.floor(Math.random() * 200)); // 650ms ~ 850ms
      setFadeStartMs(randomStart);
      setFadeDurationMs(randomDuration);

      setPhase("starting");
      await refreshUser();
      
      // 준비 연출을 위해 300ms 딜레이 후 실 가동 대기
      setTimeout(() => {
        if (aliveRef.current) setPhase("waiting_for_start");
      }, 300);

    } catch (requestError) {
      setError(requestError.message);
      setPhase("idle");
      setRound(null);
    } finally {
      setBusy(false);
    }
  };

  // 7. 게임 정지 API 호출
  const stop = async () => {
    if (!round || busy || (phase !== "running_visible" && phase !== "running_hidden" && phase !== "waiting_start")) return;
    setBusy(true);
    setPhase("stopping");

    // 15ms 진동 (지원되는 경우)
    if (navigator.vibrate) {
      try {
        navigator.vibrate(15);
      } catch {}
    }

    const currentStartsAtMs = startsAtMsRef.current;
    const nowServerMs = Date.now() - timeOffsetRef.current;
    const clientElapsedMs = Math.max(0, nowServerMs - currentStartsAtMs);

    try {
      const data = await api("/games/timing/stop", {
        method: "POST",
        body: JSON.stringify({
          roundId: round.id,
          clientElapsedMs: Math.round(clientElapsedMs),
          clientRttMs: rttRef.current
        }),
      });

      if (!aliveRef.current) return;

      setRound(data.round);
      setResult(data);
      setPhase("result");
      
      window.localStorage.removeItem(ROUND_STORAGE_KEY);
      await refreshUser();
      loadHistory();
    } catch (requestError) {
      setError(requestError.message);
      setPhase("running_hidden"); // 오류 시 복구
    } finally {
      setBusy(false);
    }
  };

  // 8. 게임 리셋
  const reset = () => {
    window.localStorage.removeItem(ROUND_STORAGE_KEY);
    setRound(null);
    setResult(null);
    setError("");
    setPhase("idle");
    setElapsedText("0.00");
    startsAtMsRef.current = 0;
  };

  // 9. 데스크톱 스페이스 / 엔터 키보드 이벤트
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.repeat) return;
      if (e.key === " " || e.key === "Enter") {
        // 인풋 포커스 체크
        if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
          return;
        }
        
        // 정지 가능한 페이즈인지 확인
        if (phase === "running_visible" || phase === "running_hidden" || phase === "waiting_start") {
          e.preventDefault();
          void stop();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, round, busy]);

  // 페이드아웃 상태에 따른 애니메이션 스타일 계산
  const timerStyle = useMemo(() => {
    if (phase !== "running_hidden" && phase !== "stopping") {
      return { opacity: 1, transform: "scale(1)", filter: "none" };
    }

    const startsAtMs = startsAtMsRef.current;
    const nowServerMs = Date.now() - timeOffsetRef.current;
    const elapsedMs = nowServerMs - startsAtMs;

    if (elapsedMs < fadeStartMs) {
      return { opacity: 1, transform: "scale(1)", filter: "none" };
    }

    const progress = Math.min(1, (elapsedMs - fadeStartMs) / fadeDurationMs);

    return {
      opacity: 1 - progress,
      transform: reducedMotion ? "scale(1)" : `scale(${1 - progress * 0.02})`,
      filter: reducedMotion ? "none" : `blur(${progress * 2}px)`,
      transition: reducedMotion ? "opacity 200ms linear" : "none"
    };
  }, [phase, elapsedText, fadeStartMs, fadeDurationMs, reducedMotion]);

  const showActiveStage = round && (phase === "starting" || phase === "waiting_for_start" || phase === "running_visible" || phase === "running_hidden" || phase === "stopping" || phase === "result");
  const targetSecondsStr = round ? (round.targetTimeMs / 1000).toFixed(2) : "0.00";

  return (
    <GameShell
      icon="⏱️"
      title="시간 감각"
      description="목표 시간을 기억하세요. 타이머가 사라지면 감각만으로 멈춰야 해요."
      stats={{
        chance: 0, // 실력형이므로 고정값 제외
        multiplier: modeConfig.maxMultiplier,
        expectedLabel: `허용 오차 ±${modeConfig.failWindowSeconds}초`
      }}
      betAmount={Number(bet)}
    >
      <div className="grid gap-6 lg:grid-cols-[0.82fr_1.18fr]">
        {/* 설정 및 입력 부 */}
        <div className="space-y-6">
          <BaseCard>
            <h2 className="text-lg font-black sm:text-xl">시간 모드 선택</h2>
            <p className="mt-1 text-sm leading-relaxed text-base-content/60">긴 시간일수록 최대 배수가 크지만, 맞추기는 더 어려워요.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.keys(TIMING_GAME_MODES).map((key) => {
                const nominal = Number(key);
                const mConf = TIMING_GAME_MODES[nominal];
                return (
                  <button
                    key={nominal}
                    type="button"
                    className={`min-h-12 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${mode === nominal ? "border-primary bg-primary/5 shadow-sm" : "border-base-300 bg-base-100"}`}
                    disabled={phase !== "idle" || busy}
                    onClick={() => setMode(nominal)}
                  >
                    <strong className="block font-black">{nominal}초 모드</strong>
                    <span className="mt-1 block text-xs font-bold text-base-content/60">
                      최대 {mConf.maxMultiplier.toFixed(2)}배 · ±{mConf.failWindowSeconds.toFixed(2)}초
                    </span>
                  </button>
                );
              })}
            </div>
          </BaseCard>

          <BaseCard>
            <BetInput
              balance={user.balance}
              value={bet}
              onChange={setBet}
              disabled={phase !== "idle" || busy}
            />
            {phase === "idle" && (
              <div className="mt-3 grid grid-cols-4 gap-2">
                <button
                  type="button"
                  className="btn btn-outline btn-sm rounded-xl font-bold font-mono text-xs"
                  onClick={() => applyBetRatio(0.10)}
                >
                  10%
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm rounded-xl font-bold font-mono text-xs"
                  onClick={() => applyBetRatio(0.25)}
                >
                  25%
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm rounded-xl font-bold font-mono text-xs"
                  onClick={() => applyBetRatio(0.50)}
                >
                  50%
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm rounded-xl font-bold font-mono text-xs"
                  onClick={() => applyBetRatio(1.0)}
                >
                  최대
                </button>
              </div>
            )}
            <p className="mt-2 text-left text-xs font-bold text-base-content/40 leading-relaxed">
              * 베팅 제한 비율: 이 모드는 현재 잔고의 최대 <strong>{(modeConfig.maxBetCashRate * 100).toFixed(0)}%</strong>까지 베팅할 수 있습니다.<br />
              (현재 최대 베팅 가능 금액: {formatMoney(maxBetLimit)})
            </p>
          </BaseCard>

          <BaseCard className="border-teal-500/20 bg-teal-500/5">
            <p className="text-xs font-black tracking-widest text-teal-600">TIMING RULES</p>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs font-bold leading-normal">
              <div>
                <span className="block text-[10px] text-base-content/50">목표 오차범위</span>
                <strong className="text-sm font-black tabular-nums">
                  {(modeConfig.nominalSeconds - 2).toFixed(1)}~{(modeConfig.nominalSeconds + 2).toFixed(1)}초
                </strong>
              </div>
              <div>
                <span className="block text-[10px] text-base-content/50">실패 허용오차</span>
                <strong className="text-sm font-black text-red-500 tabular-nums">
                  ±{modeConfig.failWindowSeconds.toFixed(2)}초
                </strong>
              </div>
              <div>
                <span className="block text-[10px] text-base-content/50">최대 당첨 배수</span>
                <strong className="text-sm font-black text-teal-600 tabular-nums">
                  {modeConfig.maxMultiplier.toFixed(2)}배
                </strong>
              </div>
            </div>
          </BaseCard>
        </div>

        {/* 게임 무대 카드 */}
        <BaseCard className="flex flex-col min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black tracking-widest text-primary">TIMING STAGE</p>
              <h2 className="mt-1 text-lg font-black sm:text-xl">시간 감각 측정</h2>
            </div>
            {round && (
              <span className="badge badge-primary font-bold whitespace-nowrap">
                {round.mode_seconds || mode}초 모드 · 최대 {round.max_multiplier || modeConfig.maxMultiplier}배
              </span>
            )}
          </div>

          <div className="flex-1 flex flex-col items-center justify-center py-8">
            {!showActiveStage ? (
              <div className="text-center py-10 space-y-3">
                <span className="text-6xl" role="img" aria-label="clock">⏱️</span>
                <p className="text-sm font-black text-base-content/60">시간과 베팅금을 선택하고 시작해 보세요.</p>
              </div>
            ) : (
              <div className="w-full flex flex-col items-center text-center">
                {/* 상단: 목표 시간 */}
                <div className="mb-4">
                  <span className="text-xs font-black text-base-content/40 tracking-wider block uppercase">목표 시간</span>
                  <strong className="text-3xl sm:text-4xl font-black text-teal-600 font-mono tracking-tight tabular-nums">
                    {targetSecondsStr}초
                  </strong>
                </div>

                {/* 중앙: 진행 시간 (페이드 아웃 대상 영역 높이 고정) */}
                <div className="h-28 w-full flex items-center justify-center">
                  {phase === "starting" ? (
                    <span className="text-lg font-black text-primary animate-pulse">준비...</span>
                  ) : phase === "result" ? (
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-base-content/40 uppercase">실제 멈춘 시간</div>
                      <strong className="text-5xl font-black text-base-content font-mono tracking-tight tabular-nums">
                        {(result?.round?.serverElapsedMs / 1000).toFixed(2)}초
                      </strong>
                      <div className={`text-sm font-black mt-1 ${result?.won ? "text-success" : "text-error"}`}>
                        오차: {result?.round?.absoluteErrorMs >= 0 ? `${(result.round.serverElapsedMs / 1000 - result.round.targetTimeMs / 1000) >= 0 ? "+" : ""}${(result.round.serverElapsedMs / 1000 - result.round.targetTimeMs / 1000).toFixed(2)}초` : "0.00초"} 
                        ({getResultGrade(result?.round?.absoluteErrorMs, result?.round?.failWindowMs)})
                      </div>
                    </div>
                  ) : (
                    <div style={timerStyle} className="space-y-1 select-none">
                      <div className="text-[11px] font-bold text-base-content/30 uppercase tracking-widest">진행 시간</div>
                      <strong className="text-5xl font-black text-base-content/80 font-mono tracking-tight tabular-nums">
                        {elapsedText}초
                      </strong>
                    </div>
                  )}
                </div>

                {/* 하단: 정지 버튼 */}
                <div className="w-full max-w-xs mt-6 px-4">
                  {phase === "result" ? (
                    <button
                      type="button"
                      className="btn btn-outline btn-primary rounded-2xl w-full min-h-16 font-bold"
                      onClick={reset}
                    >
                      다시 하기
                    </button>
                  ) : (
                    <button
                      ref={stopButtonRef}
                      type="button"
                      className="btn btn-primary rounded-2xl w-full min-h-16 text-lg font-black tracking-widest shadow-md transition active:scale-95"
                      disabled={phase === "starting" || phase === "stopping" || busy}
                      onClick={stop}
                    >
                      {phase === "starting" ? "준비 중..." : "멈추기 (Space)"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {phase === "idle" && (
            <button
              type="button"
              className="btn btn-primary min-h-12 w-full rounded-2xl font-bold mt-4"
              onClick={start}
              disabled={busy || Number(bet) < 1000 || user.balance < 1000}
            >
              {busy ? <span className="loading loading-dots" /> : "시간 감각 도전하기"}
            </button>
          )}

          <ErrorAlert message={error} />
        </BaseCard>
      </div>

      {/* 최근 5회 시간 감각 기록 */}
      <div className="mt-8">
        <h3 className="text-md font-black mb-3">최근 시간 감각 도전 기록</h3>
        <div className="overflow-x-auto rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <table className="table w-full text-sm">
            <thead>
              <tr className="bg-base-200 text-base-content/70">
                <th className="font-bold">플레이 시각</th>
                <th className="font-bold">선택한 모드</th>
                <th className="font-bold text-center">목표 시간</th>
                <th className="font-bold text-center">기록 시간</th>
                <th className="font-bold text-center">오차</th>
                <th className="font-bold text-center">배수</th>
                <th className="font-bold text-right">베팅금</th>
                <th className="font-bold text-right">최종 지급액</th>
              </tr>
            </thead>
            <tbody className="font-medium">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-6 text-base-content/40">
                    아직 도전 기록이 없습니다.
                  </td>
                </tr>
              ) : (
                history.map((log) => {
                  let detail = {};
                  try {
                    detail = typeof log.detail_json === "string" ? JSON.parse(log.detail_json) : log.detail_json;
                  } catch {}
                  const targetSec = detail.targetTimeMs ? (detail.targetTimeMs / 1000).toFixed(2) : "-";
                  const elapsedSec = detail.serverElapsedMs ? (detail.serverElapsedMs / 1000).toFixed(2) : "-";
                  const errorSec = detail.absoluteErrorMs !== undefined ? (detail.absoluteErrorMs / 1000) : null;
                  const diffSec = (detail.serverElapsedMs && detail.targetTimeMs)
                    ? (detail.serverElapsedMs / 1000 - detail.targetTimeMs / 1000)
                    : 0;

                  return (
                    <tr key={log.id} className="hover:bg-base-200/50">
                      <td className="text-xs text-base-content/50 font-mono">
                        {new Date(log.created_at).toLocaleString("ko-KR")}
                      </td>
                      <td>{detail.modeSeconds || "-"}초 모드</td>
                      <td className="text-center font-mono font-bold text-teal-600">{targetSec}초</td>
                      <td className="text-center font-mono font-bold text-base-content">{elapsedSec}초</td>
                      <td className={`text-center font-mono font-bold ${log.result === "win" ? "text-success" : "text-error"}`}>
                        {errorSec !== null ? `${diffSec >= 0 ? "+" : ""}${diffSec.toFixed(2)}초` : "-"}
                      </td>
                      <td className="text-center font-mono text-xs">
                        {(log.payout / log.bet_amount).toFixed(2)}배
                      </td>
                      <td className="text-right font-mono text-base-content/70">
                        {formatMoney(log.bet_amount)}
                      </td>
                      <td className={`text-right font-mono font-bold ${log.result === "win" ? "text-success" : "text-base-content/40"}`}>
                        {formatMoney(log.payout)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 결과 모달 */}
      <ResultModal
        result={result}
        onClose={reset}
        successMessage={`${getResultGrade(result?.round?.absoluteErrorMs, result?.round?.failWindowMs)}`}
        failureMessage="범위를 벗어나 베팅금을 모두 잃었어요"
      >
        {result && (
          <div className="mt-3 rounded-2xl bg-base-200/60 p-4 text-left text-sm font-bold leading-relaxed space-y-3">
            <p className="text-center text-base-content/70 text-xs uppercase tracking-wider">상세 정산 정보</p>
            <div className="grid grid-cols-2 gap-y-2 gap-x-4 font-mono text-xs leading-normal">
              <span className="text-base-content/50">목표 시간</span>
              <strong className="text-right text-teal-600 font-black">{(result.round.targetTimeMs / 1000).toFixed(2)}초</strong>
              
              <span className="text-base-content/50">내 기록</span>
              <strong className="text-right text-base-content font-black">{(result.round.serverElapsedMs / 1000).toFixed(2)}초</strong>
              
              <span className="text-base-content/50">최종 오차</span>
              <strong className={`text-right font-black ${result.won ? "text-success" : "text-error"}`}>
                {(result.round.serverElapsedMs / 1000 - result.round.targetTimeMs / 1000) >= 0 ? "+" : ""}
                {(result.round.serverElapsedMs / 1000 - result.round.targetTimeMs / 1000).toFixed(2)}초
              </strong>
              
              <span className="text-base-content/50">당첨 배수</span>
              <strong className="text-right font-black text-primary">{result.round.multiplier.toFixed(2)}배</strong>

              <div className="col-span-2 border-t border-base-300 my-1"></div>

              <span className="text-base-content/50">베팅 원금</span>
              <strong className="text-right text-base-content/80">{formatMoney(result.round.betAmount)}</strong>
              
              <span className="text-base-content/50">총 지급액</span>
              <strong className="text-right text-base-content">{formatMoney(result.round.grossPayout)}</strong>
              
              <span className="text-base-content/50">순수익</span>
              <strong className="text-right text-teal-600">{formatMoney(Math.max(0, result.round.grossProfit))}</strong>
              
              <span className="text-base-content/50">누적 상금 적립 (1%)</span>
              <strong className="text-right text-amber-600">{formatMoney(result.round.prizeContribution)}</strong>
              
              <span className="col-span-2 text-xs font-black text-success border-t border-base-300 pt-2 flex justify-between mt-1">
                최종 수령액 <strong className="text-sm font-black text-success">{formatMoney(result.round.finalPayout)}</strong>
              </span>
            </div>
          </div>
        )}
      </ResultModal>
    </GameShell>
  );
}

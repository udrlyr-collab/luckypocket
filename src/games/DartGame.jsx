import { useMemo, useState } from "react";
import { api } from "../api/client";
import BetInput from "../components/BetInput";
import { ErrorAlert, GameShell } from "../components/GameShell";
import ResultModal from "../components/ResultModal";
import { useAuth } from "../context/AuthContext";
import { dartBets } from "../data/games";
import { formatMoney, formatPercent } from "../utils/format";

const BOARD_CENTER = 160;
const BOARD_RADIUS = 126;

export default function DartGame() {
  const { user, refreshUser } = useAuth();
  const [bet, setBet] = useState("10000");
  const [target, setTarget] = useState("wide");
  const [sector, setSector] = useState(7);
  const [result, setResult] = useState(null);
  const [visualResult, setVisualResult] = useState(null);
  const [lastDart, setLastDart] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("idle");
  const spec = useMemo(() => dartBets.find((item) => item.key === target), [target]);
  const selectedLabel = spec.sector ? `${sector}번 ${spec.label}` : spec.label;
  const successCondition = getSuccessCondition(spec, sector);

  const clearPreviousResult = () => {
    setLastDart(null);
    setVisualResult(null);
    setResult(null);
    setPhase("idle");
  };

  const chooseTarget = (key) => {
    setTarget(key);
    clearPreviousResult();
  };

  const chooseSector = (nextSector) => {
    setSector(Math.min(20, Math.max(1, nextSector)));
    clearPreviousResult();
  };

  const play = async () => {
    setBusy(true);
    setError("");
    setLastDart(null);
    setResult(null);
    setVisualResult(null);
    setPhase("aiming");
    try {
      const data = await api("/games/dart/play", {
        method: "POST",
        body: JSON.stringify({
          betAmount: Number(bet),
          target,
          sector: spec.sector ? sector : undefined,
        }),
      });
      setLastDart(data.detail);
      setVisualResult(data);
      setPhase("flying");
      await new Promise((resolve) => setTimeout(resolve, 850));
      setPhase("impact");
      await refreshUser();
      await new Promise((resolve) => setTimeout(resolve, 800));
      setResult(data);
      setPhase("settled");
    } catch (requestError) {
      setError(requestError.message);
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GameShell
      icon="🎯"
      title="다트 던지기"
      description="목표 영역을 고르고, 파스텔 다트판에 행운의 한 발을 던져요."
      stats={spec}
      betAmount={Number(bet)}
    >
      <div className="grid min-w-0 gap-6 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="space-y-5">
          <BetInput balance={user.balance} value={bet} onChange={setBet} eventCap={spec.event} disabled={busy} />
          <section className="soft-card">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Choose a target</p>
                <h2 className="text-lg font-black">목표 영역</h2>
              </div>
              <span className="badge badge-primary whitespace-nowrap font-black">{selectedLabel}</span>
            </div>
            <div className="dart-target-grid">
              {dartBets.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={`dart-target-button ${target === item.key ? "is-selected" : ""}`}
                  disabled={busy}
                  onClick={() => chooseTarget(item.key)}
                >
                  <span className="font-black">{item.label}</span>
                  <span className="mt-1 flex items-center justify-between gap-2 text-[11px] opacity-65">
                    <span>{formatPercent(item.chance)}</span>
                    <strong>{item.multiplier.toLocaleString("ko-KR")}배</strong>
                  </span>
                </button>
              ))}
            </div>
            {spec.sector && (
              <div className="mt-5 rounded-2xl bg-base-200/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-black">선택 섹터</span>
                  <strong className="text-xl text-primary tabular-nums">{sector}번</strong>
                </div>
                <div className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-3">
                  <button
                    type="button"
                    className="btn btn-sm rounded-xl"
                    disabled={busy || sector <= 1}
                    onClick={() => chooseSector(sector - 1)}
                    aria-label="이전 섹터"
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    value={sector}
                    className="range range-primary range-sm"
                    disabled={busy}
                    onChange={(event) => chooseSector(Number(event.target.value))}
                    aria-label="다트 섹터"
                  />
                  <button
                    type="button"
                    className="btn btn-sm rounded-xl"
                    disabled={busy || sector >= 20}
                    onClick={() => chooseSector(sector + 1)}
                    aria-label="다음 섹터"
                  >
                    +
                  </button>
                </div>
              </div>
            )}
            <div className="mt-4 rounded-2xl border border-primary/15 bg-primary/5 p-4">
              <InfoLine label="현재 선택" value={selectedLabel} />
              <InfoLine label="성공 조건" value={successCondition} />
              <InfoLine label="예상 지급액" value={formatMoney(Number(bet || 0) * spec.multiplier)} accent />
            </div>
          </section>
        </div>

        <section className={`soft-card dart-board-card ${phase === "impact" ? (visualResult?.won ? "dart-board-hit" : "dart-board-miss") : ""}`}>
          <div className="mb-3 flex items-center justify-between gap-3 text-left">
            <div>
              <p className="eyebrow">Lucky dart board</p>
              <h2 className="text-lg font-black">선택 영역을 노려보세요</h2>
            </div>
            <span className={`status status-lg ${phase === "flying" || phase === "aiming" ? "status-warning animate-pulse" : phase === "impact" ? (visualResult?.won ? "status-success" : "status-error") : "status-primary"}`} />
          </div>

          <DartBoard
            dart={lastDart}
            selectedSector={spec.sector ? sector : null}
            phase={phase}
            target={target}
            won={visualResult?.won}
          />

          <p className="mt-4 min-h-6 text-center text-sm font-black text-base-content/65">
            {phase === "aiming"
              ? "행운의 좌표를 계산하고 있어요…"
              : phase === "flying"
                ? "다트가 포물선을 그리며 날아가요!"
                : lastDart
                  ? `중심 거리 r ${lastDart.radius.toFixed(4)} · ${lastDart.sector}번 섹터`
                  : "목표를 고르고 다트를 던져보세요"}
          </p>

          {visualResult && phase !== "flying" && (
            <DartResultCard
              data={visualResult}
              selectedLabel={selectedLabel}
              successCondition={successCondition}
            />
          )}

          <button
            className="btn btn-accent mt-4 h-14 w-full whitespace-nowrap rounded-2xl text-base font-black shadow-md shadow-accent/15"
            disabled={busy || user.balance < 1000 || Number(bet) < 1000}
            onClick={play}
          >
            {busy ? (
              <>
                <span className="loading loading-spinner loading-sm" />
                {phase === "aiming" ? "조준하는 중…" : phase === "flying" ? "날아가는 중…" : "결과 확인 중…"}
              </>
            ) : "🎯 다트 던지기"}
          </button>
          <ErrorAlert message={error} />
        </section>
      </div>

      <ResultModal
        result={result}
        onClose={() => setResult(null)}
        successMessage="명중! 행운주머니가 통통 불어났어요"
        failureMessage="조금 빗나갔어요"
      >
        <p className="mt-3 text-sm">
          {result?.won ? "정확해요! 자산이 늘어났어요." : "아쉽지만 다음 다트가 기다리고 있어요."}
        </p>
      </ResultModal>
    </GameShell>
  );
}

function getSuccessCondition(spec, sector) {
  if (spec.sector && spec.key === "sector") return `${sector}번 섹터 안에 꽂히면 성공`;
  if (spec.sector) return `${sector}번 섹터와 ${spec.label.replace("섹터 + ", "")}의 교차 영역`;
  if (spec.key === "bullseye") return "중심 거리 r ≤ 0.10이면 성공";
  const radii = { wide: "0.70", middle: "0.50", small: "0.25" };
  return `중심 거리 r ≤ ${radii[spec.key]}이면 성공`;
}

function InfoLine({ label, value, accent = false }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 py-1.5 text-xs">
      <span className="shrink-0 font-bold text-base-content/45">{label}</span>
      <strong className={`min-w-0 text-right font-black ${accent ? "text-primary tabular-nums" : ""}`}>{value}</strong>
    </div>
  );
}

function DartResultCard({ data, selectedLabel, successCondition }) {
  return (
    <div className={`dart-result-card ${data.won ? "is-win" : "is-loss"}`}>
      <div className="flex items-center justify-between gap-3">
        <strong className={data.won ? "text-success" : "text-error"}>
          {data.won ? "✓ 목표 영역 명중" : "× 목표에서 벗어남"}
        </strong>
        <span className="text-xs font-black tabular-nums">{data.detail.multiplier.toLocaleString("ko-KR")}배</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-left text-xs">
        <ResultDetail label="선택한 목표" value={selectedLabel} />
        <ResultDetail label="중심 거리" value={`r ${data.detail.radius.toFixed(4)}`} />
        <ResultDetail label="성공 조건" value={successCondition} wide />
        <ResultDetail
          label={data.won ? "획득 금액" : "손실 금액"}
          value={data.won ? formatMoney(data.payout) : formatMoney(Math.abs(data.profit))}
          color={data.won ? "text-success" : "text-error"}
        />
      </div>
    </div>
  );
}

function ResultDetail({ label, value, wide = false, color = "" }) {
  return (
    <div className={`rounded-xl bg-base-100/75 p-2.5 ${wide ? "col-span-2" : ""}`}>
      <span className="block text-[10px] font-bold text-base-content/40">{label}</span>
      <strong className={`mt-1 block font-black tabular-nums ${color}`}>{value}</strong>
    </div>
  );
}

function polarPoint(radius, angle) {
  return {
    x: BOARD_CENTER + radius * Math.cos(angle),
    y: BOARD_CENTER + radius * Math.sin(angle),
  };
}

function sectorPath(sector, radius) {
  const start = ((sector - 1) * Math.PI * 2) / 20;
  const end = (sector * Math.PI * 2) / 20;
  const from = polarPoint(radius, start);
  const to = polarPoint(radius, end);
  return `M ${BOARD_CENTER} ${BOARD_CENTER} L ${from.x} ${from.y} A ${radius} ${radius} 0 0 1 ${to.x} ${to.y} Z`;
}

function targetRadius(target) {
  return {
    wide: 0.7,
    middle: 0.5,
    small: 0.25,
    bullseye: 0.1,
    sector_middle: 0.5,
    sector_bullseye: 0.1,
  }[target] ?? 1;
}

function DartBoard({ dart, selectedSector, phase, target, won }) {
  const dartX = dart ? BOARD_CENTER + dart.x * BOARD_RADIUS : BOARD_CENTER;
  const dartY = dart ? BOARD_CENTER + dart.y * BOARD_RADIUS : BOARD_CENTER;
  const highlightRadius = BOARD_RADIUS * targetRadius(target);
  const sectors = Array.from({ length: 20 }, (_, index) => index + 1);

  return (
    <div className="dart-stage mx-auto w-full max-w-[420px]">
      {phase === "flying" && dart && (
        <span
          className="dart-flight"
          style={{
            "--dart-left": `${(dartX / 320) * 100}%`,
            "--dart-top": `${(dartY / 320) * 100}%`,
          }}
          aria-hidden="true"
        >
          ➶
        </span>
      )}
      <svg
        viewBox="0 0 320 320"
        className={`dart-board-svg ${phase === "impact" ? "dart-impact" : ""}`}
        role="img"
        aria-label={`20개 섹터 다트판, ${selectedSector ? `${selectedSector}번 섹터 ` : ""}${target} 선택`}
      >
        <defs>
          <filter id="dart-board-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#8f7585" floodOpacity=".22" />
          </filter>
          <filter id="dart-selection-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="dart-board-base">
            <stop offset="0%" stopColor="#fffafd" />
            <stop offset="100%" stopColor="#f8edf2" />
          </radialGradient>
        </defs>

        <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r={BOARD_RADIUS + 7} fill="#fff" filter="url(#dart-board-shadow)" />
        <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r={BOARD_RADIUS} fill="url(#dart-board-base)" stroke="#eadce4" strokeWidth="3" />

        {sectors.map((number) => (
          <path
            key={`sector-fill-${number}`}
            d={sectorPath(number, BOARD_RADIUS)}
            fill={number % 2 ? "#fce7f0" : "#e6f5f1"}
            fillOpacity=".62"
            stroke="#fff"
            strokeWidth="1"
          />
        ))}

        {[0.7, 0.5, 0.25, 0.1].map((ratio) => (
          <circle
            key={ratio}
            cx={BOARD_CENTER}
            cy={BOARD_CENTER}
            r={BOARD_RADIUS * ratio}
            fill="none"
            stroke={ratio === 0.1 ? "#e8a3b4" : "#dbcdd6"}
            strokeWidth={ratio === 0.1 ? "2.5" : "1.5"}
            strokeDasharray={ratio === 0.7 || ratio === 0.25 ? "4 4" : undefined}
          />
        ))}

        {selectedSector ? (
          <path
            className={target.includes("bullseye") ? "dart-bullseye-pulse" : ""}
            d={sectorPath(selectedSector, highlightRadius)}
            fill="#65c3c8"
            fillOpacity=".38"
            stroke="#2aa9b0"
            strokeWidth="3.5"
            filter="url(#dart-selection-glow)"
          />
        ) : (
          <circle
            className={target === "bullseye" ? "dart-bullseye-pulse" : ""}
            cx={BOARD_CENTER}
            cy={BOARD_CENTER}
            r={highlightRadius}
            fill="#65c3c8"
            fillOpacity=".28"
            stroke="#2aa9b0"
            strokeWidth="3.5"
            filter="url(#dart-selection-glow)"
          />
        )}

        {sectors.map((number) => {
          const angle = ((number - 0.5) * Math.PI * 2) / 20;
          const point = polarPoint(BOARD_RADIUS - 10, angle);
          return (
            <text
              key={`sector-label-${number}`}
              x={point.x}
              y={point.y + 3}
              textAnchor="middle"
              className={`dart-sector-label ${selectedSector === number ? "is-selected" : ""}`}
            >
              {number}
            </text>
          );
        })}

        <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r="4" fill="#f06f8a" />

        {dart && phase !== "flying" && (
          <g className="dart-land">
            <circle
              className="dart-result-ring"
              cx={dartX}
              cy={dartY}
              r="17"
              fill="none"
              stroke={won ? "#36d399" : "#f87272"}
              strokeWidth="4"
            />
            <path
              d={`M ${dartX - 13} ${dartY + 13} L ${dartX - 3} ${dartY + 3}`}
              stroke="#6f5364"
              strokeWidth="5"
              strokeLinecap="round"
            />
            <circle cx={dartX} cy={dartY} r="7" fill={won ? "#36d399" : "#f87272"} stroke="#fff" strokeWidth="3" />
            <circle cx={dartX} cy={dartY} r="2.5" fill="#6f5364" />
          </g>
        )}
      </svg>
    </div>
  );
}

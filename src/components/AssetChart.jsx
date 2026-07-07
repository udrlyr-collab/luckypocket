import { useMemo } from 'react';
import { formatKoreanNumber, formatMoney, formatSignedMoney } from '../utils/format';
export default function AssetChart({ points, range, scaleMode }) {
  const graph = useMemo(() => {
    const width = 800;
    const height = 330;
    const padding = { left: 78, right: 22, top: 20, bottom: 48 };
    const balances = points.map((point) => point.balance);
    const rawMin = Math.min(...balances);
    const rawMax = Math.max(...balances);
    const rawSpread = Math.max(1, rawMax - rawMin);
    const zoomPadding = Math.max(rawSpread * 0.08, rawMax * 0.005, 1000);
    const min = scaleMode === "zoom"
      ? Math.max(0, rawMin - zoomPadding)
      : Math.min(0, rawMin);
    const max = scaleMode === "zoom"
      ? rawMax + zoomPadding
      : Math.max(rawMax * 1.05, rawMax + 1000);
    const spread = Math.max(1, max - min);
    const times = points.map((point) => new Date(point.createdAt).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const timeSpread = Math.max(1, maxTime - minTime);
    const eventSpacing = scaleMode === "zoom";
    const plotted = points.map((point, index) => ({
      ...point,
      x: points.length === 1
        ? width / 2
        : padding.left + (
          eventSpacing
            ? index / (points.length - 1)
            : (times[index] - minTime) / timeSpread
        ) * (width - padding.left - padding.right),
      y: height - padding.bottom - ((point.balance - min) / spread) * (height - padding.top - padding.bottom),
    }));
    const path = plotted.reduce((value, point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      const previous = plotted[index - 1];
      const controlX = (previous.x + point.x) / 2;
      return `${value} C ${controlX} ${previous.y}, ${controlX} ${point.y}, ${point.x} ${point.y}`;
    }, "");
    return {
      width,
      height,
      padding,
      plotted,
      path,
      min,
      max,
      minTime,
      maxTime,
      eventSpacing,
    };
  }, [points, scaleMode]);

  const label = (value) =>
    new Intl.DateTimeFormat("ko-KR", range === "day"
      ? { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }
      : range === "week"
        ? { weekday: "short", month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }
        : { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(value));

  const compactMoney = (value) => formatKoreanNumber(value, 1);

  if (points.length < 2) {
    return <div className="empty-state py-16">아직 표시할 변화가 충분하지 않아요.</div>;
  }

  const gridRatios = [0, 0.25, 0.5, 0.75, 1];
  const xRatios = [0, 0.33, 0.66, 1];
  const chartBottom = graph.height - graph.padding.bottom;

  return (
    <div className="asset-chart min-w-0">
      <svg viewBox={`0 0 ${graph.width} ${graph.height}`} className="h-auto w-full" role="img" aria-label="선택 기간의 자산 변화 라인 그래프">
        <defs>
          <linearGradient id="asset-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#65c3c8" stopOpacity=".32" />
            <stop offset="100%" stopColor="#65c3c8" stopOpacity=".02" />
          </linearGradient>
          <filter id="asset-line-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {gridRatios.map((ratio) => {
          const y = graph.padding.top + ratio * (graph.height - graph.padding.top - graph.padding.bottom);
          const value = graph.max - ratio * (graph.max - graph.min);
          return (
            <g key={ratio}>
              <line x1={graph.padding.left} x2={graph.width - graph.padding.right} y1={y} y2={y} stroke="currentColor" strokeOpacity=".08" strokeDasharray="4 5" />
              <text x={graph.padding.left - 10} y={y + 4} textAnchor="end" className="asset-axis-label">{compactMoney(value)}</text>
            </g>
          );
        })}
        <path d={`${graph.path} L ${graph.plotted.at(-1).x} ${chartBottom} L ${graph.plotted[0].x} ${chartBottom} Z`} fill="url(#asset-area)" />
        <path d={graph.path} fill="none" stroke="#65c3c8" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" filter="url(#asset-line-glow)" />
        {graph.plotted.map((point) => (
          <g key={point.id} tabIndex="0" role="img" aria-label={`${label(point.createdAt)} ${formatMoney(point.balance)}`}>
            <title>{label(point.createdAt)} · {formatMoney(point.balance)} · {formatSignedMoney(point.amount)}</title>
            <circle cx={point.x} cy={point.y} r="9" fill="transparent" />
            {graph.plotted.length <= 30 && (
              <circle cx={point.x} cy={point.y} r="5" fill="#65c3c8" stroke="white" strokeWidth="3" />
            )}
          </g>
        ))}
        {xRatios.map((ratio) => {
          const x = graph.padding.left + ratio * (graph.width - graph.padding.left - graph.padding.right);
          const eventIndex = Math.round(ratio * (points.length - 1));
          const time = graph.eventSpacing
            ? new Date(points[eventIndex].createdAt).getTime()
            : graph.minTime + ratio * (graph.maxTime - graph.minTime);
          return (
            <text key={ratio} x={x} y={graph.height - 15} textAnchor={ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"} className="asset-axis-label">
              {label(time)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

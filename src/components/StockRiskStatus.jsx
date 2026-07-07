function remainingRecoveryTime(stock) {
  const required = Number(stock.recoveryRequiredTicks || stock.recovery_required_ticks || 6);
  const current = Number(stock.recoveryTickCount || stock.recovery_tick_count || 0);
  const seconds = Math.max(0, required - current) * 10;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes > 0) return `${minutes}분 ${restSeconds}초`;
  return `${restSeconds}초`;
}

export function getStockTier(marketCap) {
  const cap = Number(marketCap) || 0;
  if (cap >= 10_000_000_000_000) return { label: "대표 대형주", className: "badge-primary text-primary-content" };
  if (cap >= 2_000_000_000_000) return { label: "초대형주", className: "badge-secondary text-secondary-content" };
  if (cap >= 500_000_000_000) return { label: "대형주", className: "badge-accent text-accent-content" };
  if (cap >= 100_000_000_000) return { label: "중형주", className: "badge-info text-info-content" };
  if (cap >= 30_000_000_000) return { label: "중소형주", className: "badge-ghost bg-base-300" };
  if (cap >= 10_000_000_000) return { label: "소형주", className: "badge-ghost" };
  if (cap >= 6_000_000_000) return { label: "초소형주", className: "badge-warning" };
  return { label: "위험 소형주", className: "badge-error text-error-content" };
}

export function StockTierBadge({ stock, compact = false }) {
  if (stock.status === 'ipo_subscription' || stock.status === 'newly_listed') {
    // 공모주는 별도로 표시할 수도 있지만 시가총액 기반으로 그대로 표시
  }
  const { label, className } = getStockTier(stock.market_cap);
  const size = compact ? "badge-xs py-1" : "";
  return <span className={`badge font-bold ${className} ${size}`}>{label}</span>;
}

export function StockRiskBadges({ stock, compact = false }) {
  const risk = stock.delist_risk_status || "normal";
  const size = compact ? "badge-xs py-1" : "";

  if (risk === "caution") {
    return (
      <span className={`badge badge-warning font-bold ${size}`}>
        거래주의
      </span>
    );
  }
  if (risk === "delist_review" || risk === "unstable") {
    return (
      <>
        <span className={`badge badge-warning font-bold ${size}`}>
          상장폐지 심사
        </span>
        <span className={`badge badge-error font-bold animate-pulse ${size}`}>
          급등락 위험
        </span>
      </>
    );
  }
  if (risk === "recovery") {
    const current = Number(stock.recoveryTickCount || stock.recovery_tick_count || 0);
    const required = Number(stock.recoveryRequiredTicks || stock.recovery_required_ticks || 6);
    return (
      <span className={`badge badge-success font-bold ${size}`}>
        회생 중 {current}/{required}
      </span>
    );
  }
  if (risk === "final_crash") {
    return (
      <span className={`badge badge-error font-bold animate-pulse ${size}`}>
        최종 폭락
      </span>
    );
  }
  return null;
}

export function StockRiskNotice({ stock }) {
  const risk = stock.delist_risk_status || "normal";
  if (stock.status === "delisted" || risk === "delisted") {
    return (
      <div className="alert mb-6 rounded-2xl border border-error/25 bg-base-200 text-base-content">
        <span>
          <strong className="block text-error">상장폐지</strong>
          보유 주식 가치가 0원이 되었어요.
        </span>
      </div>
    );
  }
  if (risk === "normal") return null;

  if (risk === "caution") {
    return (
      <div className="alert alert-warning mb-6 rounded-2xl">
        <span>
          <strong className="block">거래주의 · 시가총액 60억원 미만</strong>
          시가총액이 3틱 연속 60억원 미만으로 내려갔어요.
        </span>
      </div>
    );
  }
  if (risk === "delist_review" || risk === "unstable") {
    return (
      <div className="alert mb-6 rounded-2xl border border-error/30 bg-warning/15 text-base-content">
        <span>
          <strong className="block text-error">상장폐지 심사 중 · 급등락 위험</strong>
          60억원 이상으로 회복한 뒤 1분 동안 유지하면 회생해요.
          <br />
          시가총액이 10억원 미만으로 떨어지면 최종 폭락 단계에 들어갑니다.
        </span>
      </div>
    );
  }
  if (risk === "recovery") {
    const current = Number(stock.recoveryTickCount || stock.recovery_tick_count || 0);
    const required = Number(stock.recoveryRequiredTicks || stock.recovery_required_ticks || 6);
    return (
      <div className="alert alert-success mb-6 rounded-2xl">
        <span>
          <strong className="block">
            회생 중 · {current}/{required}
          </strong>
          60억원 이상 유지가 필요해요. 남은 유지 시간:{" "}
          {remainingRecoveryTime(stock)}
        </span>
      </div>
    );
  }
  if (risk === "final_crash") {
    return (
      <div className="alert alert-error mb-6 rounded-2xl">
        <span>
          <strong className="block">최종 폭락</strong>
          다음 10초 갱신에서 상장폐지될 수 있어요.
        </span>
      </div>
    );
  }
  return null;
}

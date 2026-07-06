function remainingRecoveryTime(stock) {
  const required = Number(stock.recovery_required_ticks || 60);
  const current = Number(stock.recovery_tick_count || 0);
  const seconds = Math.max(0, required - current) * 10;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return `${minutes}분 ${restSeconds}초`;
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
    return (
      <span className={`badge badge-success font-bold ${size}`}>
        회생 중 {Number(stock.recovery_tick_count || 0)}/
        {Number(stock.recovery_required_ticks || 60)}
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
          60억원 이상으로 회복한 뒤 10분 동안 유지하면 회생해요.
          <br />
          시가총액이 10억원 미만으로 떨어지면 최종 폭락 단계에 들어갑니다.
        </span>
      </div>
    );
  }
  if (risk === "recovery") {
    return (
      <div className="alert alert-success mb-6 rounded-2xl">
        <span>
          <strong className="block">
            회생 중 · {Number(stock.recovery_tick_count || 0)}/
            {Number(stock.recovery_required_ticks || 60)}틱
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

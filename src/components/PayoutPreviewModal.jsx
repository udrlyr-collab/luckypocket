import { useEffect, useState } from "react";
import { api } from "../api/client";
import { formatMoney, formatPercent } from "../utils/format";

export default function PayoutPreviewModal({ betAmount, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!betAmount || betAmount < 1000) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    api(`/games/risk/payout-preview?betAmount=${betAmount}`)
      .then(setData)
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [betAmount]);

  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="preview-title">
      <div className="modal-box max-w-2xl rounded-[2rem]">
        <h2 id="preview-title" className="text-xl font-black">
          📊 배팅금에 따른 배당 확인
        </h2>
        <p className="mt-2 text-sm text-base-content/60">
          {formatMoney(betAmount)} 배팅 기준으로 각 단계의 배당을 보여드려요.
        </p>
        {data?.isAdjusted && (
          <div className="mt-3 rounded-2xl bg-warning/10 p-3 text-xs text-warning-content/80">
            <strong>💡 고액 배팅 조정 안내</strong>
            <p className="mt-1">
              {formatMoney(data.threshold)}까지는 기본 배당이 그대로 적용돼요. 그 이상부터는 게임 밸런스를 위해
              배당이 부드럽게 조정돼요.
            </p>
          </div>
        )}
        {loading && (
          <div className="flex justify-center py-10">
            <span className="loading loading-spinner loading-lg" />
          </div>
        )}
        {error && (
          <div role="alert" className="alert alert-error mt-4 rounded-2xl text-sm">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}
        {data && !loading && (
          <div className="mt-4 overflow-x-auto">
            <table className="table table-sm w-full text-center">
              <thead>
                <tr className="text-xs">
                  <th>단계</th>
                  <th>누적 확률</th>
                  <th>기본 배당</th>
                  <th>적용 배당</th>
                  <th className="text-right">예상 지급액</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {data.stages.map((stage) => (
                  <tr key={stage.stage} className={stage.adjusted ? "bg-warning/5" : ""}>
                    <td className="font-black">{stage.stage}단계</td>
                    <td className="tabular-nums">{formatPercent(stage.cumulativeProbability)}</td>
                    <td className="tabular-nums">{stage.baseMultiplier.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}배</td>
                    <td className="tabular-nums font-bold">
                      {stage.effectiveMultiplier.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}배
                    </td>
                    <td className="text-right tabular-nums font-bold">
                      {formatMoney(stage.expectedPayout)}
                    </td>
                    <td>
                      {stage.adjusted ? (
                        <span className="badge badge-warning badge-sm">조정</span>
                      ) : (
                        <span className="badge badge-primary badge-sm">기본</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-5 space-y-1 text-xs text-base-content/50">
          <p>🔹 배팅금이 커져도 예상 지급액은 계속 증가해요.</p>
          <p>🔹 조정 배당은 고액 배팅에서 갑작스러운 밸런스 붕괴를 막기 위한 장치예요.</p>
          <p>🔹 고액 배팅 구간에서도 기대값은 항상 플러스를 유지해요.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary mt-5 w-full rounded-2xl"
          onClick={onClose}
        >
          확인
        </button>
      </div>
      <button className="modal-backdrop" type="button" aria-label="닫기" onClick={onClose} />
    </div>
  );
}

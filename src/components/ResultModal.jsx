import { formatMoney, formatSignedMoney } from "../utils/format";

export default function ResultModal({
  result,
  onClose,
  children,
  successMessage = "성공! 자산이 통통 늘어났어요",
  failureMessage = "아쉽지만 다음 행운이 기다려요",
  showCoins = false,
}) {
  if (!result) return null;
  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="result-title">
      <div className={`modal-box overflow-hidden rounded-[2rem] text-center ${result.won ? "result-pop" : "result-shake"}`}>
        {showCoins && result.won && (
          <div className="coin-particles" aria-hidden="true">
            <span>●</span>
            <span>●</span>
            <span>●</span>
          </div>
        )}
        <div className="relative z-10 mx-auto mb-3 grid size-20 place-items-center rounded-full bg-base-200 text-5xl">
          {result.won ? "🎉" : "🌱"}
        </div>
        <h2 id="result-title" className={`relative z-10 text-2xl font-black ${result.won ? "text-success" : "text-error"}`}>
          {result.won ? successMessage : failureMessage}
        </h2>
        <div className="relative z-10">{children}</div>
        <div className="relative z-10 my-5 grid grid-cols-2 gap-3">
          <div className="mini-stat">
            <span>획득 금액</span>
            <strong>{formatMoney(result.payout)}</strong>
          </div>
          <div className="mini-stat">
            <span>순이익</span>
            <strong className={result.profit >= 0 ? "text-success" : "text-error"}>
              {formatSignedMoney(result.profit)}
            </strong>
          </div>
        </div>
        {result.achievements?.map((achievement) => (
          <div className="alert alert-warning achievement-pop relative z-10 mb-2 rounded-2xl text-left" key={achievement.key}>
            <span>🏅</span>
            <span>
              <strong>{achievement.title}</strong> 업적 달성!
              {achievement.reward > 0 && ` +${formatMoney(achievement.reward)}`}
            </span>
          </div>
        ))}
        <button type="button" className="btn btn-primary relative z-10 mt-3 w-full rounded-2xl" onClick={onClose}>
          확인
        </button>
      </div>
      <button className="modal-backdrop" type="button" aria-label="결과 닫기" onClick={onClose} />
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { formatMoney } from "../utils/format";

export default function JackpotResultDialog() {
  const [notices, setNotices] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    api("/games/daily-jackpot/notices/unseen")
      .then((data) => {
        if (!mounted) return;
        if (data && data.length > 0) {
          setNotices(data);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  if (notices.length === 0 || currentIndex >= notices.length) return null;

  const currentNotice = notices[currentIndex];

  const handleClose = async () => {
    setBusy(true);
    try {
      await api(`/games/daily-jackpot/notices/${currentNotice.noticeId}/seen`, { method: "POST" });
      setCurrentIndex((prev) => prev + 1);
    } catch (e) {
      console.error(e);
      setCurrentIndex((prev) => prev + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="jackpot-title">
      <div className="modal-box rounded-[2rem] border border-warning/30 bg-gradient-to-br from-warning/10 via-base-100 to-primary/10">
        <div className="text-center">
          <div className="mb-3 text-5xl" aria-hidden="true">🎰</div>
          <p className="eyebrow text-warning">DAILY JACKPOT</p>
          <h2 id="jackpot-title" className="text-2xl font-black mt-1">
            오늘의 잭팟 추첨 결과
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-base-content/65">
            총 <span className="font-bold text-warning">{currentNotice.totalEffectiveEntries?.toLocaleString("ko-KR")}</span>장의 응모가 모인 잭팟,<br/>
            주인공이 결정되었습니다!
          </p>
        </div>

        <div className="mt-5 rounded-3xl bg-base-200/70 p-4 text-center shadow-inner">
          <p className="text-sm font-bold text-base-content/60">🎉 당첨자</p>
          <strong className="mt-1 block text-2xl font-black text-primary">
            {currentNotice.winnerNickname} 님
          </strong>
          
          <div className="mt-4 flex justify-between rounded-2xl bg-base-100 p-3 text-sm items-center">
            <span className="font-bold text-base-content/60">당첨 금액</span>
            <span className="text-lg font-black text-warning tabular-nums">
              {formatMoney(currentNotice.winnerPrizeAmount)}
            </span>
          </div>
          <div className="mt-2 flex justify-between rounded-2xl bg-base-100 p-3 text-sm items-center">
            <span className="font-bold text-base-content/60">당첨 확률</span>
            <span className="font-black tabular-nums text-secondary">
              {currentNotice.totalEffectiveEntries > 0 
                ? ((currentNotice.winnerEntryCount / currentNotice.totalEffectiveEntries) * 100).toFixed(2) 
                : 0}% 
              <span className="text-xs font-normal text-base-content/40 ml-1">
                ({currentNotice.winnerEntryCount}장 / {currentNotice.totalEffectiveEntries}장)
              </span>
            </span>
          </div>
        </div>
        
        {currentNotice.isMeWinner && (
          <div className="mt-4 animate-bounce text-center text-lg font-black text-success">
            🥳 와! 잭팟에 당첨되셨어요! 축하합니다! 🥳
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary mt-6 h-12 w-full rounded-2xl"
          disabled={busy}
          onClick={handleClose}
        >
          {busy ? <span className="loading loading-spinner loading-sm" /> : "확인"}
        </button>
      </div>
    </div>
  );
}

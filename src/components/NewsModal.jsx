import { useEffect } from "react";
import { useEnterConfirm } from "../hooks/useEnterConfirm";
import { formatDate } from "../utils/format";
import { MoneyText } from "./ui";

export default function NewsModal({ notifications = [], onClose }) {
  useEnterConfirm(true, onClose);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="news-modal-title">
      <div className="modal-box flex max-h-[86vh] max-w-3xl flex-col rounded-[2rem] p-0 shadow-xl">
        <div className="shrink-0 border-b border-base-300 px-5 py-5 text-center sm:px-6">
          <p className="eyebrow">Lucky news</p>
          <h2 id="news-modal-title" className="mt-1 text-2xl font-black">🌟 전체 행운소식</h2>
          <p className="mt-2 text-sm text-base-content/60">
            최근 행운주머니에서 일어난 주요 이벤트들을 보여줍니다.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-left sm:px-6">
          {notifications.length === 0 ? (
            <p className="rounded-2xl bg-base-200 p-6 text-center text-sm font-bold text-base-content/50">
              아직 행운소식이 없어요.
            </p>
          ) : (
            <div className="space-y-3">
              {notifications.map((item) => (
                <article key={item.id} className="rounded-2xl border border-base-300 bg-base-100 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-xl">
                      {item.type === "jackpot" ? "🎊" : item.type === "achievement" ? "🏅" : item.type === "bankruptcy" ? "🌱" : "📣"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <strong className="block min-w-0 break-words text-sm">
                        {item.title || "행운소식"}
                      </strong>
                      <p className="mt-2 break-words text-sm leading-relaxed text-base-content/65">
                        {item.message || "내용이 없는 소식이에요."}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        {Number(item.amount || 0) !== 0 ? (
                          <strong className={`text-sm font-black tabular-nums ${item.amount > 0 ? "text-success" : "text-error"}`}>
                            <MoneyText value={item.amount} />
                          </strong>
                        ) : (
                          <span />
                        )}
                        <time className="text-xs font-bold text-base-content/40">
                          {item.createdAt || item.created_at ? formatDate(item.createdAt || item.created_at) : ""}
                        </time>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="modal-action mt-0 shrink-0 justify-center border-t border-base-300 px-5 py-4 sm:px-6">
          <button className="btn btn-primary min-h-12 min-w-[120px] rounded-2xl" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
      <button className="modal-backdrop bg-base-300/50 backdrop-blur-sm" type="button" aria-label="닫기" onClick={onClose} />
    </div>
  );
}

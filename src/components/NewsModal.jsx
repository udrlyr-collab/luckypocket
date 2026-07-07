import { useEffect } from "react";
import HistoryList from "./HistoryList";
import { useEnterConfirm } from "../hooks/useEnterConfirm";

export default function NewsModal({ logs, onClose }) {
  useEnterConfirm(true, onClose);

  return (
    <div className="modal modal-open" role="dialog">
      <div className="modal-box max-w-2xl rounded-[2rem] p-6 text-center shadow-xl">
        <h2 className="mb-4 text-2xl font-black">🌟 전체 행운소식</h2>
        <p className="mb-6 text-sm text-base-content/60">
          최근 행운주머니에서 일어난 주요 이벤트들을 보여줍니다.
        </p>
        
        <div className="max-h-[50vh] overflow-y-auto text-left">
          <HistoryList history={logs} />
        </div>

        <div className="modal-action flex justify-center mt-6">
          <button className="btn btn-primary min-w-[120px] rounded-2xl" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
      <div className="modal-backdrop bg-base-300/50 backdrop-blur-sm" onClick={onClose}>
        <button className="cursor-default">close</button>
      </div>
    </div>
  );
}

import { useEffect, useRef } from "react";

export function ConfirmModal({ 
  isOpen, 
  title, 
  message, 
  onConfirm, 
  onCancel, 
  confirmText = "확인", 
  cancelText = "취소", 
  isDanger = false,
  isBusy = false
}) {
  const confirmRef = useRef(null);

  useEffect(() => {
    if (isOpen && !isDanger && confirmRef.current) {
      confirmRef.current.focus();
    }
  }, [isOpen, isDanger]);

  if (!isOpen) return null;

  return (
    <div className="modal modal-open">
      <div className="modal-box rounded-3xl">
        <h3 className="font-black text-xl">{title}</h3>
        <p className="py-4 text-sm text-base-content/70 leading-relaxed whitespace-pre-wrap">
          {message}
        </p>
        <div className="modal-action">
          {onCancel && (
            <button 
              type="button"
              className="btn btn-outline min-h-12 rounded-2xl" 
              onClick={onCancel}
              disabled={isBusy}
            >
              {cancelText}
            </button>
          )}
          <button 
            type="button"
            ref={confirmRef}
            className={`btn min-h-12 rounded-2xl ${isDanger ? 'btn-error' : 'btn-primary'}`} 
            onClick={onConfirm}
            disabled={isBusy}
          >
            {isBusy ? <span className="loading loading-spinner loading-sm" /> : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

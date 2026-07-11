import { useEffect, useRef } from "react";

export default function StockActionErrorDialog({
  open,
  title = "거래를 완료하지 못했어요",
  message,
  onClose,
}) {
  const confirmButtonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      onClose?.();
    };

    document.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => confirmButtonRef.current?.focus());
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="stock-action-error-title">
      <div className="modal-box rounded-3xl">
        <h3 id="stock-action-error-title" className="text-xl font-black">{title}</h3>
        <p className="mt-3 text-sm leading-relaxed text-base-content/70">
          {message || "잠시 후 다시 시도해 주세요."}
        </p>
        <div className="modal-action">
          <button ref={confirmButtonRef} type="button" className="btn btn-primary min-h-12 rounded-2xl" onClick={onClose}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

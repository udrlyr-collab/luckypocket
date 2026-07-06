import { useEffect } from "react";

export function useEnterConfirm(isOpen, onConfirm) {
  useEffect(() => {
    if (!isOpen || typeof onConfirm !== "function") return;

    const handleKeyDown = (e) => {
      if (e.key !== "Enter") return;
      if (e.isComposing) return;

      const tagName = document.activeElement?.tagName?.toLowerCase();
      if (tagName === "input" || tagName === "textarea") return;

      e.preventDefault();
      onConfirm();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onConfirm]);
}

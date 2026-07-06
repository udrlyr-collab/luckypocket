import { useEffect } from "react";

function currentClientAssetVersion() {
  const script = document.querySelector(
    'script[type="module"][src*="/assets/index-"]',
  );
  if (!script?.src) return null;
  try {
    return new URL(script.src, window.location.origin).pathname;
  } catch {
    return null;
  }
}

export function useAppVersionRefresh() {
  useEffect(() => {
    const loadedVersion = currentClientAssetVersion();
    if (!loadedVersion) return undefined;

    let checking = false;
    let disposed = false;
    const checkVersion = async () => {
      if (checking || disposed || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const response = await fetch("/api/version", {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok) return;
        const data = await response.json();
        if (data.version && data.version !== loadedVersion) {
          window.location.reload();
        }
      } catch {
        // A temporary network failure should not interrupt the current screen.
      } finally {
        checking = false;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") checkVersion();
    };
    const handlePageShow = () => checkVersion();
    const interval = window.setInterval(checkVersion, 30_000);

    window.addEventListener("focus", checkVersion);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibility);
    checkVersion();

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", checkVersion);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);
}

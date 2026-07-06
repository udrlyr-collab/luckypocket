const TOKEN_KEY = "lucky-pocket-token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`/api${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && token) {
    setToken(null);
    window.dispatchEvent(new Event("lucky-pocket-auth-expired"));
  }
  if (!response.ok) {
    throw new Error(data.message || "요청을 처리하지 못했어요.");
  }
  return data;
}

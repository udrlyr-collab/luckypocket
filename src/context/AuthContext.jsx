import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, getToken, setToken } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const data = await api("/me");
      setUser(data.user);
      return data.user;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
    const expire = () => setUser(null);
    window.addEventListener("lucky-pocket-auth-expired", expire);
    return () => window.removeEventListener("lucky-pocket-auth-expired", expire);
  }, [refreshUser]);

  const authenticate = useCallback(async (result) => {
    setToken(result.token);
    setUser(result.user);
    setLoading(false);
    const refreshed = await refreshUser();
    if (!refreshed) setUser(result.user);
    return refreshed || result.user;
  }, [refreshUser]);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, authenticate, logout, refreshUser }),
    [user, loading, authenticate, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

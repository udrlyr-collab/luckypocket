import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, getToken, setToken } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [suspension, setSuspension] = useState(null); // { type, until, reason }

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setSuspension(null);
      setLoading(false);
      return null;
    }
    try {
      const data = await api("/me");
      setUser(data.user);
      setSuspension(null);
      return data.user;
    } catch (err) {
      if (err.code === "USER_SUSPENDED_ACCESS") {
        setSuspension({
          type: "access",
          until: err.until,
          reason: err.reason,
        });
      } else {
        setUser(null);
        setSuspension(null);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
    const expire = () => {
      setUser(null);
      setSuspension(null);
    };
    window.addEventListener("lucky-pocket-auth-expired", expire);
    return () => window.removeEventListener("lucky-pocket-auth-expired", expire);
  }, [refreshUser]);

  const authenticate = useCallback(async (result) => {
    setToken(result.token);
    setUser(result.user);
    setSuspension(null);
    setLoading(false);
    const refreshed = await refreshUser();
    if (!refreshed) setUser(result.user);
    return refreshed || result.user;
  }, [refreshUser]);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setSuspension(null);
  }, []);

  const isActionSuspended = useMemo(() => {
    if (!user || !user.suspendedActionUntil) return false;
    return new Date(user.suspendedActionUntil) > new Date();
  }, [user]);

  const value = useMemo(
    () => ({ user, loading, suspension, isActionSuspended, authenticate, logout, refreshUser }),
    [user, loading, suspension, isActionSuspended, authenticate, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

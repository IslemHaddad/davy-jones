import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, setAuthToken } from "../lib/api";
import type { SealStatus } from "../types";

const TOKEN_STORAGE_KEY = "dcc_session_token";

type AuthPhase =
  | "loading"
  | "needs-init" // seal never initialized -- first ever launch
  | "sealed" // initialized but master key not in memory
  | "needs-setup" // unsealed, but no admin account yet
  | "locked" // unsealed, admin exists, no valid session
  | "ready"; // unsealed AND logged in

interface AuthContextValue {
  phase: AuthPhase;
  error: string | null;
  sealStatus: SealStatus | null;
  freshShares: string[] | null;
  initializeSeal: () => Promise<void>;
  submitShare: (share: string) => Promise<void>;
  setup: (password: string) => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [sealStatus, setSealStatus] = useState<SealStatus | null>(null);
  const [freshShares, setFreshShares] = useState<string[] | null>(null);

  const evaluate = useCallback(async () => {
    try {
      const status = await api.seal.status();
      setSealStatus(status);

      if (!status.initialized) {
        setPhase("needs-init");
        return;
      }
      if (status.sealed) {
        setPhase("sealed");
        return;
      }

      const { isSetup } = await api.auth.status();
      if (!isSetup) {
        setPhase("needs-setup");
        return;
      }

      const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (stored) {
        const { valid } = await api.auth.validate(stored);
        if (valid) {
          setAuthToken(stored);
          setPhase("ready");
          return;
        }
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
      setPhase("locked");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  const initializeSeal = useCallback(async () => {
    setError(null);
    try {
      const { shares } = await api.seal.initialize();
      setFreshShares(shares);
      await evaluate();
    } catch (e) {
      setError(String(e));
    }
  }, [evaluate]);

  const submitShare = useCallback(
    async (share: string) => {
      setError(null);
      try {
        const result = await api.seal.unseal(share);
        setSealStatus(result);
        if (result.unsealed) {
          setFreshShares(null);
          await evaluate();
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [evaluate],
  );

  const setup = useCallback(async (password: string) => {
    setError(null);
    try {
      await api.auth.setup(password);
      const { token } = await api.auth.login(password);
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
      setAuthToken(token);
      setPhase("ready");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const login = useCallback(async (password: string) => {
    setError(null);
    try {
      const { token } = await api.auth.login(password);
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
      setAuthToken(token);
      setPhase("ready");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const logout = useCallback(async () => {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) {
      try {
        await api.auth.logout(stored);
      } catch {
        // best-effort; still clear local state
      }
    }
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setAuthToken(null);
    setPhase("locked");
  }, []);

  return (
    <AuthContext.Provider
      value={{
        phase,
        error,
        sealStatus,
        freshShares,
        initializeSeal,
        submitShare,
        setup,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  clearAuthToken,
  getAuthToken,
  getCsrfToken,
  setAuthToken,
  AUTH_EVENT,
} from '../lib/session';

type AuthUser = {
  id: string;
  email: string;
  full_name?: string | null;
};

type LoginInput = {
  email: string;
  password: string;
};

type RegisterInput = {
  email: string;
  password: string;
  fullName?: string;
  companyName: string;
  companyMission?: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchAuth(path: string, options?: RequestInit) {
  const token = getAuthToken();
  const csrfToken = getCsrfToken();
  const method = options?.method?.toUpperCase() ?? 'GET';
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(token && csrfToken && method !== 'GET' && method !== 'HEAD'
        ? { 'x-csrf-token': csrfToken }
        : {}),
      ...options?.headers,
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || 'Authentication request failed') as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isHydratingRef = useRef(false);

  const hydrateSession = async (isBackground = false) => {
    if (isHydratingRef.current) return;
    
    const token = getAuthToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    isHydratingRef.current = true;
    if (!isBackground) setLoading(true);

    try {
      const data = await fetchAuth('/auth/me');
      setAuthToken(token, data.csrfToken);
      setUser(data.user);
      setError(null);
    } catch (err: any) {
      if (err.status === 401) {
        clearAuthToken();
        setUser(null);
      }
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
    } finally {
      setLoading(false);
      isHydratingRef.current = false;
    }
  };

  useEffect(() => {
    void hydrateSession();

    const handleAuthChange = () => {
      // Background refresh to sync state across tabs without showing full-page loader
      void hydrateSession(true);
    };

    window.addEventListener(AUTH_EVENT, handleAuthChange);
    return () => window.removeEventListener(AUTH_EVENT, handleAuthChange);
  }, []);

  const login = async (input: LoginInput) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAuth('/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setAuthToken(data.token, data.csrfToken);
      setUser(data.user);
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const register = async (input: RegisterInput) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAuth('/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setAuthToken(data.token, data.csrfToken);
      setUser(data.user);
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      if (getAuthToken()) {
        await fetchAuth('/auth/logout', { method: 'POST' });
      }
    } catch {
      // Best-effort logout; local session still needs to be cleared.
    } finally {
      clearAuthToken();
      setUser(null);
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        isAuthenticated: !!user,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

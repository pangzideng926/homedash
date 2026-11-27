import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ApiError,
  fetchCurrentUser,
  loginRequest,
  logoutRequest,
  setUnauthorizedHandler,
} from '@/lib/api';
import { AuthContext, isSessionExpired, type AuthStatus } from '@/shell/auth-context';

const MAX_TIMEOUT_MS = 2_147_483_647;

export interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [username, setUsername] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState<boolean>(false);

  const markUnauthenticated = useCallback((expired: boolean) => {
    setUsername(null);
    setExpiresAt(null);
    setStatus('unauthenticated');
    setSessionExpired(expired);
  }, []);

  const applyUserResult = useCallback(
    (user: Awaited<ReturnType<typeof fetchCurrentUser>>) => {
      if (!user) {
        markUnauthenticated(false);
        return;
      }

      if (isSessionExpired(user.expiresAt)) {
        markUnauthenticated(true);
        return;
      }

      setUsername(user.username);
      setExpiresAt(user.expiresAt ?? null);
      setStatus('authenticated');
      setSessionExpired(false);
    },
    [markUnauthenticated],
  );

  const refreshAuth = useCallback(async () => {
    try {
      const user = await fetchCurrentUser();
      applyUserResult(user);
    } catch {
      markUnauthenticated(false);
    }
  }, [applyUserResult, markUnauthenticated]);

  useEffect(() => {
    let cancelled = false;

    void fetchCurrentUser()
      .then((user) => {
        if (cancelled) return;
        applyUserResult(user);
      })
      .catch(() => {
        if (cancelled) return;
        markUnauthenticated(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyUserResult, markUnauthenticated]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      markUnauthenticated(true);
    });

    return () => {
      setUnauthorizedHandler(null);
    };
  }, [markUnauthenticated]);

  useEffect(() => {
    if (status !== 'authenticated' || !expiresAt) {
      return;
    }

    const expiryTimestamp = Date.parse(expiresAt);
    if (Number.isNaN(expiryTimestamp)) {
      return;
    }

    let timerId: number | undefined;

    const scheduleCheck = () => {
      const remaining = expiryTimestamp - Date.now();
      if (remaining <= 0) {
        markUnauthenticated(true);
        return;
      }

      const delay = Math.min(remaining, MAX_TIMEOUT_MS);
      timerId = window.setTimeout(() => {
        if (Date.now() >= expiryTimestamp) {
          markUnauthenticated(true);
        } else {
          scheduleCheck();
        }
      }, delay);
    };

    scheduleCheck();

    return () => {
      if (timerId !== undefined) {
        window.clearTimeout(timerId);
      }
    };
  }, [status, expiresAt, markUnauthenticated]);

  const signIn = useCallback(
    async (inputUsername: string, password: string) => {
      await loginRequest(inputUsername, password);
      const user = await fetchCurrentUser();
      if (user && isSessionExpired(user.expiresAt)) {
        markUnauthenticated(true);
        throw new ApiError('登录已过期，请重新登录', 401);
      }
      setUsername(user?.username ?? inputUsername);
      setExpiresAt(user?.expiresAt ?? null);
      setStatus('authenticated');
      setSessionExpired(false);
    },
    [markUnauthenticated],
  );

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      markUnauthenticated(false);
    }
  }, [markUnauthenticated]);

  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false);
  }, []);

  const value = useMemo(
    () => ({
      status,
      username,
      expiresAt,
      sessionExpired,
      signIn,
      signOut,
      refreshAuth,
      clearSessionExpired,
    }),
    [
      status,
      username,
      expiresAt,
      sessionExpired,
      signIn,
      signOut,
      refreshAuth,
      clearSessionExpired,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

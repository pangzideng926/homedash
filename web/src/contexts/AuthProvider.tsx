import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthContext, type AuthStatus } from '@/contexts/auth-context';
import { fetchCurrentUser, loginRequest, logoutRequest } from '@/lib/api';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [username, setUsername] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    try {
      const user = await fetchCurrentUser();
      if (user) {
        setUsername(user.username);
        setStatus('authenticated');
      } else {
        setUsername(null);
        setStatus('unauthenticated');
      }
    } catch {
      setUsername(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetchCurrentUser()
      .then((user) => {
        if (cancelled) return;
        if (user) {
          setUsername(user.username);
          setStatus('authenticated');
        } else {
          setUsername(null);
          setStatus('unauthenticated');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setUsername(null);
        setStatus('unauthenticated');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (inputUsername: string, password: string) => {
    await loginRequest(inputUsername, password);
    const user = await fetchCurrentUser();
    setUsername(user?.username ?? inputUsername);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      setUsername(null);
      setStatus('unauthenticated');
    }
  }, []);

  const value = useMemo(
    () => ({
      status,
      username,
      signIn,
      signOut,
      refreshAuth,
    }),
    [status, username, signIn, signOut, refreshAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

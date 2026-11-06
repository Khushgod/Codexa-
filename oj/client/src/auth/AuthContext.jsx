import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  login as loginRequest,
  logout as logoutRequest,
  refreshSession,
  signup as signupRequest,
  subscribeSession,
} from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [startupError, setStartupError] = useState('');

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeSession((nextSession) => {
      if (active) setSession(nextSession);
    });

    refreshSession()
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          setSession(null);
          return;
        }
        setStartupError(error.message || 'Could not restore your session.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const login = useCallback((input) => loginRequest(input), []);
  const signup = useCallback((input) => signupRequest(input), []);
  const logout = useCallback(() => logoutRequest(), []);

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      isLoading,
      startupError,
      login,
      signup,
      logout,
    }),
    [session, isLoading, startupError, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}

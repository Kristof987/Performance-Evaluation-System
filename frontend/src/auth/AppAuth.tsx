import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { fetchAuthMe, type AuthMe } from '../pages/login/auth-me';
import type { AccessTokenGetter } from './authenticated-api';

type LinkedUser = AuthMe & { employee: NonNullable<AuthMe['employee']> };

/** Auth0 is the only sign-in method; there is no other identity mode. */
export type AppAuthState =
  | { status: 'loading'; mode: 'auth0' }
  | { status: 'unauthenticated'; mode: 'auth0' }
  | { status: 'unlinked'; mode: 'auth0' }
  | { status: 'error'; mode: 'auth0'; reason: 'forbidden' | 'network' | 'sdk' }
  | { status: 'authenticated'; mode: 'auth0'; user: LinkedUser };

type AppAuthContextValue = {
  state: AppAuthState;
  signOut: () => void;
  retryAuth0: () => void;
  getAccessToken: AccessTokenGetter;
};

const AppAuthContext = createContext<AppAuthContextValue | null>(null);

export function useAppAuth(): AppAuthContextValue {
  const context = useContext(AppAuthContext);
  if (!context) throw new Error('AppAuthProvider is required');
  return context;
}

const noAuth0: AccessTokenGetter = async () => {
  throw new Error('Auth0 sign-in is not configured.');
};

/** Without Auth0 settings nobody can sign in; the login page explains what is missing. */
export function UnconfiguredAppAuthProvider({ children }: { children: ReactNode }) {
  return <AppAuthContext.Provider value={{
    state: { status: 'unauthenticated', mode: 'auth0' },
    signOut: () => undefined,
    retryAuth0: () => undefined,
    getAccessToken: noAuth0,
  }}>{children}</AppAuthContext.Provider>;
}

export function Auth0AppAuthProvider({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, error, user, getAccessTokenSilently, logout } = useAuth0();
  const [resolution, setResolution] = useState<{
    subject: string | undefined;
    result: AppAuthState;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const getAuth0AccessToken = useCallback(async () => {
    const token = await getAccessTokenSilently();
    if (!token) throw new Error('An Auth0 access token could not be acquired.');
    return token;
  }, [getAccessTokenSilently]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const recheck = () => {
      // Keep the linked identity mounted while a focus-triggered refresh runs.
      // A failed recheck still replaces it with an error in the fetch effect.
      setAttempt((current) => current + 1);
    };
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const controller = new AbortController();
    let active = true;
    fetchAuthMe(getAuth0AccessToken, controller.signal)
      .then((result) => {
        if (!active) return;
        let next: AppAuthState;
        if (result.status === 'unlinked') next = { status: 'unlinked', mode: 'auth0' };
        else if (result.status === 'forbidden') next = { status: 'error', mode: 'auth0', reason: 'forbidden' };
        else if (result.status === 'linked' && result.user.is_active && result.user.employee?.is_active
          && result.user.system_role_name && Array.isArray(result.user.permissions)) {
          next = { status: 'authenticated', mode: 'auth0', user: { ...result.user, employee: result.user.employee } };
        } else next = { status: 'error', mode: 'auth0', reason: 'forbidden' };
        setResolution({ subject: user?.sub, result: next });
      })
      .catch(() => {
        if (active) setResolution({ subject: user?.sub, result: { status: 'error', mode: 'auth0', reason: 'network' } });
      });
    return () => { active = false; controller.abort(); };
  }, [isAuthenticated, user?.sub, getAuth0AccessToken, attempt]);

  let state: AppAuthState;
  if (isAuthenticated) state = resolution?.subject === user?.sub && resolution
    ? resolution.result : { status: 'loading', mode: 'auth0' };
  else if (isLoading) state = { status: 'loading', mode: 'auth0' };
  else if (error) state = { status: 'error', mode: 'auth0', reason: 'sdk' };
  else state = { status: 'unauthenticated', mode: 'auth0' };

  function signOut() {
    setResolution(null);
    sessionStorage.removeItem('auth0ReturnTo');
    if (isAuthenticated) void logout({ logoutParams: { returnTo: window.location.origin } });
  }

  function retryAuth0() {
    setResolution(null);
    setAttempt((current) => current + 1);
  }

  return <AppAuthContext.Provider value={{ state, signOut, retryAuth0, getAccessToken: getAuth0AccessToken }}>{children}</AppAuthContext.Provider>;
}

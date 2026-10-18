import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { fetchAuthMe, type AuthMe } from '../pages/login/auth-me';
import { getSidebarUser, type SidebarUser } from '../pages/layout/sidebar-user';
import type { AccessTokenGetter } from './authenticated-api';

type LinkedUser = AuthMe & { employee: NonNullable<AuthMe['employee']> };

export type AppAuthState =
  | { status: 'loading'; mode: 'auth0' }
  | { status: 'unauthenticated'; mode: 'auth0' | 'development' }
  | { status: 'unlinked'; mode: 'auth0' }
  | { status: 'error'; mode: 'auth0'; reason: 'forbidden' | 'network' | 'sdk' }
  | { status: 'authenticated'; mode: 'auth0'; user: LinkedUser }
  | { status: 'authenticated'; mode: 'development'; user: SidebarUser };

type AppAuthContextValue = {
  state: AppAuthState;
  selectDevelopmentUser: (user: SidebarUser) => boolean;
  clearDevelopmentUser: () => void;
  signOut: () => void;
  retryAuth0: () => void;
  getAccessToken?: AccessTokenGetter;
};

const AppAuthContext = createContext<AppAuthContextValue | null>(null);

export function useAppAuth(): AppAuthContextValue {
  const context = useContext(AppAuthContext);
  if (!context) throw new Error('AppAuthProvider is required');
  return context;
}

function useDevelopmentIdentity() {
  const [developmentUser, setDevelopmentUser] = useState<SidebarUser | null>(
    () => import.meta.env.DEV ? getSidebarUser() : null,
  );
  function clearDevelopmentUser() {
    sessionStorage.removeItem('loggedInUser');
    setDevelopmentUser(null);
  }
  return { developmentUser, setDevelopmentUser, clearDevelopmentUser };
}

export function DevelopmentAppAuthProvider({ children }: { children: ReactNode }) {
  const { developmentUser, setDevelopmentUser, clearDevelopmentUser } = useDevelopmentIdentity();
  const state: AppAuthState = developmentUser
    ? { status: 'authenticated', mode: 'development', user: developmentUser }
    : { status: 'unauthenticated', mode: 'development' };

  return <AppAuthContext.Provider value={{
    state,
    selectDevelopmentUser: (user) => {
      if (!import.meta.env.DEV) return false;
      sessionStorage.setItem('loggedInUser', JSON.stringify(user));
      setDevelopmentUser(user);
      return true;
    },
    clearDevelopmentUser,
    signOut: clearDevelopmentUser,
    retryAuth0: () => {},
  }}>{children}</AppAuthContext.Provider>;
}

export function Auth0AppAuthProvider({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, error, user, getAccessTokenSilently, logout } = useAuth0();
  const { developmentUser, setDevelopmentUser, clearDevelopmentUser } = useDevelopmentIdentity();
  const [resolution, setResolution] = useState<{
    subject: string | undefined;
    result: AppAuthState;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    const recheck = () => {
      setResolution(null);
      setAttempt((current) => current + 1);
    };
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    clearDevelopmentUser();
    const controller = new AbortController();
    let active = true;
    fetchAuthMe(getAccessTokenSilently, controller.signal)
      .then((result) => {
        if (!active) return;
        let next: AppAuthState;
        if (result.status === 'unlinked') next = { status: 'unlinked', mode: 'auth0' };
        else if (result.status === 'forbidden') next = { status: 'error', mode: 'auth0', reason: 'forbidden' };
        else if (result.user.is_active && result.user.employee?.is_active
          && result.user.system_role_name && Array.isArray(result.user.permissions)) {
          next = { status: 'authenticated', mode: 'auth0', user: { ...result.user, employee: result.user.employee } };
        } else next = { status: 'error', mode: 'auth0', reason: 'forbidden' };
        setResolution({ subject: user?.sub, result: next });
      })
      .catch(() => {
        if (active) setResolution({ subject: user?.sub, result: { status: 'error', mode: 'auth0', reason: 'network' } });
      });
    return () => { active = false; controller.abort(); };
  }, [isAuthenticated, user?.sub, getAccessTokenSilently, attempt]);

  let state: AppAuthState;
  if (isLoading) state = { status: 'loading', mode: 'auth0' };
  else if (error) state = { status: 'error', mode: 'auth0', reason: 'sdk' };
  else if (isAuthenticated) state = resolution?.subject === user?.sub && resolution
    ? resolution.result : { status: 'loading', mode: 'auth0' };
  else state = developmentUser && import.meta.env.DEV
    ? { status: 'authenticated', mode: 'development', user: developmentUser }
    : { status: 'unauthenticated', mode: 'auth0' };

  function signOut() {
    clearDevelopmentUser();
    setResolution(null);
    sessionStorage.removeItem('auth0ReturnTo');
    if (isAuthenticated) void logout({ logoutParams: { returnTo: window.location.origin } });
  }

  function retryAuth0() {
    setResolution(null);
    setAttempt((current) => current + 1);
  }

  return <AppAuthContext.Provider value={{
    state,
    selectDevelopmentUser: (selected) => {
      if (!import.meta.env.DEV || isAuthenticated || isLoading || error) return false;
      sessionStorage.setItem('loggedInUser', JSON.stringify(selected));
      setDevelopmentUser(selected);
      return true;
    },
    clearDevelopmentUser,
    signOut,
    retryAuth0,
    getAccessToken: getAccessTokenSilently,
  }}>{children}</AppAuthContext.Provider>;
}

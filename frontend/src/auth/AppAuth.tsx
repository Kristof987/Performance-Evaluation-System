import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { fetchAuthMe, type AuthMe } from '../pages/login/auth-me';
import type { SidebarUser } from '../pages/layout/sidebar-user';
import type { AccessTokenGetter } from './authenticated-api';

type LinkedUser = AuthMe & { employee: NonNullable<AuthMe['employee']> };
type DevelopmentLogin = SidebarUser & { access_token: string };

export type AppAuthState =
  | { status: 'loading'; mode: 'auth0' | 'development' }
  | { status: 'unauthenticated'; mode: 'auth0' | 'development' }
  | { status: 'unlinked'; mode: 'auth0' }
  | { status: 'error'; mode: 'auth0'; reason: 'forbidden' | 'network' | 'sdk' }
  | { status: 'authenticated'; mode: 'auth0'; user: LinkedUser }
  | { status: 'authenticated'; mode: 'development'; user: LinkedUser };

type AppAuthContextValue = {
  state: AppAuthState;
  selectDevelopmentUser: (user: DevelopmentLogin) => Promise<boolean>;
  clearDevelopmentUser: () => void;
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

function useDevelopmentIdentity() {
  const [token, setToken] = useState<string | null>(() => import.meta.env.DEV ? sessionStorage.getItem('developmentAccessToken') : null);
  const [resolution, setResolution] = useState<{ token: string; user: LinkedUser } | null>(null);
  function clearDevelopmentUser() {
    sessionStorage.removeItem('loggedInUser');
    sessionStorage.removeItem('developmentAccessToken');
    setToken(null);
    setResolution(null);
  }
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    fetchAuthMe(() => Promise.resolve(token), controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.status === 'linked' && result.user.is_active && result.user.employee?.is_active) {
          setResolution({ token, user: result.user as LinkedUser });
        } else clearDevelopmentUser();
      })
      .catch(() => { if (!controller.signal.aborted) clearDevelopmentUser(); });
    return () => controller.abort();
  }, [token]);
  async function selectDevelopmentUser(user: DevelopmentLogin): Promise<boolean> {
    if (!import.meta.env.DEV || typeof user.access_token !== 'string') return false;
    const result = await fetchAuthMe(() => Promise.resolve(user.access_token));
    if (result.status !== 'linked' || !result.user.is_active || !result.user.employee?.is_active) {
      throw new Error('An active employee account is required for development access.');
    }
    const { access_token: accessToken, ...displayUser } = user;
    sessionStorage.setItem('loggedInUser', JSON.stringify(displayUser));
    sessionStorage.setItem('developmentAccessToken', accessToken);
    setResolution({ token: accessToken, user: result.user as LinkedUser });
    setToken(accessToken);
    return true;
  }
  return { token, developmentUser: resolution?.token === token ? resolution.user : null,
           selectDevelopmentUser, clearDevelopmentUser };
}

const getDevelopmentAccessToken: AccessTokenGetter = async () => {
  const token = sessionStorage.getItem('developmentAccessToken');
  if (!token) throw new Error('Development session is unavailable');
  return token;
};

export function DevelopmentAppAuthProvider({ children }: { children: ReactNode }) {
  const { token, developmentUser, selectDevelopmentUser, clearDevelopmentUser } = useDevelopmentIdentity();
  const state: AppAuthState = developmentUser
    ? { status: 'authenticated', mode: 'development', user: developmentUser }
    : token ? { status: 'loading', mode: 'development' } : { status: 'unauthenticated', mode: 'development' };

  return <AppAuthContext.Provider value={{
    state,
    selectDevelopmentUser,
    clearDevelopmentUser,
    signOut: clearDevelopmentUser,
    retryAuth0: clearDevelopmentUser,
    getAccessToken: getDevelopmentAccessToken,
  }}>{children}</AppAuthContext.Provider>;
}

export function Auth0AppAuthProvider({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, error, user, getAccessTokenSilently, logout } = useAuth0();
  const { token, developmentUser, selectDevelopmentUser, clearDevelopmentUser } = useDevelopmentIdentity();
  const [resolution, setResolution] = useState<{
    subject: string | undefined;
    result: AppAuthState;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

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
  if (isAuthenticated) state = resolution?.subject === user?.sub && resolution
    ? resolution.result : { status: 'loading', mode: 'auth0' };
  else if (developmentUser && import.meta.env.DEV) state = { status: 'authenticated', mode: 'development', user: developmentUser };
  else if (token && import.meta.env.DEV) state = { status: 'loading', mode: 'development' };
  else if (isLoading) state = { status: 'loading', mode: 'auth0' };
  else if (error) state = { status: 'error', mode: 'auth0', reason: 'sdk' };
  else state = { status: 'unauthenticated', mode: 'auth0' };

  function signOut() {
    clearDevelopmentUser();
    setResolution(null);
    sessionStorage.removeItem('auth0ReturnTo');
    if (isAuthenticated) void logout({ logoutParams: { returnTo: window.location.origin } });
  }

  function retryAuth0() {
    if (state.mode === 'development') {
      clearDevelopmentUser();
      return;
    }
    setResolution(null);
    setAttempt((current) => current + 1);
  }

  return <AppAuthContext.Provider value={{
    state,
    selectDevelopmentUser: async (selected) => {
      if (!import.meta.env.DEV || isAuthenticated) return false;
      return selectDevelopmentUser(selected);
    },
    clearDevelopmentUser,
    signOut,
    retryAuth0,
    getAccessToken: state.mode === 'development' ? getDevelopmentAccessToken : getAccessTokenSilently,
  }}>{children}</AppAuthContext.Provider>;
}

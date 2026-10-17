import { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { fetchAuthMe, type AuthMe } from './auth-me';

type AccountState =
  | { status: 'checking' }
  | { status: 'linked'; user: AuthMe }
  | { status: 'unlinked' | 'forbidden' | 'error' };

export default function Auth0SignIn() {
  const { isAuthenticated, isLoading, error, loginWithRedirect, logout, getAccessTokenSilently } = useAuth0();
  const [account, setAccount] = useState<AccountState>({ status: 'checking' });
  const [loginError, setLoginError] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    const controller = new AbortController();
    let active = true;
    fetchAuthMe(getAccessTokenSilently, controller.signal)
      .then((result) => {
        if (active) setAccount(result);
      })
      .catch(() => {
        if (active) setAccount({ status: 'error' });
      });
    return () => { active = false; controller.abort(); };
  }, [isAuthenticated, getAccessTokenSilently]);

  async function signIn() {
    setLoginError(false);
    sessionStorage.removeItem('loggedInUser');
    try {
      await loginWithRedirect();
    } catch {
      setLoginError(true);
    }
  }

  return (
    <div className="login-auth0">
      <h2>Sign in with Auth0</h2>
      <p>Use your organization account. Access to PerfEval requires a linked account.</p>
      {isLoading ? <p role="status">Checking Auth0 session...</p> : isAuthenticated ? (
        <>
          {account.status === 'checking' && <p role="status">Checking your PerfEval account...</p>}
          {account.status === 'linked' && (
            <p role="status">Signed in as {account.user.username}. Your PerfEval account is linked. Business pages still use the development login during this transition.</p>
          )}
          {account.status === 'unlinked' && (
            <p className="login-error" role="alert">This Auth0 account is not linked to an active PerfEval account. Contact an administrator to link your account.</p>
          )}
          {account.status === 'forbidden' && (
            <p className="login-error" role="alert">This account cannot access the requested PerfEval profile. Contact an administrator.</p>
          )}
          {account.status === 'error' && (
            <p className="login-error" role="alert">Could not verify your PerfEval account. Please try again later.</p>
          )}
          <button className="btn login-auth0-action" type="button" onClick={() => { void logout({ logoutParams: { returnTo: window.location.origin } }); }}>
            Log out of Auth0
          </button>
        </>
      ) : (
        <>
          {(error || loginError) && <p className="login-error" role="alert">Auth0 sign-in failed. Please try again.</p>}
          <button className="btn btn-primary login-auth0-action" type="button" onClick={() => { void signIn(); }}>
            Continue with Auth0
          </button>
        </>
      )}
    </div>
  );
}

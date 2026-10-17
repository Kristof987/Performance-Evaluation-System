import { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useLocation } from 'react-router';
import { useAppAuth } from '../../auth/AppAuth';

export default function Auth0SignIn() {
  const { error, loginWithRedirect } = useAuth0();
  const { state, clearDevelopmentUser, signOut, retryAuth0 } = useAppAuth();
  const location = useLocation();
  const [loginError, setLoginError] = useState(false);

  async function signIn() {
    setLoginError(false);
    clearDevelopmentUser();
    const from = (location.state as { from?: unknown } | null)?.from;
    if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/\\')) {
      sessionStorage.setItem('auth0ReturnTo', from);
    }
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
      {state.status === 'loading' ? <p role="status">Checking your PerfEval account...</p> :
        state.status === 'unlinked' ? (
          <>
            <p className="login-error" role="alert">This Auth0 account is not linked to an active PerfEval account, or its session was rejected. Contact an administrator if you need account linking.</p>
            <button className="btn login-auth0-action" type="button" onClick={signOut}>Log out of Auth0</button>
          </>
        ) : state.status === 'error' && state.mode === 'auth0' ? (
          <>
            <p className="login-error" role="alert">{state.reason === 'forbidden'
              ? 'Your PerfEval employee profile is unavailable or inactive. Contact an administrator.'
              : state.reason === 'network' ? 'Could not verify your PerfEval account. Your session may have expired, or the service may be unavailable.'
                : 'Auth0 sign-in failed. Please try again.'}</p>
            {state.reason === 'network' && <button className="btn btn-primary login-auth0-action" type="button" onClick={retryAuth0}>Retry account check</button>}
            {state.reason === 'sdk' && <button className="btn btn-primary login-auth0-action" type="button" onClick={() => { void signIn(); }}>Retry Auth0 sign-in</button>}
            <button className="btn login-auth0-action" type="button" onClick={signOut}>Log out of Auth0</button>
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

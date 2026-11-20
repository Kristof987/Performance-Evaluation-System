import { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useLocation } from 'react-router';
import { useAppAuth } from '../../auth/AppAuth';
import { safeReturnPath } from '../../auth/return-path';
import InlineMessage from '../../components/feedback/InlineMessage';
import LoadingState from '../../components/feedback/LoadingState';

export default function Auth0SignIn() {
  const { error, loginWithRedirect } = useAuth0();
  const { state, signOut, retryAuth0 } = useAppAuth();
  const location = useLocation();
  const [loginError, setLoginError] = useState(false);

  async function signIn() {
    setLoginError(false);
    const from = safeReturnPath((location.state as { from?: unknown } | null)?.from);
    if (from) sessionStorage.setItem('auth0ReturnTo', from);
    try {
      await loginWithRedirect();
    } catch {
      setLoginError(true);
    }
  }

  return (
    <div className="login-auth0">
      <h2>Sign in with Auth0</h2>
      <p>Use your organization account. Access to Mirra requires a linked account.</p>
      {state.status === 'loading' ? <LoadingState variant="section" label="Checking your account" /> :
        state.status === 'unlinked' ? (
          <>
            <InlineMessage tone="error">This Auth0 account is not linked to an active Mirra account, or its session was rejected. Contact an administrator if you need account linking.</InlineMessage>
            <button className="btn login-auth0-action" type="button" onClick={signOut}>Log out of Auth0</button>
          </>
        ) : state.status === 'error' && state.mode === 'auth0' ? (
          <>
            <InlineMessage tone="error">{state.reason === 'forbidden'
              ? 'Your Mirra employee profile is unavailable or inactive. Contact an administrator.'
              : state.reason === 'network' ? 'Could not verify your Mirra account. Your session may have expired, or the service may be unavailable.'
                : 'Auth0 sign-in failed. Please try again.'}</InlineMessage>
            {state.reason === 'network' && <button className="btn btn-primary login-auth0-action" type="button" onClick={retryAuth0}>Retry account check</button>}
            {state.reason === 'sdk' && <button className="btn btn-primary login-auth0-action" type="button" onClick={() => { void signIn(); }}>Retry Auth0 sign-in</button>}
            <button className="btn login-auth0-action" type="button" onClick={signOut}>Log out of Auth0</button>
          </>
        ) : (
          <>
            {(error || loginError) && <InlineMessage tone="error">Auth0 sign-in failed. Please try again.</InlineMessage>}
            <button className="btn btn-primary login-auth0-action" type="button" onClick={() => { void signIn(); }}>
              Continue with Auth0
            </button>
          </>
        )}
    </div>
  );
}

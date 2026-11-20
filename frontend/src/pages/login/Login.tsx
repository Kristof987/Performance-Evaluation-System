import { useEffect, useRef, useState, type ReactNode, type SubmitEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { MirraWordmark } from '../../components/brand/MirraLogo';
import { getAuthenticatedDashboardPath, isHrOrManagerRole } from '../layout/sidebar-user';
import { API_BASE_URL, AUTH0_CONFIGURED } from '../../config';
import Auth0SignIn from './Auth0SignIn';
import { safeReturnPath } from '../../auth/return-path';
import { useAppAuth } from '../../auth/AppAuth';
import './Login.css';
import InlineMessage from '../../components/feedback/InlineMessage';
import Pending from '../../components/feedback/Pending';
import LoadingState from '../../components/feedback/LoadingState';

function LoginWithAuth0() {
  const { state } = useAppAuth();
  return <LoginContent showDevelopmentLogin={import.meta.env.DEV && (
    state.status === 'unauthenticated' || state.status === 'error' || state.mode === 'development'
  )} auth0Content={<Auth0SignIn />} />;
}

function Login() {
  const { state } = useAppAuth();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (state.status !== 'authenticated') return;
    const saved = safeReturnPath(state.mode === 'auth0'
      ? sessionStorage.getItem('auth0ReturnTo') : (location.state as { from?: unknown } | null)?.from);
    sessionStorage.removeItem('auth0ReturnTo');
    const dashboard = getAuthenticatedDashboardPath(state.user.permissions);
    const target = saved && saved !== '/' ? saved : dashboard;
    navigate(target, { replace: true });
  }, [state, navigate, location.state]);
  if (state.status === 'authenticated') return <LoadingState variant="screen" label="Opening your dashboard" />;
  return AUTH0_CONFIGURED
    ? <LoginWithAuth0 />
    : <LoginContent showDevelopmentLogin={import.meta.env.DEV} auth0Content={
        import.meta.env.DEV
          ? <p className="login-support">Auth0 is not configured. Use development identity selection below.</p>
          : <InlineMessage tone="error">Auth0 sign-in is unavailable. Set the VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID and VITE_AUTH0_AUDIENCE environment variables.</InlineMessage>
      } />;
}

function LoginContent({ showDevelopmentLogin, auth0Content }: { showDevelopmentLogin: boolean; auth0Content: ReactNode }) {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const pending = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { selectDevelopmentUser } = useAppAuth();

  async function submitHandler(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!showDevelopmentLogin || pending.current || !name.trim()) return;
    pending.current = true;
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const response = await fetch(`${API_BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
        setErrorMessage(typeof detail === 'string' ? detail : 'Sign in failed. Please try again.');
        return;
      }

      const loggedInUser = await response.json();
      if (!await selectDevelopmentUser(loggedInUser)) return;
      const from = safeReturnPath((location.state as { from?: unknown } | null)?.from);
      const landing = isHrOrManagerRole(loggedInUser.role_name ?? null) ? '/hr-home' : '/employee-home';
      navigate(from ?? landing, { replace: true });
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : 'Could not connect to Mirra. Please try again.');
    } finally {
      pending.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-label="Sign in">
        <div className="login-content">
          <h1>Welcome back</h1>
          <p className="login-intro">Sign in to your Mirra workspace.</p>

          {auth0Content}

          {showDevelopmentLogin && <>
          <div className="login-divider">Development identity selection</div>
          <form className="login-form" onSubmit={submitHandler} aria-busy={isSubmitting}>
            <div className="form-field">
              <label className="form-label" htmlFor="name">Your name</label>
              <input
                className="form-control"
                id="name"
                name="name"
                type="text"
                value={name}
                required
                autoComplete="username"
                placeholder="Enter your full name or username"
                disabled={isSubmitting}
                aria-invalid={errorMessage ? true : undefined}
                aria-describedby={errorMessage ? 'login-error' : undefined}
                onChange={(event) => { setName(event.target.value); setErrorMessage(''); }}
              />
            </div>
            {errorMessage && <InlineMessage tone="error" id="login-error">{errorMessage}</InlineMessage>}

            <button className="btn btn-primary login-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Pending label="Selecting identity" /> : 'Select development identity'}
            </button>
          </form>

          <p className="login-support">This identity switcher is for local development, not production authentication.</p>
          </>}
        </div>
      </section>

      <section className="login-visual" aria-label="About Mirra">
        <div className="login-visual-copy">
          <div className="login-brand">
            <MirraWordmark height={40} />
          </div>
          <h2>Better feedback.<br />Stronger teams.</h2>
          <p>Bring performance reviews, team feedback, and growth conversations into one clear workspace.</p>
        </div>
      </section>
    </main>
  );
}

export default Login;

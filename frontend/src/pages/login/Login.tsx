import { useEffect, useRef, useState, type ReactNode, type SubmitEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Compass } from 'lucide-react';
import { getSystemDashboardPath, isHrOrManagerRole } from '../layout/sidebar-user';
import { API_BASE_URL, AUTH0_CONFIGURED } from '../../config';
import Auth0SignIn from './Auth0SignIn';
import { useAppAuth } from '../../auth/AppAuth';
import './Login.css';

function LoginWithAuth0() {
  const { state } = useAppAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (state.status !== 'authenticated' || state.mode !== 'auth0') return;
    const saved = sessionStorage.getItem('auth0ReturnTo');
    sessionStorage.removeItem('auth0ReturnTo');
    const dashboard = getSystemDashboardPath(state.user.system_role_name);
    const target = saved?.startsWith('/') && !saved.startsWith('//') && !saved.startsWith('/\\') && saved !== '/'
      ? saved : dashboard;
    navigate(target, { replace: true });
  }, [state, navigate]);
  if (state.status === 'authenticated' && state.mode === 'auth0') return <main role="status">Opening your dashboard...</main>;
  return <LoginContent showDevelopmentLogin={import.meta.env.DEV && (
    state.status === 'unauthenticated' || state.mode === 'development'
  )} auth0Content={<Auth0SignIn />} />;
}

function Login() {
  return AUTH0_CONFIGURED
    ? <LoginWithAuth0 />
    : <LoginContent showDevelopmentLogin={import.meta.env.DEV} auth0Content={
        <p className="login-error" role="alert">Auth0 sign-in is unavailable. Set the VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID and VITE_AUTH0_AUDIENCE environment variables.</p>
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
      if (!selectDevelopmentUser(loggedInUser)) return;
      const from = (location.state as { from?: unknown } | null)?.from;
      const landing = isHrOrManagerRole(loggedInUser.role_name ?? null) ? '/hr-home' : '/employee-home';
      navigate(typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : landing, { replace: true });
    } catch {
      setErrorMessage('Could not connect to Compass. Please try again.');
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
          <p className="login-intro">Sign in to your Compass workspace.</p>

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
            <div className="form-field">
              <label className="form-label" htmlFor="password">Password <span className="login-optional">(optional for development)</span></label>
              <input className="form-control" id="password" type="password" autoComplete="off"
                placeholder="Enter your password" disabled={isSubmitting} />
            </div>

            {errorMessage && <p className="login-error" id="login-error" role="alert">{errorMessage}</p>}

            <button className="btn btn-primary login-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Selecting identity...' : 'Select development identity'}
            </button>
          </form>

          <p className="login-support">This identity switcher is for local development, not production authentication.</p>
          </>}
        </div>
      </section>

      <section className="login-visual" aria-label="About Compass">
        <div className="login-visual-copy">
          <div className="login-brand">
            <span className="login-brand-mark" aria-hidden="true"><Compass size={25} /></span>
            <span>Compass</span>
          </div>
          <h2>Better feedback.<br />Stronger teams.</h2>
          <p>Bring performance reviews, team feedback, and growth conversations into one clear workspace.</p>
        </div>
      </section>
    </main>
  );
}

export default Login;

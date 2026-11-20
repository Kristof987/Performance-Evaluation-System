import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { MirraWordmark } from '../../components/brand/MirraLogo';
import { getAuthenticatedDashboardPath } from '../layout/sidebar-user';
import { AUTH0_CONFIGURED } from '../../config';
import Auth0SignIn from './Auth0SignIn';
import { safeReturnPath } from '../../auth/return-path';
import { useAppAuth } from '../../auth/AppAuth';
import './Login.css';
import InlineMessage from '../../components/feedback/InlineMessage';
import LoadingState from '../../components/feedback/LoadingState';

function Login() {
  const { state } = useAppAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (state.status !== 'authenticated') return;
    const saved = safeReturnPath(sessionStorage.getItem('auth0ReturnTo'));
    sessionStorage.removeItem('auth0ReturnTo');
    const dashboard = getAuthenticatedDashboardPath(state.user.permissions);
    navigate(saved && saved !== '/' ? saved : dashboard, { replace: true });
  }, [state, navigate]);
  if (state.status === 'authenticated') return <LoadingState variant="screen" label="Opening your dashboard" />;

  return (
    <main className="login-page">
      <section className="login-panel" aria-label="Sign in">
        <div className="login-content">
          <h1>Welcome back</h1>
          <p className="login-intro">Sign in to your Mirra workspace.</p>
          {AUTH0_CONFIGURED
            ? <Auth0SignIn />
            : <InlineMessage tone="error">Sign-in is unavailable: Auth0 is not configured. Set the VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID and VITE_AUTH0_AUDIENCE environment variables.</InlineMessage>}
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

import { useRef, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { useNavigate } from 'react-router';
import { Compass, Eye, EyeOff } from 'lucide-react';
import { isHrOrManagerRole } from '../layout/sidebar-user';
import { API_BASE_URL } from '../../config';
import './Login.css';

function Login() {
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const pending = useRef(false);
  const navigate = useNavigate();

  function setUsernameHandler(event: ChangeEvent<HTMLInputElement>) {
    setUsername(event.target.value);
    setErrorMessage('');
  }

  async function submitHandler(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const response = await fetch(`${API_BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (!response.ok) {
        setErrorMessage('Sign in failed. Check your username and try again.');
        return;
      }

      const loggedInUser = await response.json();
      sessionStorage.setItem('loggedInUser', JSON.stringify(loggedInUser));
      navigate(isHrOrManagerRole(loggedInUser.role_name ?? null) ? '/hr-home' : '/employee-home', { replace: true });
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

          <form className="login-form" onSubmit={submitHandler} aria-busy={isSubmitting}>
            <div className="form-field">
              <label className="form-label" htmlFor="username">Username</label>
              <input
                className="form-control"
                id="username"
                name="username"
                type="text"
                value={username}
                required
                autoComplete="username"
                placeholder="Enter your username"
                disabled={isSubmitting}
                aria-invalid={errorMessage ? true : undefined}
                aria-describedby={errorMessage ? 'login-error' : undefined}
                onChange={setUsernameHandler}
              />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="password">Password</label>
              <div className="login-password-field">
                <input
                  className="form-control"
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  disabled={isSubmitting}
                />
                <button
                  className="login-password-toggle"
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  disabled={isSubmitting}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="login-options">
              <label className="login-remember" title="Remember me is not available yet">
                <input type="checkbox" disabled /> Remember me
              </label>
              <span className="login-unavailable">Password recovery unavailable</span>
            </div>

            {errorMessage && <p className="login-error" id="login-error" role="alert">{errorMessage}</p>}

            <button className="btn btn-primary login-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="login-support">Need access? Contact your HR administrator.</p>
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

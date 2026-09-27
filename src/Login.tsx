import "./Login.css";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { ChangeEvent, SubmitEvent } from "react";

function Login() {
  const [email, setEmail] = useState("");
  const navigate = useNavigate();

  function setEmailHandler(event: ChangeEvent<HTMLInputElement>) {
    console.log(event.target.value);
    setEmail(event.target.value);
  }

  function submitHandler(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate('/hr-home', { replace: true });
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-label="Sign in form">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/><path d="m15.5 8.5-2.2 5-5 2.2 2.2-5 5-2.2Z" fill="currentColor"/></svg>
          </div>
          <div className="brand-name">Compass HR</div>
        </div>

        <div className="eyebrow">Secure HR workspace</div>
        <h1>Welcome back</h1>
        <p className="intro">Sign in to review campaigns, follow completion, and manage people feedback from one calm dashboard.</p>

        <form className="form" onSubmit={submitHandler}>
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input id="email" type="email" value={email} required placeholder="sarah@company.com" autoComplete="email" onChange={setEmailHandler} />
          </div> {/*TODO: adjunk hozzá template-et cég email végződés alapján*/}
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" placeholder="Enter your password" autoComplete="current-password" />
          </div>
          <div className="row">
            <label className="check"><input type="checkbox" /> Remember me</label>
            <a href="#">Forgot password?</a>
          </div>
          <button className="submit" type="submit">Sign in</button>
          <div className="divider">or</div>
          <button className="sso" type="button">Continue with SSO</button>
        </form>

        <p className="support">Need access? <a href="#">Contact your HR administrator</a></p>
      </section>

      <section className="visual" aria-label="Company branding preview">
        <div className="orb one"></div>
        <div className="orb two"></div>
        <div className="logo-card">
          <div className="logo-stage">
            <div className="fallback-logo">
              <svg viewBox="0 0 38 38" fill="none" aria-hidden="true"><rect width="38" height="38" rx="12" fill="#4553C4"/><circle cx="19" cy="19" r="10" stroke="white" strokeWidth="2.4"/><path d="m22.5 15.5-2.2 5.1-5.1 2.2 2.2-5.1 5.1-2.2Z" fill="white"/></svg>
              <strong>Company logo</strong>
            </div>
          </div>
          <div className="caption">
            <div>
              <strong>Built for any brand</strong>
              The logo sits on a neutral elevated surface, so dark, light, colorful, or monochrome logos stay readable.
            </div>
            <div className="security-pill">SSO ready</div>
          </div>
        </div>
      </section>
    </main>
  );
    
}

export default Login;
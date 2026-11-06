import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Brand } from '../components/Brand.jsx';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[A-Za-z0-9_]{3,30}$/;

function validateLogin(values) {
  const errors = {};
  if (!emailPattern.test(values.email.trim())) errors.email = 'Enter a valid email address.';
  if (!values.password) errors.password = 'Enter your password.';
  return errors;
}

function validateSignup(values) {
  const errors = {};
  if (!usernamePattern.test(values.username.trim())) {
    errors.username = 'Use 3–30 letters, numbers, or underscores.';
  }
  if (!emailPattern.test(values.email.trim())) errors.email = 'Enter a valid email address.';
  if (values.password.length < 8 || values.password.length > 128) {
    errors.password = 'Password must be between 8 and 128 characters.';
  }
  return errors;
}

function AuthLayout({ title, description, children, footer }) {
  return (
    <main className="auth-page">
      <Brand className="auth-brand" />
      <section className="auth-card">
        <p className="eyebrow">YOUR NEXT CHAPTER</p>
        <h1>{title}</h1>
        <p className="auth-description">{description}</p>
        {children}
        <p className="auth-switch">{footer}</p>
      </section>
      <p className="auth-footnote">Practice thoughtfully. Improve consistently.</p>
    </main>
  );
}

function Field({ id, label, error, ...props }) {
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      {error && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

function messageFor(error) {
  if (error instanceof ApiError) return error.message;
  return 'Could not reach the server. Check that the API is running, then try again.';
}

export function LoginPage() {
  const { user, isLoading, startupError, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isLoading) return <p className="route-status">Restoring your session…</p>;
  if (startupError)
    return (
      <p className="route-error" role="alert">
        {startupError}
      </p>
    );
  if (user) return <Navigate to="/" replace />;

  function update(event) {
    setValues((current) => ({ ...current, [event.target.name]: event.target.value }));
    setErrors((current) => ({ ...current, [event.target.name]: '' }));
    setServerError('');
  }

  async function submit(event) {
    event.preventDefault();
    const nextErrors = validateLogin(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setIsSubmitting(true);
    setServerError('');
    try {
      await login({ email: values.email.trim(), password: values.password });
      navigate(location.state?.from?.pathname ?? '/', { replace: true });
    } catch (error) {
      setServerError(messageFor(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      description="Sign in to pick up where you left off."
      footer={
        <>
          New to Codexa? <Link to="/signup">Create an account</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field
          id="email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          required
          value={values.email}
          onChange={update}
          error={errors.email}
        />
        <Field
          id="password"
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={values.password}
          onChange={update}
          error={errors.password}
        />
        {serverError && (
          <p className="form-error" role="alert">
            {serverError}
          </p>
        )}
        <button className="button form-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'} <span aria-hidden="true">→</span>
        </button>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { user, isLoading, startupError, signup } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ username: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isLoading) return <p className="route-status">Restoring your session…</p>;
  if (startupError)
    return (
      <p className="route-error" role="alert">
        {startupError}
      </p>
    );
  if (user) return <Navigate to="/" replace />;

  function update(event) {
    setValues((current) => ({ ...current, [event.target.name]: event.target.value }));
    setErrors((current) => ({ ...current, [event.target.name]: '' }));
    setServerError('');
  }

  async function submit(event) {
    event.preventDefault();
    const nextErrors = validateSignup(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setIsSubmitting(true);
    setServerError('');
    try {
      await signup({
        username: values.username.trim(),
        email: values.email.trim(),
        password: values.password,
      });
      navigate('/', { replace: true });
    } catch (error) {
      setServerError(messageFor(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Make room to grow"
      description="Create an account and start building your problem-solving habit."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field
          id="username"
          name="username"
          label="Username"
          type="text"
          autoComplete="username"
          maxLength={30}
          required
          value={values.username}
          onChange={update}
          error={errors.username}
        />
        <Field
          id="email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          required
          value={values.email}
          onChange={update}
          error={errors.email}
        />
        <Field
          id="password"
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
          value={values.password}
          onChange={update}
          error={errors.password}
        />
        {serverError && (
          <p className="form-error" role="alert">
            {serverError}
          </p>
        )}
        <button className="button form-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create account'} <span aria-hidden="true">→</span>
        </button>
      </form>
    </AuthLayout>
  );
}

import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="Cargando"
        style={{ maxWidth: 400, margin: '80px auto', textAlign: 'center' }}
      >
        Cargando…
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/scan" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await login(email, password);
      navigate('/scan', { replace: true });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Error desconocido';

      if (
        message.includes('NotAuthorizedException') ||
        message.includes('Incorrect username or password') ||
        message.includes('UserNotFoundException')
      ) {
        setError('Correo electrónico o contraseña incorrectos.');
      } else if (message.includes('UserAlreadyAuthenticatedException')) {
        navigate('/scan', { replace: true });
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        maxWidth: 400,
        margin: '80px auto',
        padding: '0 16px',
      }}
    >
      <h1 style={{ textAlign: 'center', marginBottom: 24 }}>
        Iniciar Sesión
      </h1>

      <form onSubmit={handleSubmit} noValidate>
        <div style={{ marginBottom: 16 }}>
          <label
            htmlFor="login-email"
            style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}
          >
            Correo electrónico
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            aria-required="true"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 14,
              border: '1px solid #ccc',
              borderRadius: 4,
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label
            htmlFor="login-password"
            style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}
          >
            Contraseña
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            aria-required="true"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 14,
              border: '1px solid #ccc',
              borderRadius: 4,
              boxSizing: 'border-box',
            }}
          />
        </div>

        {error && (
          <div
            role="alert"
            style={{
              color: '#d32f2f',
              backgroundColor: '#fdecea',
              padding: '8px 12px',
              borderRadius: 4,
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !email || !password}
          aria-busy={submitting}
          style={{
            width: '100%',
            padding: '10px 0',
            fontSize: 16,
            fontWeight: 600,
            color: '#fff',
            backgroundColor:
              submitting || !email || !password ? '#999' : '#ff9900',
            border: 'none',
            borderRadius: 4,
            cursor:
              submitting || !email || !password ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Iniciando sesión…' : 'Iniciar Sesión'}
        </button>
      </form>
    </div>
  );
}

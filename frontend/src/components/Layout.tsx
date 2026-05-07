import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  const navItems = [
    { to: '/scan', label: 'Nuevo Scan' },
    { to: '/history', label: 'Historial' },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          backgroundColor: '#232f3e',
          color: '#fff',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          height: 56,
        }}
      >
        <Link to="/scan" style={{ color: '#ff9900', textDecoration: 'none', fontWeight: 700, fontSize: 18 }}>
          WAFR Scan Portal
        </Link>

        <nav style={{ marginLeft: 32, display: 'flex', gap: 16 }}>
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              style={{
                color: location.pathname === item.to ? '#ff9900' : '#d5dbdb',
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: location.pathname === item.to ? 600 : 400,
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {user?.email && (
            <span style={{ fontSize: 13, color: '#d5dbdb' }}>{user.email}</span>
          )}
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Cerrar sesión"
            style={{
              background: 'transparent',
              border: '1px solid #d5dbdb',
              color: '#d5dbdb',
              padding: '4px 12px',
              borderRadius: 4,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      <main style={{ flex: 1, padding: 24 }}>
        <Outlet />
      </main>
    </div>
  );
}

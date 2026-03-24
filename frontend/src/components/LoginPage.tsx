import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login, initMap } from '../api';
import { STATIC_GRID } from '../utils/grid';
import './AuthPage.css';

const LoginPage = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      try {
        await initMap(STATIC_GRID);
      } catch (err) {
        console.error('Failed to initialize map on backend:', err);
      }
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {

      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <Link to="/" className="back-link">← Back to home</Link>
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">RoboFlow<span>.</span></div>
          <p>Welcome back, operator</p>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              placeholder="operator"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Access Dashboard'}
          </button>
        </form>

        <div className="auth-divider">or</div>

        <div className="auth-footer">
          Don't have an account? <Link to="/signup">Create one</Link>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

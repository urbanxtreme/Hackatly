import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './AuthPage.css';

const SignupPage = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [field]: e.target.value });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate('/dashboard');
  };

  return (
    <div className="auth-page">
      <Link to="/" className="back-link">← Back to home</Link>
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">RoboFlow<span>.</span></div>
          <p>Create your operator account</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Full Name</label>
            <input type="text" placeholder="John Doe" value={form.name} onChange={update('name')} />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" placeholder="operator@roboflow.io" value={form.email} onChange={update('email')} />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" placeholder="Min 8 characters" value={form.password} onChange={update('password')} />
          </div>
          <div className="form-group">
            <label>Confirm Password</label>
            <input type="password" placeholder="Re-enter password" value={form.confirm} onChange={update('confirm')} />
          </div>
          <button type="submit" className="auth-submit">
            Create Account
          </button>
        </form>

        <div className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;

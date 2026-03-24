import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './IntroPage.css';
import RobotCanvas from './RobotCanvas';

const features = [
  {
    title: "Intelligent Path Planning",
    icon: "🗺️",
    description: "A* and Dijkstra algorithms ensure robots find the most efficient routes in real-time."
  },
  {
    title: "Conflict Resolution",
    icon: "🤝",
    description: "Built-in deadlock handling and priority-based logic to prevent bottlenecks."
  },
  {
    title: "AI Adaptation",
    icon: "🧠",
    description: "Reinforcement learning improves efficiency using historical movement data."
  },
  {
    title: "Hybrid Control",
    icon: "🎮",
    description: "Central coordination balanced with local robot decision-making for reliability."
  },
  {
    title: "Real-time Monitoring",
    icon: "📊",
    description: "Live dashboards to track every robot, path, and congestion area instantly."
  },
  {
    title: "Scalable Architecture",
    icon: "🚀",
    description: "Scales from small warehouses to massive multi-level logistics centers."
  }
];

const partners = ["LogiPlus", "WareHero", "AutoShip", "SwiftGrid", "NexMove"];

const IntroPage = () => {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  return (
    <div className="intro-container">
      {/* ── Navbar ── */}
      <nav className={`navbar ${scrolled ? 'scrolled' : ''}`}>
        <div className="nav-logo">RoboFlow<span>.</span></div>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#about">About</a>
          <a href="#partners">Partners</a>
        </div>
        <div className="nav-auth">
          <Link to="/login" className="btn-secondary">Login</Link>
          <Link to="/signup" className="btn-primary">Sign Up</Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <header className="hero">
        <div className="hero-content">
          <div className="badge">AI Optimization Engine Active</div>
          <h1 className="hero-title">
            Optimize Your Warehouse with <span>Intelligent</span> Robotics.
          </h1>
          <p className="hero-subtitle">
            The world's most advanced robot coordination platform. Explore the future of logistics with our interactive 3D simulation.
          </p>
          <div className="hero-actions">
            <Link to="/signup" className="btn-primary btn-large">Start Free Trial</Link>
            <button className="btn-outline btn-large">Watch Demo</button>
          </div>
        </div>
        <div className="hero-visual">
          <RobotCanvas />
        </div>
      </header>

      {/* ── Partners ── */}
      <section className="clients-section" id="partners">
        <p className="clients-label">Trusted by industry leaders</p>
        <div className="clients-row">
          {partners.map(p => (
            <span key={p} className="client-logo">{p}</span>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section className="features-section" id="features">
        <div className="section-header">
          <h2 className="section-title">Built for Performance</h2>
          <p className="section-subtitle">Everything you need to manage a modern robotic fleet.</p>
        </div>
        <div className="features-grid">
          {features.map((f, i) => (
            <div key={i} className="feature-card">
              <div className="feature-icon">{f.icon}</div>
              <h3 className="feature-title">{f.title}</h3>
              <p className="feature-description">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="nav-logo">RoboFlow<span>.</span></div>
            <p>Intelligence in motion.</p>
          </div>
          <div className="footer-links">
            <div>
              <h4>Product</h4>
              <a href="#">Simulations</a>
              <a href="#">Analytics</a>
              <a href="#">API</a>
            </div>
            <div>
              <h4>Company</h4>
              <a href="#">About</a>
              <a href="#">Careers</a>
              <a href="#">Privacy</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; 2026 RoboFlow Intelligence. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default IntroPage;

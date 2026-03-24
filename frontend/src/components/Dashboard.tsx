import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardCanvas from './DashboardCanvas';
import SimulationView from './SimulationView';
import './Dashboard.css';

/* ─── Types ─── */

interface Task {
  id: number;
  from: string;
  to: string;
  priority: 'high' | 'medium' | 'low';
  robot: string;
}

/* ─── Mock Data ─── */

const ROBOTS = [
  { id: 'RX-7', status: 'active', zone: 'Zone A', battery: 87, task: 'Moving crate #42' },
  { id: 'RX-12', status: 'active', zone: 'Zone C', battery: 63, task: 'Scanning shelf B3' },
  { id: 'RX-3', status: 'idle', zone: 'Zone B', battery: 95, task: '—' },
  { id: 'RX-9', status: 'charging', zone: 'Dock', battery: 34, task: 'Charging' },
  { id: 'RX-15', status: 'active', zone: 'Zone D', battery: 71, task: 'Delivering to Bay 7' },
  { id: 'RX-6', status: 'error', zone: 'Zone A', battery: 12, task: 'Stuck — needs assist' },
];

const INITIAL_TASKS: Task[] = [
  { id: 1, from: 'Shelf A3', to: 'Bay 7', priority: 'high', robot: 'RX-15' },
  { id: 2, from: 'Dock 2', to: 'Zone C', priority: 'medium', robot: 'RX-12' },
  { id: 3, from: 'Storage', to: 'Zone A', priority: 'low', robot: 'RX-7' },
  { id: 4, from: 'Bay 2', to: 'Dock 1', priority: 'high', robot: 'RX-3' },
];

const ACTIVITIES = [
  { icon: '🤖', text: '<strong>RX-7</strong> completed delivery to Bay 4', time: '2 min ago' },
  { icon: '⚠️', text: '<strong>RX-6</strong> reported obstacle in Zone A', time: '5 min ago' },
  { icon: '🔋', text: '<strong>RX-9</strong> started charging at Dock 1', time: '8 min ago' },
  { icon: '✅', text: 'Task #127 completed successfully', time: '12 min ago' },
  { icon: '📍', text: '<strong>RX-15</strong> entered Zone D', time: '15 min ago' },
  { icon: '🔄', text: '<strong>RX-3</strong> reassigned to Bay 2', time: '18 min ago' },
];

/* ─── Dashboard Component ─── */

const Dashboard = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem('roboflow-theme') === 'dark';
  });
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low'>('medium');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('roboflow-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const addTask = () => {
    if (!newFrom.trim() || !newTo.trim()) return;
    setTasks(prev => [
      { id: Date.now(), from: newFrom, to: newTo, priority: newPriority, robot: 'Unassigned' },
      ...prev,
    ]);
    setNewFrom('');
    setNewTo('');
  };

  const removeTask = (id: number) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const updatePriority = (id: number, newP: 'high' | 'medium' | 'low') => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, priority: newP } : t));
  };

  const batteryColor = (pct: number) => {
    if (pct > 60) return '#16a34a';
    if (pct > 30) return '#ca8a04';
    return '#dc2626';
  };

  const sidebarItems = [
    { key: 'overview', icon: '📊', label: 'Overview' },
    { key: 'simulation', icon: '🚀', label: 'Simulation' },
    { key: 'fleet', icon: '🤖', label: 'Fleet' },
    { key: 'tasks', icon: '📋', label: 'Tasks' },
    { key: 'analytics', icon: '📈', label: 'Analytics' },
    { key: 'settings', icon: '⚙️', label: 'Settings' },
  ];

  return (
    <div className="dashboard">
      {/* ─── Floating 3D Background (Only for Overview) ─── */}
      {activeTab === 'overview' && (
        <div className="dashboard-bg-3d">
          <DashboardCanvas />
        </div>
      )}

      {/* ─── Sidebar ─── */}
      <aside className="sidebar">
        <div className="sidebar-logo">Robo<span>Flow.</span></div>
        <nav className="sidebar-nav">
          {sidebarItems.map((item) => (
            <button
              key={item.key}
              className={`sidebar-item ${activeTab === item.key ? 'active' : ''}`}
              onClick={() => setActiveTab(item.key)}
            >
              <span className="icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="sidebar-item" onClick={() => navigate('/')}>
            <span className="icon">🚪</span>
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ─── Main Content ─── */}
      <div className="dashboard-content-wrapper">
        <main className="dashboard-main">
          {/* Header */}
          <header className="dashboard-header">
            <div className="header-row">
              <div>
                <h1>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Center</h1>
                <p>Warehouse Alpha &bull; Live Intelligence</p>
              </div>
              <button className="theme-btn-dash" onClick={() => setIsDark(!isDark)} title="Toggle theme">
                {isDark ? '☀️' : '🌙'}
              </button>
            </div>
          </header>

          {activeTab === 'overview' ? (
            <>
              {/* ─── Stats Row ─── */}
              <section className="stats-grid">
                <div className="stat-card glass accent-border">
                  <div className="stat-icon">🤖</div>
                  <div className="stat-info">
                    <div className="stat-label">Active Robots</div>
                    <div className="stat-value">4<span className="muted">/6</span></div>
                  </div>
                  <div className="stat-change positive">+2 today</div>
                </div>
                <div className="stat-card glass">
                  <div className="stat-icon">📋</div>
                  <div className="stat-info">
                    <div className="stat-label">Pending Tasks</div>
                    <div className="stat-value">{tasks.length}</div>
                  </div>
                  <div className="stat-change negative">3 urgent</div>
                </div>
                <div className="stat-card glass">
                  <div className="stat-icon">⚡</div>
                  <div className="stat-info">
                    <div className="stat-label">Efficiency</div>
                    <div className="stat-value">94<span className="muted">%</span></div>
                  </div>
                  <div className="stat-change positive">+2.3%</div>
                </div>
                <div className="stat-card glass danger-border">
                  <div className="stat-icon">🚨</div>
                  <div className="stat-info">
                    <div className="stat-label">Alerts</div>
                    <div className="stat-value critical">1</div>
                  </div>
                  <div className="stat-change negative">RX-6 stuck</div>
                </div>
              </section>

              {/* ─── Main 2-Column Grid ─── */}
              <div className="content-grid">
                {/* Fleet Panel */}
                <section className="panel glass">
                  <div className="panel-header">
                    <h2 className="panel-title">Fleet Monitoring</h2>
                    <span className="badge live">● LIVE</span>
                  </div>
                  <div className="table-scroll">
                    <table className="fleet-table">
                      <thead>
                        <tr>
                          <th>Unit</th>
                          <th>Status</th>
                          <th>Zone</th>
                          <th>Battery</th>
                          <th>Current Task</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ROBOTS.map((robot) => (
                          <tr key={robot.id}>
                            <td className="unit-cell">{robot.id}</td>
                            <td>
                              <span className={`status-chip ${robot.status}`}>
                                <span className="status-dot" />
                                {robot.status}
                              </span>
                            </td>
                            <td>{robot.zone}</td>
                            <td>
                              <div className="battery-wrap">
                                <div className="battery-bar">
                                  <div className="battery-fill" style={{ width: `${robot.battery}%`, background: batteryColor(robot.battery) }} />
                                </div>
                                <span className="battery-pct">{robot.battery}%</span>
                              </div>
                            </td>
                            <td className="task-cell">{robot.task}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* Task Manager Panel */}
                <section className="panel glass">
                  <div className="panel-header">
                    <h2 className="panel-title">Task Manager</h2>
                    <span className="badge count">{tasks.length} tasks</span>
                  </div>

                  <div className="task-form">
                    <div className="task-form-row">
                      <input className="task-input" placeholder="Origin" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} />
                      <span className="form-arrow">→</span>
                      <input className="task-input" placeholder="Destination" value={newTo} onChange={(e) => setNewTo(e.target.value)} />
                    </div>
                    <div className="task-form-row">
                      <select className="task-select" value={newPriority} onChange={(e) => setNewPriority(e.target.value as 'high' | 'medium' | 'low')}>
                        <option value="high">🔴 High</option>
                        <option value="medium">🟡 Medium</option>
                        <option value="low">🟢 Low</option>
                      </select>
                      <button className="task-add-btn" onClick={addTask}>+ Deploy</button>
                    </div>
                  </div>

                  <div className="task-list">
                    {tasks.map((task) => (
                      <div key={task.id} className={`task-item priority-${task.priority}`}>
                        <div className="task-left">
                          <span className={`priority-indicator ${task.priority}`} />
                          <div className="task-details">
                            <span className="task-route">{task.from} → {task.to}</span>
                            <span className="task-robot">{task.robot}</span>
                          </div>
                        </div>
                        <div className="task-right">
                          <select
                            className={`priority-select ${task.priority}`}
                            value={task.priority}
                            onChange={(e) => updatePriority(task.id, e.target.value as 'high' | 'medium' | 'low')}
                          >
                            <option value="high">🔴 High</option>
                            <option value="medium">🟡 Medium</option>
                            <option value="low">🟢 Low</option>
                          </select>
                          <button className="task-remove" onClick={() => removeTask(task.id)} title="Remove task">×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              {/* ─── Activity Feed ─── */}
              <section className="panel glass activity-panel">
                <div className="panel-header">
                  <h2 className="panel-title">Activity Feed</h2>
                  <span className="badge live">● LIVE</span>
                </div>
                <div className="activity-grid">
                  {ACTIVITIES.map((a, i) => (
                    <div key={i} className="activity-item">
                      <div className="activity-icon">{a.icon}</div>
                      <div className="activity-body">
                        <span dangerouslySetInnerHTML={{ __html: a.text }} />
                        <span className="activity-time">{a.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : activeTab === 'simulation' ? (
            <SimulationView />
          ) : (
            <div className="panel glass" style={{ padding: '4rem', textAlign: 'center' }}>
              <h2 className="panel-title">Coming Soon</h2>
              <p style={{ color: 'var(--text-muted)' }}>The {activeTab} module is under development.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default Dashboard;

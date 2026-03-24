import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardCanvas from './DashboardCanvas';
import SimulationView from './SimulationView';
import { getToken, clearToken, getRobots, getTasks, createTask, getLogs, addRobot } from '../api';
import './Dashboard.css';

/* ─── Types ─── */

interface ApiRobot {
  id: number;
  name: string;
  state: string;      // active, idle, charging, error
  priority: string;
  x: number;
  y: number;
  current_task: string;
  battery: number;
}

interface ApiTask {
  task_id: string;
  get_x: number;
  get_y: number;
  put_x: number;
  put_y: number;
  priority: string;
  status: string;
  created_at: string;
}

interface ApiLog {
  id: number;
  bot_id: number;
  task: string;
  timestamp: string;
}

/* ─── Dashboard Component ─── */

const Dashboard = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');

  // Live data states
  const [robots, setRobots] = useState<ApiRobot[]>([]);
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [logs, setLogs] = useState<ApiLog[]>([]);

  // Task form
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low'>('medium');

  // Robot form
  const [showAddRobot, setShowAddRobot] = useState(false);
  const [newRobotName, setNewRobotName] = useState('');

  // Auth guard
  useEffect(() => {
    if (!getToken()) {
      navigate('/login');
    }
  }, [navigate]);

  // Set dark theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      const [robotData, taskData, logData] = await Promise.all([
        getRobots(),
        getTasks(),
        getLogs(),
      ]);
      setRobots(Array.isArray(robotData) ? robotData : []);
      setTasks(Array.isArray(taskData) ? taskData : []);
      setLogs(Array.isArray(logData) ? logData : []);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    }
  }, []);

  useEffect(() => {
    if (getToken()) {
      fetchData();
      const interval = setInterval(fetchData, 5000); // Poll every 5s
      return () => clearInterval(interval);
    }
  }, [fetchData]);

  // Derived stats
  const activeRobots = robots.filter(r => r.state === 'active').length;
  const pendingTasks = tasks.filter(t => t.status === 'pending' || t.status === 'waiting').length;
  const completedTasks = tasks.filter(t => t.status === 'in_progress' || t.status === 'completed').length;
  const errorRobots = robots.filter(r => r.state === 'error').length;
  const efficiency = robots.length > 0
    ? Math.round((activeRobots / robots.length) * 100)
    : 0;

  // Add task
  const handleAddTask = async () => {
    if (!newFrom.trim() || !newTo.trim()) return;
    try {
      const fromParts = newFrom.split(',').map(Number);
      const toParts = newTo.split(',').map(Number);
      if (fromParts.length !== 2 || toParts.length !== 2 || fromParts.some(isNaN) || toParts.some(isNaN)) {
        alert('Coordinates must be in format: x,y (e.g. 0,0)');
        return;
      }
      const taskId = `T${Date.now()}`;
      await createTask({
        task_id: taskId,
        get_coordinate: [fromParts[0], fromParts[1]],
        put_coordinate: [toParts[0], toParts[1]],
        priority: newPriority,
      });
      setNewFrom('');
      setNewTo('');
      fetchData(); // Refresh
    } catch (err: any) {
      alert(err.message || 'Failed to create task');
    }
  };

  // Add robot
  const handleAddRobot = async () => {
    if (!newRobotName.trim()) return;
    try {
      await addRobot({ name: newRobotName, state: 'idle', battery: 100 });
      setNewRobotName('');
      setShowAddRobot(false);
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to add robot');
    }
  };

  // Logout
  const handleLogout = () => {
    clearToken();
    navigate('/');
  };

  const batteryColor = (pct: number) => {
    if (pct > 60) return '#16a34a';
    if (pct > 30) return '#ca8a04';
    return '#dc2626';
  };

  // Format time ago
  const timeAgo = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
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
          <button className="sidebar-item" onClick={handleLogout}>
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
                    <div className="stat-value">{activeRobots}<span className="muted">/{robots.length}</span></div>
                  </div>
                  <div className="stat-change positive">{robots.length} total</div>
                </div>
                <div className="stat-card glass">
                  <div className="stat-icon">📋</div>
                  <div className="stat-info">
                    <div className="stat-label">Pending Tasks</div>
                    <div className="stat-value">{pendingTasks}</div>
                  </div>
                  <div className="stat-change negative">{completedTasks} running</div>
                </div>
                <div className="stat-card glass">
                  <div className="stat-icon">⚡</div>
                  <div className="stat-info">
                    <div className="stat-label">Efficiency</div>
                    <div className="stat-value">{efficiency}<span className="muted">%</span></div>
                  </div>
                  <div className="stat-change positive">fleet utilization</div>
                </div>
                <div className="stat-card glass danger-border">
                  <div className="stat-icon">🚨</div>
                  <div className="stat-info">
                    <div className="stat-label">Alerts</div>
                    <div className="stat-value critical">{errorRobots}</div>
                  </div>
                  <div className="stat-change negative">{errorRobots > 0 ? 'needs attention' : 'all clear'}</div>
                </div>
              </section>

              {/* ─── Main 2-Column Grid ─── */}
              <div className="content-grid">
                {/* Fleet Panel */}
                <section className="panel glass">
                  <div className="panel-header">
                    <h2 className="panel-title">Fleet Monitoring</h2>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span className="badge live">● LIVE</span>
                      <button className="task-add-btn" style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }} onClick={() => setShowAddRobot(!showAddRobot)}>
                        + Add Robot
                      </button>
                    </div>
                  </div>

                  {showAddRobot && (
                    <div className="task-form" style={{ marginBottom: '1rem' }}>
                      <div className="task-form-row">
                        <input className="task-input" placeholder="Robot Name (e.g. RX-7)" value={newRobotName} onChange={(e) => setNewRobotName(e.target.value)} />
                        <button className="task-add-btn" onClick={handleAddRobot}>Deploy</button>
                      </div>
                    </div>
                  )}

                  <div className="table-scroll">
                    <table className="fleet-table">
                      <thead>
                        <tr>
                          <th>Unit</th>
                          <th>Status</th>
                          <th>Priority</th>
                          <th>Battery</th>
                          <th>Current Task</th>
                        </tr>
                      </thead>
                      <tbody>
                        {robots.length === 0 ? (
                          <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No robots added yet. Click "+ Add Robot" above.</td></tr>
                        ) : (
                          robots.map((robot) => (
                            <tr key={robot.id}>
                              <td className="unit-cell">{robot.name}</td>
                              <td>
                                <span className={`status-chip ${robot.state}`}>
                                  <span className="status-dot" />
                                  {robot.state}
                                </span>
                              </td>
                              <td>
                                <span className={`status-chip ${robot.priority === 'high' ? 'error' : robot.priority === 'medium' ? 'idle' : 'active'}`}>
                                  {robot.priority}
                                </span>
                              </td>
                              <td>
                                <div className="battery-wrap">
                                  <div className="battery-bar">
                                    <div className="battery-fill" style={{ width: `${robot.battery}%`, background: batteryColor(robot.battery) }} />
                                  </div>
                                  <span className="battery-pct">{robot.battery}%</span>
                                </div>
                              </td>
                              <td className="task-cell">{robot.current_task}</td>
                            </tr>
                          ))
                        )}
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
                      <input className="task-input" placeholder="Pick (x,y)" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} />
                      <span className="form-arrow">→</span>
                      <input className="task-input" placeholder="Drop (x,y)" value={newTo} onChange={(e) => setNewTo(e.target.value)} />
                    </div>
                    <div className="task-form-row">
                      <select className="task-select" value={newPriority} onChange={(e) => setNewPriority(e.target.value as 'high' | 'medium' | 'low')}>
                        <option value="high">🔴 High</option>
                        <option value="medium">🟡 Medium</option>
                        <option value="low">🟢 Low</option>
                      </select>
                      <button className="task-add-btn" onClick={handleAddTask}>+ Deploy</button>
                    </div>
                  </div>

                  <div className="task-list">
                    {tasks.length === 0 ? (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem', fontSize: '0.85rem' }}>
                        No tasks yet. Create one above using coordinate format (x,y).
                      </div>
                    ) : (
                      tasks.map((task) => (
                        <div key={task.task_id} className={`task-item priority-${task.priority}`}>
                          <div className="task-left">
                            <span className={`priority-indicator ${task.priority}`} />
                            <div className="task-details">
                              <span className="task-route">[{task.get_x},{task.get_y}] → [{task.put_x},{task.put_y}]</span>
                              <span className="task-robot">{task.task_id} • {task.status}</span>
                            </div>
                          </div>
                          <div className="task-right">
                            <span className={`status-chip ${task.status === 'in_progress' ? 'active' : task.status === 'pending' ? 'idle' : task.status === 'waiting' ? 'charging' : 'error'}`} style={{ fontSize: '0.7rem' }}>
                              <span className="status-dot" />
                              {task.status}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
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
                  {logs.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', padding: '1rem', fontSize: '0.85rem' }}>
                      No activity logs yet. Robot state changes and task updates will appear here.
                    </div>
                  ) : (
                    logs.slice(0, 12).map((log) => (
                      <div key={log.id} className="activity-item">
                        <div className="activity-icon">🤖</div>
                        <div className="activity-body">
                          <span><strong>Bot #{log.bot_id}</strong> — {log.task}</span>
                          <span className="activity-time">{timeAgo(log.timestamp)}</span>
                        </div>
                      </div>
                    ))
                  )}
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

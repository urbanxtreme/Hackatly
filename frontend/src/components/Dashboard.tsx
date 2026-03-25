import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardCanvas from './DashboardCanvas';
import SimulationView from './SimulationView';
import TaskManager from './TaskManager';
import MapManu from './mapmanu';
import { getToken, clearToken, getRobots, getTasks, getLogs, addRobot, deleteRobot, getMap, updateRobotPriority } from '../api';
import { STATIC_GRID } from '../utils/grid';
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

export interface ApiTask {
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

  // Robot form
  const [showAddRobot, setShowAddRobot] = useState(false);
  const [newRobotName, setNewRobotName] = useState('');

  // Map Editor
  const [showMapEditor, setShowMapEditor] = useState(false);
  const [mapGrid, setMapGrid] = useState<number[][]>(STATIC_GRID);

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
      const [robotData, taskData, logData, mapData] = await Promise.all([
        getRobots(),
        getTasks(),
        getLogs(),
        getMap(),
      ]);
      setRobots(Array.isArray(robotData) ? robotData : []);
      setTasks(Array.isArray(taskData) ? taskData : []);
      setLogs(Array.isArray(logData) ? logData : []);
      if (mapData && mapData.map) setMapGrid(mapData.map);
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
  const activeRobots = tasks.filter(t => t.status === 'in_progress').length;
  const pendingTasksCount = tasks.filter(t => t.status === 'pending' || t.status === 'waiting').length;
  const runningTasksCount = tasks.filter(t => t.status === 'in_progress').length;
  const errorRobots = robots.filter(r => r.state === 'error').length;
  const efficiency = robots.length > 0
    ? Math.round((activeRobots / robots.length) * 100)
    : 0;

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

  // Delete robot
  const handleDeleteRobot = async (id: number) => {
    if (confirm('Are you sure you want to delete this robot? This will also delete all associated logs.')) {
      try {
        await deleteRobot(id);
        fetchData(); // Refresh list
      } catch (err: any) {
        alert(err.message || 'Failed to delete robot');
      }
    }
  };

  // Logout
  const handleLogout = () => {
    clearToken();
    navigate('/');
  };

  // Update priority
  const handleUpdatePriority = async (id: number, priority: string) => {
    try {
      await updateRobotPriority(id, priority);
      fetchData(); // Refresh list to show updated priority
    } catch (err: any) {
      alert(err.message || 'Failed to update priority');
    }
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
                    <div className="stat-value">{pendingTasksCount}</div>
                  </div>
                  <div className="stat-change negative">{runningTasksCount} running</div>
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
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <span className="badge live">● LIVE</span>
                      <button className="task-add-btn" onClick={() => setShowAddRobot(!showAddRobot)}>
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
                          <th>Actions</th>
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
                                <select 
                                  className={`priority-dropdown ${robot.priority}`}
                                  value={robot.priority}
                                  onChange={(e) => handleUpdatePriority(robot.id, e.target.value)}
                                >
                                  <option value="low">Low</option>
                                  <option value="medium">Medium</option>
                                  <option value="high">High</option>
                                </select>
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
                              <td className="actions-cell">
                                <button 
                                  className="btn-delete-row" 
                                  onClick={() => handleDeleteRobot(robot.id)}
                                  title="Delete Robot"
                                >
                                  🗑️
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* Task Manager Panel */}
                <TaskManager 
                  tasks={tasks} 
                  onTaskAdded={fetchData} 
                  onTaskDeleted={fetchData}
                  onSwitchToSimulation={() => setActiveTab('simulation')} 
                />
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
                    logs.slice(0, 12).map((log) => {
                      const botName = robots.find(r => r.id === log.bot_id)?.name || `Bot #${log.bot_id}`;
                      return (
                        <div key={log.id} className="activity-item">
                          <div className="activity-icon">🤖</div>
                          <div className="activity-body">
                            <span><strong>{botName}</strong> — {log.task}</span>
                            <span className="activity-time">{timeAgo(log.timestamp)}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </>
          ) : activeTab === 'simulation' ? (
            <SimulationView apiRobots={robots} tasks={tasks} onFetchData={fetchData} apiGrid={mapGrid} />
          ) : activeTab === 'settings' ? (
            <div className="panel glass" style={{ padding: '2rem' }}>
              <div className="settings-header" style={{ marginBottom: '2rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                <h2 className="panel-title" style={{ fontSize: '1.5rem' }}>Warehouse Configuration</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Configure and manage the warehouse environment.</p>
              </div>

              <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                <div className="settings-card glass" style={{ padding: '1.5rem', border: '1px solid var(--border)', borderRadius: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                    <span style={{ fontSize: '1.5rem' }}>🗺️</span>
                    <h3 style={{ margin: 0 }}>Warehouse Blueprint</h3>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                    Modify the warehouse layout by drawing storage racks and obstacles. This layout determines robot pathfinding.
                  </p>
                  <button 
                    className="task-add-btn" 
                    style={{ width: '100%', padding: '0.75rem' }} 
                    onClick={() => setShowMapEditor(true)}
                  >
                    Edit Layout Blueprint
                  </button>
                </div>

                <div className="settings-card glass" style={{ padding: '1.5rem', border: '1px solid var(--border)', borderRadius: '12px', opacity: 0.6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                    <span style={{ fontSize: '1.5rem' }}>⛓️</span>
                    <h3 style={{ margin: 0 }}>Network Settings</h3>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                    Configure API endpoints and WebSocket connection parameters.
                  </p>
                  <button className="task-add-btn" style={{ width: '100%', padding: '0.75rem' }} disabled>
                    Offline
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="panel glass" style={{ padding: '4rem', textAlign: 'center' }}>
              <h2 className="panel-title">Coming Soon</h2>
              <p style={{ color: 'var(--text-muted)' }}>The {activeTab} module is under development.</p>
            </div>
          )}
        </main>
      </div>

      {/* ─── Map Editor Overlay ─── */}
      {showMapEditor && (
        <MapManu 
          onClose={() => setShowMapEditor(false)} 
          onMapSaved={() => {
            setShowMapEditor(false);
            fetchData();
          }} 
        />
      )}
    </div>
  );
};

export default Dashboard;

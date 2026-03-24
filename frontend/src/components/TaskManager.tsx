import { useState } from 'react';
import { createTask } from '../api';
import './Dashboard.css';

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

interface TaskManagerProps {
  tasks: ApiTask[];
  onTaskAdded: () => void;
  onSwitchToSimulation?: () => void;
}

const TaskManager = ({ tasks, onTaskAdded, onSwitchToSimulation }: TaskManagerProps) => {
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low'>('medium');

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
      
      onTaskAdded(); // Refresh data
      if (onSwitchToSimulation) {
        onSwitchToSimulation(); // auto switch to simulation view
      }
    } catch (err: any) {
      alert(err.message || 'Failed to create task');
    }
  };

  return (
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
  );
};

export default TaskManager;

import { useState } from 'react';
import { createTask, deleteTask } from '../api';
import { STATIC_GRID } from '../utils/grid';
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
  onTaskDeleted?: () => void;
  onSwitchToSimulation?: () => void;
}


const TaskManager = ({ tasks, onTaskAdded, onTaskDeleted, onSwitchToSimulation }: TaskManagerProps) => {
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [bursting, setBursting] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleClearAll = async () => {
    if (tasks.length === 0) return;
    if (!confirm(`Delete all ${tasks.length} task(s)?`)) return;
    setClearing(true);
    await Promise.allSettled(tasks.map(t => deleteTask(t.task_id)));
    setClearing(false);
    onTaskDeleted?.();
  };

  const isTraversable = (x: number, z: number) => {
    if (x < 0 || x >= 30 || z < 0 || z >= 30) return false;
    return STATIC_GRID[x][z] === 0;
  };

  const priorities: ('high' | 'medium' | 'low')[] = ['high', 'medium', 'low'];

  const handleRandomTasks = async () => {
    setBursting(true);
    const count = 10;
    const tasksToCreate = [];

    const getRandPoint = () => {
      let x, z;
      let attempts = 0;
      do {
        x = Math.floor(Math.random() * 28) + 1;
        z = Math.floor(Math.random() * 28) + 1;
        attempts++;
      } while (!isTraversable(x, z) && attempts < 100);
      return [x, z];
    };

    for (let i = 0; i < count; i++) {
      const [px, pz] = getRandPoint();
      let [dx, dz] = getRandPoint();
      while (dx === px && dz === pz) {
        [dx, dz] = getRandPoint();
      }
      tasksToCreate.push({
        task_id: `T${Date.now()}${i}`,
        get_coordinate: [px, pz] as [number, number],
        put_coordinate: [dx, dz] as [number, number],
        priority: priorities[i % 3],
      });
    }

    await Promise.allSettled(tasksToCreate.map(t => createTask(t)));
    setBursting(false);
    onTaskAdded();
  };

  const handleAddTask = async () => {
    if (!newFrom.trim() || !newTo.trim()) return;
    try {
      const fromParts = newFrom.split(',').map(Number);
      const toParts = newTo.split(',').map(Number);
      if (fromParts.length !== 2 || toParts.length !== 2 || fromParts.some(isNaN) || toParts.some(isNaN)) {
        alert('Coordinates must be in format: x,y (e.g. 0,0)');
        return;
      }
      
      const [fx, fz] = fromParts;
      const [tx, tz] = toParts;

      if (!isTraversable(fx, fz)) {
        alert(`Unreachable Coordinate: [${fx}, ${fz}] is inside a storage rack or wall.`);
        return;
      }
      if (!isTraversable(tx, tz)) {
        alert(`Unreachable Coordinate: [${tx}, ${tz}] is inside a storage rack or wall.`);
        return;
      }

      const taskId = `T${Date.now()}`;
      await createTask({
        task_id: taskId,
        get_coordinate: [fx, fz],
        put_coordinate: [tx, tz],
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="badge count">{tasks.length} tasks</span>
          {tasks.length > 0 && (
            <button
              className="task-add-btn random-burst-btn"
              onClick={handleClearAll}
              disabled={clearing}
              title="Delete all tasks"
              style={{ background: 'rgba(180,30,30,0.8)', padding: '3px 10px', fontSize: '0.72rem' }}
            >
              {clearing ? '...' : '🗑 Clear All'}
            </button>
          )}
        </div>
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
          <button
            className="task-add-btn random-burst-btn"
            onClick={handleRandomTasks}
            disabled={bursting}
            title="Deploy 3 random tasks across the grid"
          >
            {bursting ? '...' : '⚡ Random'}
          </button>
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
                <button 
                  className="btn-delete-task" 
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (confirm('Delete this task?')) {
                      await deleteTask(task.task_id);
                      onTaskDeleted?.();
                    }
                  }}
                  title="Delete Task"
                >
                  🗑️
                </button>
              </div>
            </div>

          ))
        )}
      </div>
    </section>
  );
};

export default TaskManager;

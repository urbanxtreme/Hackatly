/* ─── Centralized API Client ─── */

const BASE_URL = 'http://localhost:8080';

/* ─── Token helpers ─── */
export const getToken = () => localStorage.getItem('roboflow-token');
export const setToken = (t: string) => localStorage.setItem('roboflow-token', t);
export const clearToken = () => localStorage.removeItem('roboflow-token');

/* ─── Core fetch wrapper ─── */
async function authFetch(path: string, opts: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...opts, headers });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  return res;
}

/* ─── Auth ─── */
export async function login(username: string, password: string) {
  const res = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  setToken(data.token);
  localStorage.setItem('roboflow-user', data.username);
  return data;
}

export async function register(username: string, password: string, email: string) {
  const res = await fetch(`${BASE_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Registration failed');
  setToken(data.token);
  localStorage.setItem('roboflow-user', data.username);
  return data;
}

/* ─── Robots ─── */
export async function getRobots() {
  const res = await authFetch('/robots');
  return res.json();
}

export async function addRobot(robot: {
  name: string; state?: string; priority?: string;
  x?: number; y?: number; current_task?: string; battery?: number;
}) {
  const res = await authFetch('/robots', {
    method: 'POST',
    body: JSON.stringify(robot),
  });
  return res.json();
}

export async function updateRobotState(id: number, state: string) {
  const res = await authFetch(`/robots/${id}/state`, {
    method: 'PATCH',
    body: JSON.stringify({ state }),
  });
  return res.json();
}

export async function updateRobotPriority(id: number, priority: string) {
  const res = await authFetch(`/robots/${id}/priority`, {
    method: 'PATCH',
    body: JSON.stringify({ priority }),
  });
  return res.json();
}

export async function updateRobotPosition(id: number, x: number, y: number) {
  const res = await authFetch(`/robots/${id}/position`, {
    method: 'PATCH',
    body: JSON.stringify({ x, y }),
  });
  return res.json();
}

export async function updateRobotTask(id: number, taskId: string) {
  const res = await authFetch(`/robots/${id}/task`, {
    method: 'PATCH',
    body: JSON.stringify({ task_id: taskId }),
  });
  return res.json();
}

export async function deleteRobot(id: number) {
  const res = await authFetch(`/robots/${id}`, {
    method: 'DELETE',
  });
  return res.json();
}


/* ─── Tasks ─── */
export async function getTasks() {
  const res = await authFetch('/tasks');
  return res.json();
}

export async function createTask(task: {
  task_id: string;
  get_coordinate: [number, number];
  put_coordinate: [number, number];
  priority?: string;
}) {
  const res = await authFetch('/task', {
    method: 'POST',
    body: JSON.stringify(task),
  });
  return res.json();
}

export async function completeTask(taskId: string) {
  const res = await authFetch(`/tasks/${taskId}/complete`, {
    method: 'PATCH',
  });
  return res.json();
}

export async function deleteTask(taskId: string) {
  const res = await authFetch(`/tasks/${taskId}`, {
    method: 'DELETE',
  });
  return res.json();
}

export async function getTaskLogs() {
  const res = await authFetch('/tasks/log');
  return res.json();
}



/* ─── Logs ─── */
export async function getLogs() {
  const res = await authFetch('/logs');
  return res.json();
}

export async function addLog(botId: number, message: string) {
  const res = await authFetch('/logs', {
    method: 'POST',
    body: JSON.stringify({
      bot_id: botId,
      task: message
    })
  });
  return res.json();
}

export async function addEfficiency(botId: number, score: number) {
  const res = await authFetch(`/robots/${botId}/efficiency`, {
    method: 'POST',
    body: JSON.stringify({ efficiency: score })
  });
  return res.json();
}

export async function addExperience(botId: number, state: number[], action: number, reward: number, efficiency: number) {
  const res = await authFetch(`/robots/${botId}/experience`, {
    method: 'POST',
    body: JSON.stringify({ state: JSON.stringify(state), action, reward, efficiency })
  });
  return res.json();
}

export async function getEfficiencyHistory(botId: number) {
  const res = await authFetch(`/robots/${botId}/efficiency`);
  return res.json();
}

/* ─── Map ─── */
export async function getMap() {
  const res = await authFetch('/map');
  return res.json();
}

export async function initMap(map: number[][]) {
  const res = await authFetch('/init', {
    method: 'POST',
    body: JSON.stringify({ map }),
  });
  return res.json();
}

export async function updateMap(obstacles: number[][]) {
  const res = await authFetch('/map', {
    method: 'PUT',
    body: JSON.stringify({ obstacles }),
  });
  return res.json();
}

/* ─── CSV Bulk Upload ─── */
export async function uploadRobotsCSV(file: File) {
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${BASE_URL}/robots/upload`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData,
  });

  if (res.status === 401) { clearToken(); window.location.href = '/login'; throw new Error('Unauthorized'); }

  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  } catch (e: any) {
    if (e.message && !e.message.includes('JSON')) throw e;
    throw new Error('Server error: ' + text.substring(0, 200));
  }
}

export async function uploadTasksCSV(file: File) {
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${BASE_URL}/tasks/upload`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData,
  });

  if (res.status === 401) { clearToken(); window.location.href = '/login'; throw new Error('Unauthorized'); }

  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  } catch (e: any) {
    if (e.message && !e.message.includes('JSON')) throw e;
    throw new Error('Server error: ' + text.substring(0, 200));
  }
}


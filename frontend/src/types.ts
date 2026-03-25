export interface ApiRobot {
  id: number;
  name: string;
  state: string;      // active, idle, charging, error
  priority: string;   // high, medium, low
  current_position_x: number;
  current_position_y: number;
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

export interface ApiLog {
  id: number;
  bot_id: number;
  task: string;
  timestamp: string;
}

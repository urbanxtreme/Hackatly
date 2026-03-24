```
import { useState, useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Line } from '@react-three/drei';
import * as THREE from 'three';
import { GRID_SIZE, STATIC_GRID } from '../utils/grid';
import TaskManager, { type ApiTask, type TaskManagerProps } from './TaskManager';
import { completeTask } from '../api';
import './SimulationView.css';

/* ─── Simulation Configuration ─── */
const CENTER_OFFSET = (GRID_SIZE - 1) / 2;
const TICK_INTERVAL = 250;
const ROBOT_COLORS = [0xff2222, 0xffaa00, 0x00cc22, 0x00aaff, 0x9900ff, 0x333333];
const SPAWN_POINTS = [
  { x: 1, z: 1 }, { x: 28, z: 1 },
  { x: 1, z: 28 }, { x: 28, z: 28 },
  { x: 1, z: 14 }, { x: 28, z: 14 }
];

/* ─── A* Pathfinding Logic ─── */
const heuristic = (a: { x: number; z: number }, b: { x: number; z: number }) => 
  Math.abs(a.x - b.x) + Math.abs(a.z - b.z);

const astar = (start: { x: number; z: number }, goal: { x: number; z: number }) => {
  let openSet = [start];
  let cameFrom = new Map<string, { x: number; z: number }>();
  let gScore = new Map<string, number>();
  let fScore = new Map<string, number>();

  const toKey = (p: { x: number; z: number }) => `${p.x},${p.z}`;
  gScore.set(toKey(start), 0);
  fScore.set(toKey(start), heuristic(start, goal));

  while (openSet.length > 0) {
    openSet.sort((a, b) => (fScore.get(toKey(a)) || Infinity) - (fScore.get(toKey(b)) || Infinity));
    const current = openSet.shift()!;

    if (current.x === goal.x && current.z === goal.z) {
      const path = [current];
      let currKey = toKey(current);
      while (cameFrom.has(currKey)) {
        const prev = cameFrom.get(currKey)!;
        path.unshift(prev);
        currKey = toKey(prev);
      }
      return path;
    }

    const neighbors = [
      { x: current.x + 1, z: current.z }, { x: current.x - 1, z: current.z },
      { x: current.x, z: current.z + 1 }, { x: current.x, z: current.z - 1 }
    ].filter(n => n.x >= 0 && n.x < GRID_SIZE && n.z >= 0 && n.z < GRID_SIZE && STATIC_GRID[n.x][n.z] === 0);

    for (const n of neighbors) {
      const tentativeGScore = (gScore.get(toKey(current)) ?? Infinity) + 1;
      const nKey = toKey(n);
      if (tentativeGScore < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, current);
        gScore.set(nKey, tentativeGScore);
        fScore.set(nKey, tentativeGScore + heuristic(n, goal));
        if (!openSet.some(p => p.x === n.x && p.z === n.z)) {
          openSet.push(n);
        }
      }
    }
  }
  return []; 
};

/* ─── Simulation Component Interface ─── */
interface RobotState {
  id: number;
  x: number;
  z: number;
  color: string;
  missionPhase: 'IDLE' | 'TO_PICK' | 'TO_DROP' | 'TO_WAIT' | 'FAILED';
  status: 'IDLE' | 'MOVING' | 'BLOCKED' | 'DONE';
  path: { x: number; z: number }[];
  pathIndex: number;
  payloadVisible: boolean;
  missionData: { px: string, pz: string, dx: string, dz: string };
  currentTaskId?: string;
}

interface SimulationViewProps {
  apiRobots?: any[];
  tasks?: ApiTask[];
  onFetchData?: () => void;
}

/* ─── 3D Components ─── */
const RobotModel = ({ robot, onSelect }: { robot: RobotState; onSelect: (r: RobotState) => void }) => {
  const meshRef = useRef<THREE.Group>(null!);

  useFrame(() => {
    meshRef.current.position.x = THREE.MathUtils.lerp(meshRef.current.position.x, robot.x, 0.1);
    meshRef.current.position.z = THREE.MathUtils.lerp(meshRef.current.position.z, robot.z, 0.1);
  });

  return (
    <group ref={meshRef} position={[robot.x, 0, robot.z]} onClick={(e) => { e.stopPropagation(); onSelect(robot); }}>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[0.7, 0.4, 0.8]} />
        <meshStandardMaterial color={robot.color} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.6, -0.2]}>
        <cylinderGeometry args={[0.05, 0.05, 0.3]} />
        <meshStandardMaterial color="white" />
      </mesh>
      {robot.payloadVisible && (
        <mesh position={[0, 0.8, 0.1]}>
          <boxGeometry args={[0.4, 0.4, 0.4]} />
          <meshStandardMaterial color="#dddddd" />
        </mesh>
      )}
    </group>
  );
};

const WarehouseEnvironment = () => {
  const racks = useMemo(() => {
    const items = [];
    for (let x = 3; x < GRID_SIZE - 3; x += 5) {
      for (let z = 3; z < GRID_SIZE - 3; z++) {
        if (z % 8 !== 0 && z % 8 !== 1) {
          items.push({ x, z }, { x: x + 1, z });
        }
      }
    }
    for (let x = 5; x <= 25; x++) {
      items.push({ x, z: 27 }, { x, z: 29 });
    }
    return items;
  }, []);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[CENTER_OFFSET, -0.01, CENTER_OFFSET]}>
        <planeGeometry args={[GRID_SIZE, GRID_SIZE]} />
        <meshStandardMaterial color="#111" roughness={1.0} />
      </mesh>
      
      <Grid
        position={[CENTER_OFFSET, 0, CENTER_OFFSET]}
        args={[GRID_SIZE, GRID_SIZE]}
        sectionColor="#333"
        cellColor="#222"
        infiniteGrid={false}
        fadeDistance={50}
        fadeStrength={1}
      />

      {racks.map((pos, i) => (
        <mesh key={i} position={[pos.x, 0.75, pos.z]}>
          <boxGeometry args={[0.9, 1.5, 0.9]} />
          <meshStandardMaterial color="#2b5797" roughness={0.8} />
          <Line
            points={[
              [-0.45, -0.75, -0.45], [0.45, -0.75, -0.45],
              [0.45, -0.75, -0.45], [0.45, 0.75, -0.45],
            ]}
            color="#000"
            lineWidth={1}
          />
        </mesh>
      ))}

      {SPAWN_POINTS.map((p, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[p.x, 0.01, p.z]}>
          <planeGeometry args={[0.9, 0.9]} />
          <meshBasicMaterial color="#0055ff" transparent opacity={0.4} />
        </mesh>
      ))}
    </group>
  );
};

/* ─── Main Simulation Component ─── */
const SimulationView = ({ apiRobots = [], tasks = [], onFetchData = () => {} }: SimulationViewProps) => {
  const [robots, setRobots] = useState<RobotState[]>([]);
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(new Set());
  
  const [selectedRobot, setSelectedRobot] = useState<RobotState | null>(null);
  const [hasDeadlock, setHasDeadlock] = useState(false);
  
  const robotsRef = useRef(robots);
  useEffect(() => { robotsRef.current = robots; }, [robots]);

  /* ─── Sync Robots with Backend ─── */
  useEffect(() => {
    setRobots(prev => {
      const newFleet = [...prev];
      let hasChanges = false;
      
      apiRobots.forEach((apiBot, index) => {
        const existing = prev.find(r => r.id === apiBot.id);
        if (!existing) {
          const pt = SPAWN_POINTS[index % SPAWN_POINTS.length];
          newFleet.push({
            id: apiBot.id,
            x: pt.x,
            z: pt.z,
            color: `#${new THREE.Color(ROBOT_COLORS[index % ROBOT_COLORS.length]).getHexString()}`,
            missionPhase: 'IDLE',
            status: 'IDLE',
            path: [],
            pathIndex: 0,
            payloadVisible: false,
            missionData: { px: '', pz: '', dx: '', dz: '' }
          });
          hasChanges = true;
        }
      });
      
      const validIds = new Set(apiRobots.map(r => r.id));
      const filteredFleet = newFleet.filter(r => validIds.has(r.id));
      if (filteredFleet.length !== newFleet.length) hasChanges = true;

      return hasChanges ? filteredFleet : prev;
    });
  }, [apiRobots]);

  /* ─── Backend Integration & Live Task Assignment ─── */
  useEffect(() => {
    // 1. Check for backend deadlock (any task in 'waiting' state)
    const isDeadlocked = tasks.some(t => t.status === 'waiting');
    setHasDeadlock(isDeadlocked);

    // 2. Assign unassigned 'in_progress' or 'pending' tasks to IDLE robots
    const activeBackendTasks = tasks.filter(t => 
      (t.status === 'in_progress' || t.status === 'pending') && 
      !completedTaskIds.has(t.task_id)
    );

    console.log('[SimulationView] Total tasks:', tasks.length, '| Active tasks:', activeBackendTasks.length);
    
    setRobots(prev => {
      let updatedList = [...prev];
      let hasChanges = false;

      for (const backendTask of activeBackendTasks) {
        // Skip if already assigned in frontend
        if (updatedList.some(r => r.currentTaskId === backendTask.task_id)) {
          continue;
        }

        console.log(`[SimulationView] Trying to assign task ${backendTask.task_id} from (${backendTask.get_x},${backendTask.get_y}) to (${backendTask.put_x},${backendTask.put_y})`);

        // Find idle robot
        const idleBotIndex = updatedList.findIndex(r => r.status === 'IDLE' || r.status === 'DONE');
        if (idleBotIndex !== -1) {
          const bot = updatedList[idleBotIndex];
          const px = backendTask.get_x;
          const pz = backendTask.get_y;
          const dx = backendTask.put_x;
          const dz = backendTask.put_y;

          const testPath = astar({ x: bot.x, z: bot.z }, { x: px, z: pz });
          console.log(`[SimulationView] Robot #${bot.id} at (${bot.x},${bot.z}) -> A* to pick (${px},${pz}) returned ${testPath.length} steps.`);
          
          if (testPath.length > 0) {
            updatedList[idleBotIndex] = {
              ...bot,
              currentTaskId: backendTask.task_id,
              path: testPath,
              pathIndex: 1,
              status: 'MOVING',
              missionPhase: 'TO_PICK',
              payloadVisible: false,
              missionData: { px: String(px), pz: String(pz), dx: String(dx), dz: String(dz) }
            };
            hasChanges = true;
            console.log(`[SimulationView] Assigned task ${backendTask.task_id} to Robot #${bot.id}`);
          }
        } else {
          console.log(`[SimulationView] No idle robots available for task ${backendTask.task_id}`);
        }
      }
      return hasChanges ? updatedList : prev;
    });

  }, [tasks]);

  /* ─── Simulation Tick Engine ─── */
  useEffect(() => {
    // FREEZE simulation tick if a deadlock warning is active!
    if (hasDeadlock) return;

    const timer = setInterval(() => {
      setRobots(prev => {
        let needsUpdate = false;
        const nextFleet = prev.map(bot => {
          if (bot.status !== 'MOVING' && bot.status !== 'BLOCKED') return bot;

          if (bot.pathIndex < bot.path.length) {
            const nextStep = bot.path[bot.pathIndex];
            
            // Local collision check (simple stop if cell occupied)
            const occupied = prev.some(r => r.id !== bot.id && r.x === nextStep.x && r.z === nextStep.z);
            
            if (occupied) {
              if (bot.status !== 'BLOCKED') needsUpdate = true;
              return { ...bot, status: 'BLOCKED' as const };
            } else {
              needsUpdate = true;
              return { ...bot, x: nextStep.x, z: nextStep.z, pathIndex: bot.pathIndex + 1, status: 'MOVING' as const };
            }
          } else {
            // Reached phase target
            needsUpdate = true;
            if (bot.missionPhase === 'TO_PICK') {
              const nextPath = astar({ x: bot.x, z: bot.z }, { x: parseInt(bot.missionData.dx), z: parseInt(bot.missionData.dz) });
              return { ...bot, path: nextPath, pathIndex: 1, missionPhase: 'TO_DROP' as const, payloadVisible: true };
            } else if (bot.missionPhase === 'TO_DROP') {
              const findWait = () => {
                const offsets = [ {dx:2, dz:0}, {dx:-2, dz:0}, {dx:0, dz:2}, {dx:0, dz:-2}, {dx:2, dz:2}, {dx:-2, dz:-2} ];
                for (let o of offsets) {
                  const wx = bot.x + o.dx, wz = bot.z + o.dz;
                  if (wx >= 0 && wx < GRID_SIZE && wz >= 0 && wz < GRID_SIZE && STATIC_GRID[wx][wz] === 0) return {x: wx, z: wz};
                }
                return {x: bot.x, z: bot.z}; 
              };
              const waitTarget = findWait();
              const nextPath = astar({ x: bot.x, z: bot.z }, waitTarget);
              return { ...bot, path: nextPath, pathIndex: 1, missionPhase: 'TO_WAIT' as const, payloadVisible: false };
            } else {
              // Task permanently finished visually
              if (bot.currentTaskId) {
                const tid = bot.currentTaskId;
                setCompletedTaskIds(prev => new Set(prev).add(tid));
                // Notify backend
                completeTask(tid).catch(err => console.error('[SimulationView] Failed to complete task:', err));
                
                // NEW: Sync position to backend
                const robotId = bot.id;
                const finalX = bot.x;
                const finalY = bot.z;
                updateRobotPosition(robotId, finalX, finalY).catch(err => console.error('[SimulationView] Failed to sync position:', err));
              }
              return { ...bot, status: 'DONE' as const, missionPhase: 'IDLE' as const, payloadVisible: false, currentTaskId: undefined };
            }

          }
        });

        return needsUpdate ? nextFleet : prev;
      });
    }, TICK_INTERVAL);

    return () => clearInterval(timer);
  }, [hasDeadlock]);

  return (
    <div className="simulation-view">
      {/* ─── Deadlock Overlay ─── */}
      {hasDeadlock && (
        <div className="deadlock-overlay">
          <div className="deadlock-warning">
            <h1>CRITICAL DEADLOCK DETECTED!</h1>
            <p>Multiple robots are attempting to claim intersecting paths.</p>
            <p><strong>RoboFlow API is resolving the cycle and pausing conflicted tasks...</strong></p>
            <div className="deadlock-spinner"></div>
          </div>
        </div>
      )}

      {/* 3D Canvas */}
      <div className={`simulation-canvas-container ${hasDeadlock ? 'blurred' : ''}`}>
        <Canvas camera={{ position: [CENTER_OFFSET + 10, 20, CENTER_OFFSET + 10], fov: 50 }}>
          <color attach="background" args={['#050510']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[20, 50, 20]} intensity={1} />
          <WarehouseEnvironment />
          {robots.map(r => <RobotModel key={r.id} robot={r} onSelect={setSelectedRobot} />)}
          <OrbitControls target={[CENTER_OFFSET, 0, CENTER_OFFSET]} />
        </Canvas>

        {/* Telemetry Modal Overlay */}
        {selectedRobot && (
          <div className="telemetry-overlay">
            <div className="panel glass telemetry-card">
              <div className="telemetry-header">
                <h3 style={{ color: selectedRobot.color }}>🤖 Robot #{selectedRobot.id}</h3>
                <button className="btn-close-tele" onClick={() => setSelectedRobot(null)}>×</button>
              </div>
              <div className="telemetry-grid">
                <div className="tele-item">
                  <label>Status</label>
                  <span className={`status-${selectedRobot.status.toLowerCase()}`}>{selectedRobot.status}</span>
                </div>
                <div className="tele-item">
                  <label>Position</label>
                  <span>{selectedRobot.x}, {selectedRobot.z}</span>
                </div>
                <div className="tele-item">
                  <label>Task ID</label>
                  <span>{selectedRobot.currentTaskId || 'None'}</span>
                </div>
                <div className="tele-item">
                  <label>Phase</label>
                  <span>{selectedRobot.missionPhase}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Control Terminal - Features TaskManager */}
      <aside className={`sim-terminal ${hasDeadlock ? 'blurred' : ''}`}>
        <div className="panel glass" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <TaskManager 
            tasks={tasks} 
            onTaskAdded={onFetchData} 
          />
        </div>
      </aside>
    </div>
  );
};

export default SimulationView;

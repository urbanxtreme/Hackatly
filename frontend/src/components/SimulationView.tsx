import { useState, useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Line } from '@react-three/drei';
import * as THREE from 'three';
import { GRID_SIZE, STATIC_GRID } from '../utils/grid';
import TaskManager, { type ApiTask } from './TaskManager';
import { completeTask, updateRobotPosition } from '../api';
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

const astar = (start: { x: number; z: number }, goal: { x: number; z: number }, dynamicObstacles: Array<{x: number, z: number}> = []) => {
  let openSet = [start];
  let cameFrom = new Map<string, { x: number; z: number }>();
  let gScore = new Map<string, number>();
  let fScore = new Map<string, number>();

  const toKey = (p: { x: number; z: number }) => `${p.x},${p.z}`;
  gScore.set(toKey(start), 0);
  fScore.set(toKey(start), heuristic(start, goal));

  const isObstacle = (nx: number, nz: number) => {
    return dynamicObstacles.some(obs => obs.x === nx && obs.z === nz);
  };

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
    ].filter(n => n.x >= 0 && n.x < GRID_SIZE && n.z >= 0 && n.z < GRID_SIZE && STATIC_GRID[n.x][n.z] === 0 && !isObstacle(n.x, n.z));

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
  missionPhase: 'IDLE' | 'TO_PICK' | 'TO_DROP' | 'TO_WAIT' | 'FINISHING' | 'FAILED';
  status: 'IDLE' | 'MOVING' | 'BLOCKED' | 'DONE';
  path: { x: number; z: number }[];
  pathIndex: number;
  payloadVisible: boolean;
  missionData: { px: string, pz: string, dx: string, dz: string };
  currentTaskId?: string;
  metrics: { queuedTicks: number; blockedTicks: number; activeTicks: number; };
  consecutiveBlocks: number;
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
  const [physicalDeadlockTime, setPhysicalDeadlockTime] = useState<number | null>(null);
  
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
            missionData: { px: '', pz: '', dx: '', dz: '' },
            metrics: { queuedTicks: 0, blockedTicks: 0, activeTicks: 0 },
            consecutiveBlocks: 0
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

  /* ─── API Side Effects (Isolated from State Updaters) ─── */
  const apiCallInProgress = useRef(new Set<number>());
  useEffect(() => {
    robots.forEach(bot => {
      if (bot.missionPhase === 'FINISHING' && bot.currentTaskId && !apiCallInProgress.current.has(bot.id)) {
        apiCallInProgress.current.add(bot.id);
        const tid = bot.currentTaskId;
        setCompletedTaskIds(prev => new Set(prev).add(tid));
                
        // Execute API Calls
        Promise.allSettled([
          completeTask(tid),
          updateRobotPosition(bot.id, bot.x, bot.z)
        ]).then(() => {
          setRobots(prev => prev.map(r => r.id === bot.id ? { 
            ...r, 
            status: 'DONE', 
            missionPhase: 'IDLE', 
            payloadVisible: false, 
            currentTaskId: undefined,
            consecutiveBlocks: 0 
          } : r));
          apiCallInProgress.current.delete(bot.id);
        });
      }
    });
  }, [robots]);

  /* ─── Backend Integration & Live Task Assignment ─── */
  useEffect(() => {
    // 1. Detect deadlock or failure states
    const isDeadlocked = tasks.some(t => t.status === 'waiting');
    setHasDeadlock(isDeadlocked);

    // 2. Reconcile: if backend has marked a task as 'failed' or 'completed',
    //    but a robot in the simulation is still working on it → reset that robot
    setRobots(prev => {
      let updatedList = [...prev];
      let hasChanges = false;

      for (let i = 0; i < updatedList.length; i++) {
        const bot = updatedList[i];
        if (!bot.currentTaskId) continue;

        const backendTask = tasks.find(t => t.task_id === bot.currentTaskId);
        if (!backendTask) continue;

        if (backendTask.status === 'failed' || backendTask.status === 'completed') {
          // Reset this robot — the backend killed/completed the task
          updatedList[i] = {
            ...bot,
            status: 'DONE' as const,
            missionPhase: 'IDLE' as const,
            payloadVisible: false,
            currentTaskId: undefined,
            path: [],
            pathIndex: 0,
          };
          setCompletedTaskIds(prev => new Set(prev).add(backendTask.task_id));
          hasChanges = true;
          console.log(`[SimulationView] Robot #${bot.id} reset: task ${backendTask.task_id} is ${backendTask.status}`);
        }
      }

      // 3. Assign unassigned 'in_progress' or 'pending' tasks to IDLE robots
      const activeBackendTasks = tasks.filter(t => 
        (t.status === 'in_progress' || t.status === 'pending') && 
        !completedTaskIds.has(t.task_id)
      );
      
      for (const backendTask of activeBackendTasks) {
        if (updatedList.some(r => r.currentTaskId === backendTask.task_id)) continue;

        const availableBots = updatedList.filter(r => r.status === 'IDLE' || r.status === 'DONE');
        if (availableBots.length > 0) {
          const px = backendTask.get_x;
          const pz = backendTask.get_y;
          
          let nearestBot = availableBots[0];
          let minDistance = Infinity;
          
          for (const bot of availableBots) {
            const dist = heuristic({x: bot.x, z: bot.z}, {x: px, z: pz});
            if (dist < minDistance) {
              minDistance = dist;
              nearestBot = bot;
            }
          }

          const idleBotIndex = updatedList.findIndex(r => r.id === nearestBot.id);
          const bot = updatedList[idleBotIndex];
          const dx = backendTask.put_x;
          const dz = backendTask.put_y;

          const testPath = astar({ x: bot.x, z: bot.z }, { x: px, z: pz });
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
          }
        }
      }
      return hasChanges ? updatedList : prev;
    });
  }, [tasks, completedTaskIds]);

  /* ─── Queue Delay Tracking (While API Resolves Deadlocks) ─── */
  useEffect(() => {
    if (!hasDeadlock) return;
    const timer = setInterval(() => {
      setRobots(prev => prev.map(bot => ({
        ...bot,
        metrics: { ...bot.metrics, queuedTicks: bot.metrics.queuedTicks + 1 }
      })));
    }, TICK_INTERVAL);
    return () => clearInterval(timer);
  }, [hasDeadlock]);

  /* ─── Simulation Tick Engine ─── */
  useEffect(() => {
    if (hasDeadlock) return;

    const timer = setInterval(() => {
      // Manage 10-second Physical Deadlock Freeze
      setPhysicalDeadlockTime(prevTime => {
        if (prevTime !== null) {
          if (prevTime <= 0) {
             // Freeze ends — bots will dynamically repath on their next tick
             return null; 
          }
          return prevTime - (TICK_INTERVAL / 1000);
        }
        return null;
      });

      setRobots(prev => {
        // If we are actively frozen, don't move bots
        let isFrozen = false;
        setPhysicalDeadlockTime(time => {
          isFrozen = time !== null && time > 0;
          return time;
        });
        if (isFrozen) return prev;

        let needsUpdate = false;
        
        // 1. Detect physical head-to-head blockages
        const blockedBy = new Map<number, number>();
        prev.forEach(bot => {
          if (bot.pathIndex < bot.path.length && (bot.status === 'MOVING' || bot.status === 'BLOCKED')) {
            const nextStep = bot.path[bot.pathIndex];
            const blockingBot = prev.find(r => r.id !== bot.id && r.x === nextStep.x && r.z === nextStep.z);
            if (blockingBot) {
              blockedBy.set(bot.id, blockingBot.id);
            }
          }
        });

        // 2. Cycle detection across the wait-for graph
        let newDeadlock = false;
        for (const startId of blockedBy.keys()) {
          let currentId = startId;
          const visited = new Set<number>();
          while (blockedBy.has(currentId)) {
             visited.add(currentId);
             currentId = blockedBy.get(currentId)!;
             if (visited.has(currentId)) {
                // Cycle detected
                const cycleBots = Array.from(visited);
                // Only trigger freeze if AT LEAST ONE bot in the cycle hasn't been frozen yet
                if (cycleBots.some(id => {
                  const bot = prev.find(r => r.id === id);
                  return bot && (bot.consecutiveBlocks || 0) < 5;
                })) {
                    newDeadlock = true;
                }
                break;
             }
          }
        }

        if (newDeadlock) {
          setPhysicalDeadlockTime(prevTime => prevTime === null ? 10 : prevTime);
          return prev.map(bot => blockedBy.has(bot.id) ? { ...bot, status: 'BLOCKED' as const, consecutiveBlocks: 5 /* primed to repath on unfreeze */ } : bot);
        }

        const nextFleet = prev.map(bot => {
          if (bot.status !== 'MOVING' && bot.status !== 'BLOCKED') return bot;

          let m = { ...bot.metrics };
          if (bot.status === 'MOVING') m.activeTicks += 1;
          if (bot.status === 'BLOCKED') m.blockedTicks += 1;

          if (bot.pathIndex < bot.path.length) {
            const nextStep = bot.path[bot.pathIndex];
            const occupied = prev.some(r => r.id !== bot.id && r.x === nextStep.x && r.z === nextStep.z);
            
            if (occupied) {
              const blocks = (bot.consecutiveBlocks || 0) + 1;
              if (blocks > 4) {
                // Dynamic Repathing! Calculate around existing standing robots
                const obstacles = prev.filter(r => r.id !== bot.id).map(r => ({x: r.x, z: r.z}));
                const target = bot.path[bot.path.length - 1]; 
                const newPath = astar({x: bot.x, z: bot.z}, target, obstacles);
                if (newPath.length > 0) {
                  return { ...bot, path: newPath, pathIndex: 1, status: 'MOVING' as const, metrics: m, consecutiveBlocks: 0 };
                }
              }
              if (bot.status !== 'BLOCKED') needsUpdate = true;
              return { ...bot, status: 'BLOCKED' as const, metrics: m, consecutiveBlocks: blocks };
            } else {
              needsUpdate = true;
              return { ...bot, x: nextStep.x, z: nextStep.z, pathIndex: bot.pathIndex + 1, status: 'MOVING' as const, metrics: m, consecutiveBlocks: 0 };
            }
          } else {
            needsUpdate = true;
            if (bot.missionPhase === 'TO_PICK') {
              const nextPath = astar({ x: bot.x, z: bot.z }, { x: parseInt(bot.missionData.dx), z: parseInt(bot.missionData.dz) });
              return { ...bot, path: nextPath, pathIndex: 1, missionPhase: 'TO_DROP' as const, payloadVisible: true, metrics: m, consecutiveBlocks: 0 };
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
              return { ...bot, path: nextPath, pathIndex: 1, missionPhase: 'TO_WAIT' as const, payloadVisible: false, metrics: m, consecutiveBlocks: 0 };
            } else if (bot.missionPhase === 'TO_WAIT') {
              return { ...bot, missionPhase: 'FINISHING' as const, status: 'IDLE' as const, metrics: m, consecutiveBlocks: 0 };
            } else {
              return bot; // Already finishing or idle
            }
          }
        });
        return needsUpdate ? nextFleet : prev;
      });
    }, TICK_INTERVAL);

    return () => clearInterval(timer);
  }, [hasDeadlock]);

  const failedTasks = tasks.filter(t => t.status === 'failed');

  return (
    <div className="simulation-view">
      {/* ─── Physical Deadlock Overlay ─── */}
      {physicalDeadlockTime !== null && physicalDeadlockTime > 0 && (
        <div className="deadlock-overlay" style={{ background: 'rgba(255, 0, 0, 0.7)' }}>
          <div className="deadlock-warning" style={{ border: '3px solid #fff' }}>
            <h1>⚠️ PHYSICAL COLLISION PREVENTED</h1>
            <p>Robots are attempting to occupy the same space in the aisles.</p>
            <p><strong>Freezing fleet to calculate evasion routes...</strong></p>
            <h2 style={{ fontSize: '3rem', margin: '20px 0' }}>{Math.ceil(physicalDeadlockTime)}s</h2>
          </div>
        </div>
      )}

      {/* ─── Backend Deadlock Overlay ─── */}
      {hasDeadlock && !physicalDeadlockTime && (
        <div className="deadlock-overlay">
          <div className="deadlock-warning">
            <h1>CRITICAL DEADLOCK DETECTED!</h1>
            <p>Multiple robots are attempting to claim intersecting paths.</p>
            <p><strong>RoboFlow API is resolving the cycle and pausing conflicted tasks...</strong></p>
            <div className="deadlock-spinner"></div>
          </div>
        </div>
      )}

      {/* ─── Failed Task Warning Banner ─── */}
      {failedTasks.length > 0 && !hasDeadlock && !physicalDeadlockTime && (
        <div className="failed-task-banner">
          ⚠️ {failedTasks.length} task(s) failed — path conflict or unreachable destination. Robot(s) have been stopped.
        </div>
      )}


      <div className={`simulation-canvas-container ${hasDeadlock || physicalDeadlockTime ? 'blurred' : ''}`}>
        <Canvas camera={{ position: [CENTER_OFFSET + 10, 20, CENTER_OFFSET + 10], fov: 50 }}>
          <color attach="background" args={['#050510']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[20, 50, 20]} intensity={1} />
          <WarehouseEnvironment />
          {robots.map(r => <RobotModel key={r.id} robot={r} onSelect={setSelectedRobot} />)}
          <OrbitControls target={[CENTER_OFFSET, 0, CENTER_OFFSET]} />
        </Canvas>

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
                <div className="tele-item" style={{ borderTop: '1px solid #444', paddingTop: '5px' }}>
                  <label style={{ color: '#00cc66' }}>Active Time</label>
                  <span>{(selectedRobot.metrics.activeTicks * 0.25).toFixed(1)}s</span>
                </div>
                <div className="tele-item">
                  <label style={{ color: '#ffcc00' }}>Queue Delay</label>
                  <span>{(selectedRobot.metrics.queuedTicks * 0.25).toFixed(1)}s</span>
                </div>
                <div className="tele-item">
                  <label style={{ color: '#ff3333' }}>Traffic Delay</label>
                  <span>{(selectedRobot.metrics.blockedTicks * 0.25).toFixed(1)}s</span>
                </div>
                <div className="tele-item">
                  <label style={{ color: '#00aaff', fontWeight: 'bold' }}>Efficiency</label>
                  <span style={{ fontWeight: 'bold' }}>{(() => {
                    const m = selectedRobot.metrics;
                    const total = m.activeTicks + m.queuedTicks + m.blockedTicks;
                    if (total === 0) return '100%';
                    return ((m.activeTicks / total) * 100).toFixed(1) + '%';
                  })()}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <aside className={`sim-terminal ${hasDeadlock ? 'blurred' : ''}`}>
        <div className="panel glass" style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '15px', padding: '15px' }}>
          <div className="sim-panel-title" style={{ fontSize: '1rem' }}>Global <span>Efficiency</span></div>
          <div style={{ textAlign: 'center', margin: '5px 0' }}>
            <span style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#00aaff', textShadow: '0 0 10px rgba(0,170,255,0.5)' }}>
              {(() => {
                let act = 0, q = 0, blk = 0;
                robots.forEach(r => { act += r.metrics.activeTicks; q += r.metrics.queuedTicks; blk += r.metrics.blockedTicks; });
                const tot = act + q + blk;
                return tot === 0 ? '100.0%' : ((act / tot) * 100).toFixed(1) + '%';
              })()}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 'bold', opacity: 0.8, borderTop: '1px solid #333', paddingTop: '10px' }}>
            <span style={{ color: '#00cc66' }}>Active: {robots.reduce((s, r) => s + r.metrics.activeTicks, 0)}ticks</span>
            <span style={{ color: '#ffcc00' }}>Wait: {robots.reduce((s, r) => s + r.metrics.queuedTicks, 0)}ticks</span>
            <span style={{ color: '#ff3333' }}>Jams: {robots.reduce((s, r) => s + r.metrics.blockedTicks, 0)}ticks</span>
          </div>
        </div>

        <div className="panel glass" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <TaskManager 
            tasks={tasks} 
            onTaskAdded={onFetchData} 
            onTaskDeleted={onFetchData}
          />
        </div>
      </aside>
    </div>
  );
};

export default SimulationView;

import { useState, useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import { GRID_SIZE, STATIC_GRID } from '../utils/grid';
import TaskManager, { type ApiTask } from './TaskManager';
import { completeTask, updateRobotPosition, addLog, addEfficiency, addExperience, getMap, updateRobotState, updateRobotTask } from '../api';
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

const astar = (start: { x: number; z: number }, goal: { x: number; z: number }, dynamicObstacles: Array<{ x: number, z: number }> = [], grid: number[][] = []) => {
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
    ].filter(n => {
      const isWithinBounds = n.x >= 0 && n.x < GRID_SIZE && n.z >= 0 && n.z < GRID_SIZE;
      if (!isWithinBounds) return false;
      const cellVal = (grid && grid.length > 0) ? grid[n.x][n.z] : STATIC_GRID[n.x][n.z];
      return cellVal === 0 && !isObstacle(n.x, n.z);
    });

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
  metrics: { queuedTicks: number; blockedTicks: number; activeTicks: number; reroutePenalties: number; };
  consecutiveBlocks: number;
  batteryWarning?: boolean;
  lastLogEvent?: { msg: string; id: number };
}


interface SimulationViewProps {
  apiRobots?: any[];
  tasks?: ApiTask[];
  onFetchData?: () => void;
}

/* ─── 3D Components ─── */
const RobotModel = ({ robot, onSelect, isDeadlocked = false }: { robot: RobotState; onSelect: (r: RobotState) => void; isDeadlocked?: boolean }) => {
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
      <Html position={[0, 1.5, 0]} center style={{ pointerEvents: 'none' }}>
        {isDeadlocked ? (
          <div style={{ backgroundColor: 'rgba(160,0,0,0.95)', padding: '3px 8px', borderRadius: '4px', color: '#fff', fontSize: '11px', fontWeight: 'bold', border: '2px solid #ff2222', whiteSpace: 'nowrap', fontFamily: 'monospace', letterSpacing: '1px' }}>⛔ DEADLOCK</div>
        ) : (
          <div style={{ backgroundColor: 'rgba(0,0,0,0.85)', padding: '2px 6px', borderRadius: '4px', color: '#0f0', fontSize: '12px', fontWeight: 'bold', border: '1px solid rgba(0,255,0,0.5)', whiteSpace: 'nowrap', textShadow: '0 0 5px #0f0', fontFamily: 'monospace' }}>
            Eff: {Math.max(0, Math.min(100, Math.round(100 - (robot.metrics.blockedTicks * 0.5) - ((robot.metrics.reroutePenalties || 0) * 2))))}%
          </div>
        )}
      </Html>
    </group>
  );
};

const WarehouseEnvironment = ({ grid = [] }: { grid: number[][] }) => {
  const racks = useMemo(() => {
    const items: {x: number, z: number}[] = [];
    if (grid.length === 0) {
      // Fallback to legacy hardcoded racks if no grid provided
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
    } else {
      // Use dynamic grid from backend
      grid.forEach((row, x) => {
        row.forEach((val, z) => {
          if (val === 1) items.push({ x, z });
        });
      });
    }
    return items;
  }, [grid]);

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


/* ─── Path Visualization & Conflict Zone Components ─── */
const PathOverlay = ({ robots, mode }: { robots: RobotState[]; mode: 'NORMAL' | 'OPTIMIZED' }) => (
  <>
    {robots.filter(r => r.path.slice(r.pathIndex).length >= 2).map(robot => {
      const pts = robot.path.slice(robot.pathIndex).map(p => new THREE.Vector3(p.x, 0.08, p.z));
      return <Line key={robot.id} points={pts} color={mode === 'NORMAL' ? robot.color : '#00ff88'} lineWidth={mode === 'NORMAL' ? 2.5 : 1.5} opacity={0.75} transparent />;
    })}
  </>
);

const ConflictZones = ({ robots, collisionCells }: { robots: RobotState[]; collisionCells: {x:number,z:number}[] }) => {
  const zones = useMemo(() => {
    const cnt = new Map<string, number>();
    robots.forEach(r => r.path.slice(r.pathIndex).forEach(p => { const k=`${p.x},${p.z}`; cnt.set(k,(cnt.get(k)||0)+1); }));
    const out: {x:number,z:number}[] = [];
    cnt.forEach((n,k) => { if(n>1){const[x,z]=k.split(',').map(Number);out.push({x,z});} });
    return out;
  }, [robots]);
  return (
    <>
      {zones.map((p,i) => (
        <mesh key={`cz${i}`} rotation-x={-Math.PI/2} position={[p.x,0.02,p.z]}>
          <planeGeometry args={[0.95,0.95]} />
          <meshBasicMaterial color="#ff7700" transparent opacity={0.5} />
        </mesh>
      ))}
      {collisionCells.map((p,i) => (
        <mesh key={`cc${i}`} rotation-x={-Math.PI/2} position={[p.x,0.03,p.z]}>
          <planeGeometry args={[0.95,0.95]} />
          <meshBasicMaterial color="#ff0000" transparent opacity={0.75} />
        </mesh>
      ))}
    </>
  );
};

/* ─── Main Simulation Component ─── */
const SimulationView = ({ apiRobots = [], tasks = [], onFetchData = () => { } }: SimulationViewProps) => {

  const [robots, setRobots] = useState<RobotState[]>([]);
  const [grid, setGrid] = useState<number[][]>([]);
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(new Set());

  const [selectedRobot, setSelectedRobot] = useState<RobotState | null>(null);
  const [hasDeadlock, setHasDeadlock] = useState(false);
  const [physicalDeadlockTime, setPhysicalDeadlockTime] = useState<number | null>(null);
  const physicalDeadlockTimeRef = useRef<number | null>(null);
  useEffect(() => { physicalDeadlockTimeRef.current = physicalDeadlockTime; }, [physicalDeadlockTime]);
  
  const [simulationMode, setSimulationMode] = useState<'NORMAL' | 'OPTIMIZED'>('OPTIMIZED');
  const [normalDeadlocks, setNormalDeadlocks] = useState<Set<number>>(new Set());
  const [collisionCells, setCollisionCells] = useState<{x:number,z:number}[]>([]);
  const toggleMode = () => {
    setSimulationMode(m => m === 'NORMAL' ? 'OPTIMIZED' : 'NORMAL');
    setNormalDeadlocks(new Set());
    setCollisionCells([]);
    setRobots(prev => prev.map((r, i) => ({
      ...r,
      x: SPAWN_POINTS[i % SPAWN_POINTS.length].x,
      z: SPAWN_POINTS[i % SPAWN_POINTS.length].z,
      path: [], pathIndex: 0, status: 'IDLE' as const, missionPhase: 'IDLE' as const,
      payloadVisible: false, currentTaskId: undefined,
      metrics: { queuedTicks: 0, blockedTicks: 0, activeTicks: 0, reroutePenalties: 0 },
      consecutiveBlocks: 0,
    })));
  };

  const robotsRef = useRef(robots);
  useEffect(() => { robotsRef.current = robots; }, [robots]);

  /* ─── Fetch Map from Backend ─── */
  useEffect(() => {
    getMap().then(data => {
      if (data && data.map) setGrid(data.map);
    }).catch(err => console.error("SimView: Failed to load map:", err));
  }, []);

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
            metrics: { queuedTicks: 0, blockedTicks: 0, activeTicks: 0, reroutePenalties: 0 },
            consecutiveBlocks: 0,
            batteryWarning: false
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

        const m = bot.metrics;
        const rawEfficiency = 100 - (m.blockedTicks * 0.5) - ((m.reroutePenalties || 0) * 2);
        const finalEfficiency = Math.max(0, Math.min(100, Math.round(rawEfficiency)));

        // Execute API Calls
        Promise.allSettled([
          completeTask(tid),
          updateRobotPosition(bot.id, bot.x, bot.z),
          updateRobotState(bot.id, 'idle'),
          updateRobotTask(bot.id, 'none'),
          addLog(bot.id, `Completed task ${tid} at [${bot.x}, ${bot.z}] with ${finalEfficiency}% efficiency.`),
          addEfficiency(bot.id, finalEfficiency)
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

  /* ─── Log Flushing Effect ─── */
  const lastProcessedLog = useRef<Record<number, number>>({});
  useEffect(() => {
    robots.forEach(bot => {
      if (bot.lastLogEvent && lastProcessedLog.current[bot.id] !== bot.lastLogEvent.id) {
        addLog(bot.id, bot.lastLogEvent.msg);
        lastProcessedLog.current[bot.id] = bot.lastLogEvent.id;
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
            const dist = heuristic({ x: bot.x, z: bot.z }, { x: px, z: pz });
            if (dist < minDistance) {
              minDistance = dist;
              nearestBot = bot;
            }
          }

          const idleBotIndex = updatedList.findIndex(r => r.id === nearestBot.id);
          const bot = updatedList[idleBotIndex];
          const dx = backendTask.put_x;
          const dz = backendTask.put_y;

          const testPath = astar({ x: bot.x, z: bot.z }, { x: px, z: pz }, [], grid);
          if (testPath.length > 0) {
            updateRobotState(bot.id, 'active');
            updateRobotTask(bot.id, backendTask.task_id);
            updatedList[idleBotIndex] = {
              ...bot,
              currentTaskId: backendTask.task_id,
              path: testPath,
              pathIndex: 1,
              status: 'MOVING',
              missionPhase: 'TO_PICK',
              payloadVisible: false,
              missionData: { px: String(px), pz: String(pz), dx: String(dx), dz: String(dz) },
              lastLogEvent: { msg: `Assigned task ${backendTask.task_id}: Moving from [${bot.x}, ${bot.z}] to pick at [${px}, ${pz}]`, id: Date.now() + Math.random() }
            };
            hasChanges = true;
          }
        }
      }
      return hasChanges ? updatedList : prev;
    });
  }, [tasks, completedTaskIds, grid]);

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
  }, [hasDeadlock, simulationMode]);

  /* ─── Normal Mode Tick Engine (Naive A* — Industry Standard, No Coordination) ─── */
  useEffect(() => {
    if (simulationMode !== 'NORMAL') return;
    const timer = setInterval(() => {
      setRobots(prev => {
        // Phase transitions (same as optimized but no conflict checks)
        const afterPhase = prev.map(bot => {
          if ((bot.status !== 'MOVING' && bot.status !== 'BLOCKED') || bot.pathIndex < bot.path.length) return bot;
          const m = { ...bot.metrics };
          if (bot.missionPhase === 'TO_PICK') {
            const np = astar({ x: bot.x, z: bot.z }, { x: parseInt(bot.missionData.dx), z: parseInt(bot.missionData.dz) }, [], grid);
            return { ...bot, path: np, pathIndex: 1, missionPhase: 'TO_DROP' as const, payloadVisible: true, metrics: m };
          } else if (bot.missionPhase === 'TO_DROP') {
            return { ...bot, missionPhase: 'FINISHING' as const, status: 'IDLE' as const, payloadVisible: false, metrics: m };
          }
          return bot;
        });

        // Build intended next moves (naive — no obstacle awareness)
        const moves = new Map<number, {x:number,z:number}>();
        afterPhase.forEach(bot => {
          if ((bot.status === 'MOVING' || bot.status === 'BLOCKED') && bot.pathIndex < bot.path.length)
            moves.set(bot.id, bot.path[bot.pathIndex]);
        });

        // Detect swap deadlocks (head-to-head: A→B's cell, B→A's cell)
        const frozenIds = new Set<number>();
        moves.forEach((posA, idA) => {
          const botA = afterPhase.find(b => b.id === idA)!;
          moves.forEach((posB, idB) => {
            if (idA >= idB) return;
            const botB = afterPhase.find(b => b.id === idB)!;
            if (posA.x === botB.x && posA.z === botB.z && posB.x === botA.x && posB.z === botA.z) {
              frozenIds.add(idA); frozenIds.add(idB);
            }
          });
        });

        // Detect same-cell collisions (two bots targeting same cell)
        const cellTargets = new Map<string, number[]>();
        moves.forEach((pos, id) => {
          if (frozenIds.has(id)) return;
          const k = `${pos.x},${pos.z}`;
          if (!cellTargets.has(k)) cellTargets.set(k, []);
          cellTargets.get(k)!.push(id);
        });
        const colCells: {x:number,z:number}[] = [];
        cellTargets.forEach((ids, k) => {
          if (ids.length > 1) { const [x,z]=k.split(',').map(Number); colCells.push({x,z}); }
        });

        const newDeadlocks = new Set<number>(frozenIds);
        setNormalDeadlocks(newDeadlocks);
        setCollisionCells(colCells);

        // Apply moves naively — no rerouting, robots just freeze on deadlock
        return afterPhase.map(bot => {
          if (bot.status !== 'MOVING' && bot.status !== 'BLOCKED') return bot;
          const m = { ...bot.metrics, activeTicks: bot.metrics.activeTicks + 1 };
          if (frozenIds.has(bot.id)) {
            return { ...bot, status: 'BLOCKED' as const, metrics: { ...m, blockedTicks: m.blockedTicks + 1 } };
          }
          if (bot.pathIndex < bot.path.length) {
            const ns = bot.path[bot.pathIndex];
            return { ...bot, x: ns.x, z: ns.z, pathIndex: bot.pathIndex + 1, status: 'MOVING' as const, metrics: m, consecutiveBlocks: 0 };
          }
          return bot;
        });
      });
    }, TICK_INTERVAL);
    return () => clearInterval(timer);
  }, [simulationMode, grid]);

  /* ─── Optimized Simulation Tick Engine (RoboFlow Middleware Active) ─── */
  useEffect(() => {
    if (hasDeadlock || simulationMode !== 'OPTIMIZED') return;

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
        if (physicalDeadlockTimeRef.current !== null && physicalDeadlockTimeRef.current > 0) {
          return prev;
        }

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

        // 3. Detect "Target Blocked by Idle" deadlocks
        let targetBlockedDeadlock = false;
        const idleBlockers = new Set<number>();
        const blockedByIdle = new Set<number>();

        prev.forEach(bot => {
          if (bot.status === 'BLOCKED' && bot.path.length > 0) {
            const target = bot.path[bot.path.length - 1];
            const blockingIdle = prev.find(r => r.id !== bot.id && r.x === target.x && r.z === target.z && (r.status === 'IDLE' || r.status === 'DONE'));
            if (blockingIdle && (bot.consecutiveBlocks || 0) > 4) {
              targetBlockedDeadlock = true;
              idleBlockers.add(blockingIdle.id);
              blockedByIdle.add(bot.id);
            }
          }
        });

        if (newDeadlock || targetBlockedDeadlock) {
          setPhysicalDeadlockTime(prevTime => prevTime === null ? 10 : prevTime);
          return prev.map(bot => {
            if (idleBlockers.has(bot.id)) {
              // Wake up the idle bot and assign a new waitTarget so it moves out of the way!
              const findWait = () => {
                const offsets = [{ dx: 2, dz: 0 }, { dx: -2, dz: 0 }, { dx: 0, dz: 2 }, { dx: 0, dz: -2 }, { dx: 2, dz: 2 }, { dx: -2, dz: -2 }];
                for (let o of offsets) {
                  const wx = bot.x + o.dx, wz = bot.z + o.dz;
                  const occupied = prev.some(r => r.x === wx && r.z === wz);
                  if (wx >= 0 && wx < GRID_SIZE && wz >= 0 && wz < GRID_SIZE && STATIC_GRID[wx][wz] === 0 && !occupied) return { x: wx, z: wz };
                }
                return { x: bot.x, z: bot.z };
              };
              const wt = findWait();
              const wtPath = astar({ x: bot.x, z: bot.z }, wt, [], grid);
              return { ...bot, missionPhase: 'TO_WAIT' as const, status: 'BLOCKED' as const, path: wtPath, pathIndex: 1, consecutiveBlocks: 5, lastLogEvent: { msg: `Target blocked by parking! Evicting IDLE robot to dynamically assigned location [${wt.x}, ${wt.z}]`, id: Date.now() + Math.random() } };
            }
            if (blockedBy.has(bot.id) || blockedByIdle.has(bot.id)) {
              return { ...bot, status: 'BLOCKED' as const, consecutiveBlocks: 5 };
            }
            return bot;
          });
        }

        const nextFleet = prev.map(bot => {
          if (bot.status !== 'MOVING' && bot.status !== 'BLOCKED') return bot;

          // --- ML Telemetry: State Serialization ---
          const stateArray = [bot.x, bot.z, parseInt(bot.missionData.dx || '0'), parseInt(bot.missionData.dz || '0')];
          const offsets = [{ dx: -1, dz: -1 }, { dx: 0, dz: -1 }, { dx: 1, dz: -1 }, { dx: -1, dz: 0 }, { dx: 0, dz: 0 }, { dx: 1, dz: 0 }, { dx: -1, dz: 1 }, { dx: 0, dz: 1 }, { dx: 1, dz: 1 }];
          for (const o of offsets) {
            const wx = bot.x + o.dx, wz = bot.z + o.dz;
            let val = 0; // Empty
            if (wx < 0 || wx >= GRID_SIZE || wz < 0 || wz >= GRID_SIZE || STATIC_GRID[wx][wz] === 1) val = 1; // Wall
            if (prev.some(r => r.id !== bot.id && r.x === wx && r.z === wz)) val = 2; // Other Robot
            stateArray.push(val);
          }
          let mlAction = 0; // 0=WAIT, 1=UP, 2=DOWN, 3=LEFT, 4=RIGHT
          let mlReward = -1; // Standard step penalty
          const fireTuple = (act: number, rew: number, metric: any) => {
            if (bot.currentTaskId) {
              const eff = Math.max(0, 100 - (metric.blockedTicks * 0.5) - ((metric.reroutePenalties || 0) * 2));
              console.log(`[ML Sensor] Bot ${bot.id} | Action: ${act} | Reward: ${rew} | Eff: ${eff}% | State Array:`, stateArray);
              
              addExperience(bot.id, stateArray, act, rew, eff).catch(() => { });
            }
          };
          // -----------------------------------------

          let m = { ...bot.metrics };
          let bWarn = bot.batteryWarning;
          let logEvt = bot.lastLogEvent;
          if (bot.status === 'MOVING') {
            m.activeTicks += 1;
            if (m.activeTicks > 0 && m.activeTicks % 600 === 0 && !bWarn) {
              logEvt = { msg: `CRITICAL: Battery level is empty! Proceeding to finishing checkpoint.`, id: Date.now() + Math.random() };
              bWarn = true;
            }
          }
          if (bot.status === 'BLOCKED') m.blockedTicks += 1;

          if (bot.pathIndex < bot.path.length) {
            const nextStep = bot.path[bot.pathIndex];

            if (nextStep.z < bot.z) mlAction = 1;
            else if (nextStep.z > bot.z) mlAction = 2;
            else if (nextStep.x < bot.x) mlAction = 3;
            else if (nextStep.x > bot.x) mlAction = 4;

            const occupied = prev.some(r => r.id !== bot.id && r.x === nextStep.x && r.z === nextStep.z);

            if (occupied) {
              mlReward = -10; // Obstacle penalty
              mlAction = 0;   // Forced wait
              const blocks = (bot.consecutiveBlocks || 0) + 1;
              if (blocks > 4) {
                // Dynamic Repathing! Calculate around existing standing robots
                const obstacles = prev.filter(r => r.id !== bot.id).map(r => ({ x: r.x, z: r.z }));
                const target = bot.path[bot.path.length - 1];
                const newPath = astar({ x: bot.x, z: bot.z }, target, obstacles, grid);
                if (newPath.length > 0) {
                  logEvt = { msg: `Obstacle detected! Rerouting dynamically around [${obstacles[0]?.x}, ${obstacles[0]?.z}]`, id: Date.now() + Math.random() };
                  needsUpdate = true;
                  m.reroutePenalties = (m.reroutePenalties || 0) + 1;
                  fireTuple(mlAction, mlReward, m);
                  return { ...bot, path: newPath, pathIndex: 1, status: 'MOVING' as const, metrics: m, consecutiveBlocks: 0, batteryWarning: bWarn, lastLogEvent: logEvt };
                }
              }
              if (bot.status !== 'BLOCKED') needsUpdate = true;
              fireTuple(mlAction, mlReward, m);
              return { ...bot, status: 'BLOCKED' as const, metrics: m, consecutiveBlocks: blocks, batteryWarning: bWarn, lastLogEvent: logEvt };
            } else {
              needsUpdate = true;
              fireTuple(mlAction, mlReward, m);
              return { ...bot, x: nextStep.x, z: nextStep.z, pathIndex: bot.pathIndex + 1, status: 'MOVING' as const, metrics: m, consecutiveBlocks: 0, batteryWarning: bWarn, lastLogEvent: logEvt };
            }
          } else {
            needsUpdate = true;
            mlReward = +100; // Goal reached / Action complete
            fireTuple(0, mlReward, m);
            if (bot.missionPhase === 'TO_PICK') {
              const nextPath = astar({ x: bot.x, z: bot.z }, { x: parseInt(bot.missionData.dx), z: parseInt(bot.missionData.dz) }, [], grid);
              return { ...bot, path: nextPath, pathIndex: 1, missionPhase: 'TO_DROP' as const, payloadVisible: true, metrics: m, consecutiveBlocks: 0, batteryWarning: bWarn, lastLogEvent: logEvt };
            } else if (bot.missionPhase === 'TO_DROP') {
              const findWait = () => {
                const offsets = [{ dx: 2, dz: 0 }, { dx: -2, dz: 0 }, { dx: 0, dz: 2 }, { dx: 0, dz: -2 }, { dx: 2, dz: 2 }, { dx: -2, dz: -2 }];
                for (let o of offsets) {
                  const wx = bot.x + o.dx, wz = bot.z + o.dz;
                  if (wx >= 0 && wx < GRID_SIZE && wz >= 0 && wz < GRID_SIZE && STATIC_GRID[wx][wz] === 0) return { x: wx, z: wz };
                }
                return { x: bot.x, z: bot.z };
              };
              const waitTarget = findWait();
              const nextPath = astar({ x: bot.x, z: bot.z }, waitTarget, [], grid);
              return { ...bot, path: nextPath, pathIndex: 1, missionPhase: 'TO_WAIT' as const, payloadVisible: false, metrics: m, consecutiveBlocks: 0, batteryWarning: bWarn, lastLogEvent: logEvt };
            } else if (bot.missionPhase === 'TO_WAIT') {
              return { ...bot, missionPhase: 'FINISHING' as const, status: 'IDLE' as const, metrics: m, consecutiveBlocks: 0, batteryWarning: bWarn, lastLogEvent: logEvt };
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
          <WarehouseEnvironment grid={grid} />
          {robots.map(r => <RobotModel key={r.id} robot={r} onSelect={setSelectedRobot} isDeadlocked={normalDeadlocks.has(r.id)} />)}
          <PathOverlay robots={robots} mode={simulationMode} />
          {simulationMode === 'NORMAL' && <ConflictZones robots={robots} collisionCells={collisionCells} />}
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

      <aside className={`sim-terminal ${hasDeadlock && simulationMode === 'OPTIMIZED' ? 'blurred' : ''}`}>
        {/* ─── Mode Toggle ─── */}
        <div className="panel glass mode-toggle-panel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)' }}>Simulation Mode</span>
          </div>
          <button onClick={toggleMode} className={`mode-toggle-btn ${simulationMode === 'NORMAL' ? 'mode-normal' : 'mode-optimized'}`}>
            <span className="mode-indicator" />
            {simulationMode === 'NORMAL' ? '🔴 NAIVE MODE — A* Only (No Coordination)' : '🟢 OPTIMIZED — RoboFlow Middleware Active'}
          </button>
          {simulationMode === 'NORMAL' && (
            <div style={{ marginTop: '8px', fontSize: '0.72rem', color: '#ff8844', lineHeight: 1.5 }}>
              <b>⚠ Collision risks visible.</b> Amber = path conflict zone. Red = collision. Robots freeze on deadlock — no resolution.
            </div>
          )}
          {simulationMode === 'OPTIMIZED' && (
            <div style={{ marginTop: '8px', fontSize: '0.72rem', color: '#00cc88', lineHeight: 1.5 }}>
              <b>✓ Middleware active.</b> Reservation table + DFS cycle detection + priority scheduling prevents conflicts.
            </div>
          )}
        </div>
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

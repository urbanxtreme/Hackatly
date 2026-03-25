import { useState, useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import { GRID_SIZE, STATIC_GRID } from '../utils/grid';
import TaskManager, { type ApiTask } from './TaskManager';
import { completeTask, updateRobotPosition, addLog, addEfficiency, addExperience, updateRobotState, updateRobotTask } from '../api';
import './SimulationView.css';

/* ─── Simulation Configuration ─── */
const CENTER_OFFSET = (GRID_SIZE - 1) / 2;
const TICK_INTERVAL = 250;
const ROBOT_COLORS = [0xff2222, 0xffaa00, 0x00cc22, 0x00aaff, 0x9900ff, 0x333333];


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
      // ── Soft Obstacles: Do not strictly reject cells occupied by other robots ──
      // Racks/walls are still rejected (cellVal === 0)
      return cellVal === 0;
    });

    for (const n of neighbors) {
      // Add a heavy penalty cost to cells occupied by other robots to encourage going around
      const cost = isObstacle(n.x, n.z) ? 50 : 1;
      const tentativeGScore = (gScore.get(toKey(current)) ?? Infinity) + cost;
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
  apiGrid?: number[][];
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

const OFFLINE_MODE = false;
const MOCK_ROBOTS: any[] = [];
const MOCK_TASKS: any[] = [];

/* ─── Main Simulation Component ─── */
const SimulationView = ({ apiRobots = [], tasks = [], onFetchData = () => { }, apiGrid }: SimulationViewProps) => {
  const activeApiRobots = OFFLINE_MODE && apiRobots.length === 0 ? MOCK_ROBOTS : apiRobots;
  const activeTasks = OFFLINE_MODE && tasks.length === 0 ? MOCK_TASKS : tasks;
  const currentGrid = apiGrid && apiGrid.length > 0 ? apiGrid : STATIC_GRID;


  const [robots, setRobots] = useState<RobotState[]>([]);
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(new Set());

  const [selectedRobot, setSelectedRobot] = useState<RobotState | null>(null);
  const [hasDeadlock, setHasDeadlock] = useState(false);
  const [simulationMode, setSimulationMode] = useState<'NORMAL' | 'OPTIMIZED'>('OPTIMIZED');
  const [normalDeadlocks, setNormalDeadlocks] = useState<Set<number>>(new Set());
  const [collisionCells, setCollisionCells] = useState<{x:number,z:number}[]>([]);
  // Optimized mode conflict cells: [amber=path-overlap, red=yield/swap resolution]
  const [optimizedConflictCells, setOptimizedConflictCells] = useState<{x:number,z:number}[]>([]);
  const [optimizedDeadlocks, setOptimizedDeadlocks] = useState<Set<number>>(new Set());
  const toggleMode = () => {
    // ── Full State Reset Before Mode Switch ──
    // Clear ALL stale state from the previous mode so the new engine
    // starts completely fresh with no BLOCKED/deadlock residue.
    setNormalDeadlocks(new Set());
    setCollisionCells([]);
    setHasDeadlock(false);
    setCompletedTaskIds(new Set()); // Allow tasks to be re-assigned by new engine

    setRobots(prev => {
      const nextFleet: RobotState[] = [];
      const traversableCells: {x: number, z: number}[] = [];
      for(let x=0; x<GRID_SIZE; x++) {
        for(let z=0; z<GRID_SIZE; z++) {
          if(currentGrid[x][z] === 0) traversableCells.push({x, z});
        }
      }

      prev.forEach((r, i) => {
        const available = traversableCells.filter(c => !nextFleet.some(nb => nb.x === c.x && nb.z === c.z));
        const cell = available[Math.floor((i / prev.length) * available.length)] || {x:1, z:1};

        nextFleet.push({
          ...r,
          x: cell.x,
          z: cell.z,
          // Reset ALL movement/conflict state
          path: [],
          pathIndex: 0,
          status: 'IDLE' as const,
          missionPhase: 'IDLE' as const,
          payloadVisible: false,
          currentTaskId: undefined,
          consecutiveBlocks: 0,
          batteryWarning: false,
          lastLogEvent: undefined,
          metrics: { queuedTicks: 0, blockedTicks: 0, activeTicks: 0, reroutePenalties: 0 },
        });
      });
      return nextFleet;
    });

    // Switch the mode AFTER state is cleared
    setSimulationMode(m => m === 'NORMAL' ? 'OPTIMIZED' : 'NORMAL');
  };

  const robotsRef = useRef(robots);
  useEffect(() => { robotsRef.current = robots; }, [robots]);

  /* ─── Fetch Map from Backend ─── */


  useEffect(() => {
    setRobots(prev => {
      const newFleet = [...prev];
      let hasChanges = false;

      activeApiRobots.forEach((apiBot, index) => {
        const existing = prev.find(r => r.id === apiBot.id);
        if (!existing) {
          // ── SMART PLACEMENT: Search for first available floor tile (distributed) ──
          let startPos = { x: 1, z: 1 };
          let found = false;
          
          // Try to find a cell that matches the hash of the robot name/id for stable distribution
          const offset = (apiBot.id * 17) % 50; 
          for (let i = 0; i < GRID_SIZE * GRID_SIZE && !found; i++) {
            const idx = (i + offset) % (GRID_SIZE * GRID_SIZE);
            const x = Math.floor(idx / GRID_SIZE);
            const z = idx % GRID_SIZE;
            if (currentGrid[x][z] === 0 && !newFleet.some(r => r.x === x && r.z === z)) {
              startPos = { x, z };
              found = true;
            }
          }

          newFleet.push({
            id: apiBot.id,
            x: startPos.x,
            z: startPos.z,
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
            path: [],
            pathIndex: 0,
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
    const isDeadlocked = tasks.some(t => t.status === 'waiting') || robots.some(r => r.consecutiveBlocks > 20);
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
      const activeBackendTasks = activeTasks.filter(t =>
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

          const testPath = astar({ x: bot.x, z: bot.z }, { x: px, z: pz }, [], currentGrid);
          if (testPath.length > 0) {
            console.log(`[Task Assignment] Assigning Task ${backendTask.task_id} to Bot #${bot.id}`);
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
          } else {
            console.warn(`[Task Assignment] FAILED: Task ${backendTask.task_id} unreachable at [${px}, ${pz}]. Check for obstacles.`);
          }
        }
      }
      return hasChanges ? updatedList : prev;
    });
  }, [tasks, completedTaskIds, currentGrid, robots]);

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
            const np = astar({ x: bot.x, z: bot.z }, { x: parseInt(bot.missionData.dx), z: parseInt(bot.missionData.dz) }, [], currentGrid);
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

        // Detect same-cell collisions (two bots targeting same empty cell)
        const cellTargets = new Map<string, number[]>();
        moves.forEach((pos, id) => {
          if (frozenIds.has(id)) return;
          const k = `${pos.x},${pos.z}`;
          if (!cellTargets.has(k)) cellTargets.set(k, []);
          cellTargets.get(k)!.push(id);
        });
        const colCells: {x:number,z:number}[] = [];
        cellTargets.forEach((ids, k) => {
          if (ids.length > 1) { 
            const [x,z]=k.split(',').map(Number); colCells.push({x,z});
            ids.forEach(id => frozenIds.add(id)); // Both crash and get stuck
          }
        });

        // Naive physical blocker detection (trying to step on an occupied cell)
        moves.forEach((posA, idA) => {
           if (frozenIds.has(idA)) return;
           const blockingBot = afterPhase.find(b => b.id !== idA && b.x === posA.x && b.z === posA.z);
           if (blockingBot) {
              // The cell is physically occupied. Crash/stuck. 
              frozenIds.add(idA);
           }
        });

        const newDeadlocks = new Set<number>(frozenIds);
        setNormalDeadlocks(newDeadlocks);
        setCollisionCells(colCells);

        // Apply moves naively — no rerouting, robots just freeze on deadlock or physical collision
        return afterPhase.map(bot => {
          if (bot.status !== 'MOVING' && bot.status !== 'BLOCKED') return bot;
          let m = { ...bot.metrics };
          
          if (frozenIds.has(bot.id)) {
            m.blockedTicks += 1;
            return { ...bot, status: 'BLOCKED' as const, metrics: m, consecutiveBlocks: (bot.consecutiveBlocks || 0) + 1 };
          }
          
          if (bot.status === 'MOVING') m.activeTicks += 1;
          
          if (bot.pathIndex < bot.path.length) {
            const ns = bot.path[bot.pathIndex];
            return { ...bot, x: ns.x, z: ns.z, pathIndex: bot.pathIndex + 1, status: 'MOVING' as const, metrics: m, consecutiveBlocks: 0 };
          }
          return bot;
        });
      });
    }, TICK_INTERVAL);
    return () => clearInterval(timer);
  }, [simulationMode, currentGrid]);

  /* ─── Optimized Simulation Tick Engine V2 (RoboFlow Middleware Active) ─── */
  useEffect(() => {
    if (simulationMode !== 'OPTIMIZED') return;

    const timer = setInterval(() => {
      setRobots(prev => {
        let needsUpdate = false;

        // ══════════════════════════════════════════════════════════════
        // PHASE 1 — SNAPSHOT & INTENTIONS
        // ══════════════════════════════════════════════════════════════

        // ── 1a: Fix same-cell occupancy (two bots sharing a cell) ──
        const occupancyFixMap = new Map<number, {x:number,z:number}>();
        const occupiedCells = new Set<string>();
        const sorted = [...prev].sort((a, b) => b.id - a.id);
        sorted.forEach(bot => {
          const key = `${bot.x},${bot.z}`;
          if (occupiedCells.has(key)) {
            const offsets = [{dx:1,dz:0},{dx:-1,dz:0},{dx:0,dz:1},{dx:0,dz:-1},{dx:1,dz:1},{dx:-1,dz:1},{dx:1,dz:-1},{dx:-1,dz:-1}];
            for (const o of offsets) {
              const nx = bot.x + o.dx, nz = bot.z + o.dz;
              const nkey = `${nx},${nz}`;
              if (nx >= 0 && nx < GRID_SIZE && nz >= 0 && nz < GRID_SIZE && currentGrid[nx][nz] === 0 && !occupiedCells.has(nkey)) {
                occupancyFixMap.set(bot.id, {x: nx, z: nz});
                occupiedCells.add(nkey);
                return;
              }
            }
          } else {
            occupiedCells.add(key);
          }
        });

        // ── 1b: Build intended next moves ──
        const intentions = new Map<number, {x:number,z:number}>();
        prev.forEach(bot => {
          if ((bot.status === 'MOVING' || bot.status === 'BLOCKED') && bot.pathIndex < bot.path.length)
            intentions.set(bot.id, bot.path[bot.pathIndex]);
        });

        // ══════════════════════════════════════════════════════════════
        // PHASE 2 — DYNAMIC PRIORITY CALCULATION
        // Priority = closeness-to-goal * 100 + wait-penalty + block-penalty
        // Higher score = higher priority = gets right-of-way
        // ══════════════════════════════════════════════════════════════
        const priority = new Map<number, number>();
        prev.forEach(bot => {
          const remaining = Math.max(0, bot.path.length - bot.pathIndex);
          const closenessScore = remaining > 0 ? (1 / (remaining + 1)) * 100 : 0;
          const waitPenalty = (bot.consecutiveBlocks || 0) * 2;
          const starvationPenalty = bot.metrics.blockedTicks * 0.5;
          priority.set(bot.id, closenessScore + waitPenalty + starvationPenalty);
        });

        // ══════════════════════════════════════════════════════════════
        // PHASE 3 — CONFLICT DETECTION
        // ══════════════════════════════════════════════════════════════
        const yieldIds = new Set<number>();

        // ── 3a: Swap Detection (A↔B head-on) ──
        // If Bot A wants Bot B's cell AND Bot B wants Bot A's cell → swap conflict
        const swapHandled = new Set<string>();
        intentions.forEach((posA, idA) => {
          const botA = prev.find(b => b.id === idA)!;
          intentions.forEach((posB, idB) => {
            if (idA >= idB) return;
            const pairKey = `${Math.min(idA,idB)}-${Math.max(idA,idB)}`;
            if (swapHandled.has(pairKey)) return;
            const botB = prev.find(b => b.id === idB)!;
            // A wants B's position AND B wants A's position
            if (posA.x === botB.x && posA.z === botB.z && posB.x === botA.x && posB.z === botA.z) {
              swapHandled.add(pairKey);
              // Lower priority yields
              const priA = priority.get(idA) || 0;
              const priB = priority.get(idB) || 0;
              yieldIds.add(priA < priB ? idA : idB);
            }
          });
        });

        // ── 3b: Wait-For Graph & Cycle Detection (A→B→C→A) ──
        const blockedBy = new Map<number, number>();
        intentions.forEach((pos, id) => {
          if (yieldIds.has(id)) return;
          const blocker = prev.find(r => r.id !== id && r.x === pos.x && r.z === pos.z);
          if (blocker) blockedBy.set(id, blocker.id);
        });
        const inCycle = new Set<number>();
        blockedBy.forEach((_, startId) => {
          let cur = startId;
          const visited = new Map<number, number>();
          let step = 0;
          while (blockedBy.has(cur) && !visited.has(cur)) {
            visited.set(cur, step++);
            cur = blockedBy.get(cur)!;
          }
          if (visited.has(cur)) {
            let cycleNode = cur;
            do {
              inCycle.add(cycleNode);
              cycleNode = blockedBy.get(cycleNode)!;
            } while (cycleNode !== cur);
          }
        });
        // Cycle resolution: the LOWEST priority bot in the cycle reroutes
        const cycleRerouteIds = new Set<number>();
        if (inCycle.size > 0) {
          const cycleBots = [...inCycle].map(id => prev.find(b => b.id === id)!).filter(Boolean);
          const loser = cycleBots.reduce((worst, b) => 
            (priority.get(b.id) || 0) < (priority.get(worst.id) || 0) ? b : worst, cycleBots[0]);
          cycleBots.forEach(b => { if (b.id !== loser.id) cycleRerouteIds.add(b.id); });
          // Actually the loser should reroute, not everyone else
          cycleRerouteIds.clear();
          cycleRerouteIds.add(loser.id);
        }

        // ── 3c: Same-cell race arbitration (priority-based) ──
        const cellRacers = new Map<string, number[]>();
        intentions.forEach((pos, id) => {
          if (yieldIds.has(id) || cycleRerouteIds.has(id)) return;
          const k = `${pos.x},${pos.z}`;
          if (!cellRacers.has(k)) cellRacers.set(k, []);
          cellRacers.get(k)!.push(id);
        });
        cellRacers.forEach(ids => {
          if (ids.length > 1) {
            // Sort by priority descending — highest priority wins
            ids.sort((a, b) => (priority.get(b) || 0) - (priority.get(a) || 0));
            ids.slice(1).forEach(id => yieldIds.add(id));
          }
        });

        // ── 3d: Immediate idle eviction ──
        const evictIds = new Set<number>();
        prev.forEach(bot => {
          if ((bot.status === 'MOVING' || bot.status === 'BLOCKED') && bot.path.length > 0) {
            const nextStep = bot.pathIndex < bot.path.length ? bot.path[bot.pathIndex] : null;
            const goal = bot.path[bot.path.length - 1];
            const blocker = prev.find(r =>
              r.id !== bot.id &&
              (r.status === 'IDLE' || r.status === 'DONE') &&
              !evictIds.has(r.id) &&
              ((r.x === goal.x && r.z === goal.z) || (nextStep && r.x === nextStep.x && r.z === nextStep.z))
            );
            if (blocker) evictIds.add(blocker.id);
          }
        });

        // ── Emit conflict visualization data ──
        // Red cells = active yield/swap resolution points this tick
        const redCells: {x:number,z:number}[] = [];
        yieldIds.forEach(id => {
          const bot = prev.find(b => b.id === id);
          if (bot && bot.pathIndex < bot.path.length) {
            redCells.push(bot.path[bot.pathIndex]);
          }
        });
        // Badge: bots that are currently BLOCKED in optimized mode
        const blockedInOptimized = new Set<number>(
          prev.filter(b => b.status === 'BLOCKED' || yieldIds.has(b.id)).map(b => b.id)
        );
        setOptimizedConflictCells(redCells);
        setOptimizedDeadlocks(blockedInOptimized);

        // ══════════════════════════════════════════════════════════════
        // PHASE 4 & 5 — RESOLUTION + MOVEMENT EXECUTION
        // ══════════════════════════════════════════════════════════════
        const nextFleet = prev.map(bot => {
          // ── Same-cell occupancy fix ──
          if (occupancyFixMap.has(bot.id)) {
            const newPos = occupancyFixMap.get(bot.id)!;
            const goal = bot.path.length > 0 ? bot.path[bot.path.length - 1] : {x: bot.x, z: bot.z};
            const obstacles = prev.filter(r => r.id !== bot.id).map(r => ({x: r.x, z: r.z}));
            const newPath = astar(newPos, goal, obstacles, currentGrid);
            needsUpdate = true;
            return { ...bot, x: newPos.x, z: newPos.z, path: newPath, pathIndex: 1, status: 'MOVING' as const, consecutiveBlocks: 0, lastLogEvent: { msg: `[Middleware] Collision resolved — repositioned to [${newPos.x},${newPos.z}]`, id: Date.now() + Math.random() } };
          }

          // ── Cycle reroute — lowest priority bot in cycle repaths ──
          if (cycleRerouteIds.has(bot.id)) {
            const obstacles = prev.filter(r => r.id !== bot.id).map(r => ({x: r.x, z: r.z}));
            const goal = bot.path.length > 0 ? bot.path[bot.path.length - 1] : {x: bot.x, z: bot.z};
            const newPath = astar({x: bot.x, z: bot.z}, goal, obstacles, currentGrid);
            needsUpdate = true;
            if (newPath.length > 0) {
              return { ...bot, path: newPath, pathIndex: 1, status: 'MOVING' as const, consecutiveBlocks: 0, lastLogEvent: { msg: `[Middleware] Cycle broken — rerouting (lowest priority in chain)`, id: Date.now() + Math.random() } };
            }
          }

          // ── Idle eviction ──
          if (evictIds.has(bot.id)) {
            const eOffsets = [{dx:2,dz:0},{dx:-2,dz:0},{dx:0,dz:2},{dx:0,dz:-2},{dx:1,dz:0},{dx:-1,dz:0},{dx:0,dz:1},{dx:0,dz:-1}];
            for (const o of eOffsets) {
              const wx = bot.x + o.dx, wz = bot.z + o.dz;
              if (wx >= 0 && wx < GRID_SIZE && wz >= 0 && wz < GRID_SIZE && currentGrid[wx][wz] === 0 && !prev.some(r => r.x === wx && r.z === wz)) {
                const ep = astar({x: bot.x, z: bot.z}, {x: wx, z: wz}, [], currentGrid);
                if (ep.length > 0) { needsUpdate = true; return { ...bot, missionPhase: 'TO_WAIT' as const, status: 'MOVING' as const, path: ep, pathIndex: 1, consecutiveBlocks: 0 }; }
              }
            }
          }

          if (bot.status !== 'MOVING' && bot.status !== 'BLOCKED') return bot;

          // ── ML Telemetry ──
          const stateArray = [bot.x, bot.z, parseInt(bot.missionData.dx || '0'), parseInt(bot.missionData.dz || '0')];
          const mlOffsets = [{ dx: -1, dz: -1 }, { dx: 0, dz: -1 }, { dx: 1, dz: -1 }, { dx: -1, dz: 0 }, { dx: 0, dz: 0 }, { dx: 1, dz: 0 }, { dx: -1, dz: 1 }, { dx: 0, dz: 1 }, { dx: 1, dz: 1 }];
          for (const o of mlOffsets) {
            const wx = bot.x + o.dx, wz = bot.z + o.dz;
            let val = 0;
            if (wx < 0 || wx >= GRID_SIZE || wz < 0 || wz >= GRID_SIZE || STATIC_GRID[wx][wz] === 1) val = 1;
            if (prev.some(r => r.id !== bot.id && r.x === wx && r.z === wz)) val = 2;
            stateArray.push(val);
          }
          let mlAction = 0;
          let mlReward = -1;
          const fireTuple = (act: number, rew: number, metric: any) => {
            if (bot.currentTaskId) {
              const eff = Math.max(0, 100 - (metric.blockedTicks * 0.5) - ((metric.reroutePenalties || 0) * 2));
              addExperience(bot.id, stateArray, act, rew, eff).catch(() => { });
            }
          };

          let m = { ...bot.metrics };
          let bWarn = bot.batteryWarning;
          let logEvt = bot.lastLogEvent;
          if (bot.status === 'MOVING') {
            m.activeTicks += 1;
            if (m.activeTicks > 0 && m.activeTicks % 600 === 0 && !bWarn) {
              logEvt = { msg: `CRITICAL: Battery level is empty!`, id: Date.now() + Math.random() };
              bWarn = true;
            }
          }
          if (bot.status === 'BLOCKED') m.blockedTicks += 1;

          // ── Yield: Lower-priority bot holds position ──
          if (yieldIds.has(bot.id)) {
            needsUpdate = true;
            m.blockedTicks += 1;
            fireTuple(0, -10, m);
            return { ...bot, status: 'BLOCKED' as const, metrics: m, consecutiveBlocks: (bot.consecutiveBlocks || 0) + 1, batteryWarning: bWarn, lastLogEvent: logEvt };
          }

          if (bot.pathIndex < bot.path.length) {
            const nextStep = bot.path[bot.pathIndex];
            if (nextStep.z < bot.z) mlAction = 1;
            else if (nextStep.z > bot.z) mlAction = 2;
            else if (nextStep.x < bot.x) mlAction = 3;
            else if (nextStep.x > bot.x) mlAction = 4;

            const occupied = prev.some(r => r.id !== bot.id && r.x === nextStep.x && r.z === nextStep.z);

            if (occupied) {
              mlReward = -10;
              mlAction = 0;
              const blocks = (bot.consecutiveBlocks || 0) + 1;

              // ── Dynamic Priority Reroute Threshold ──
              // High-priority bots hold ground longer; low-priority bots dodge quickly
              const botPri = priority.get(bot.id) || 0;
              const blocker = prev.find(r => r.id !== bot.id && r.x === nextStep.x && r.z === nextStep.z);
              const blockerPri = blocker ? (priority.get(blocker.id) || 0) : 0;

              let rerouteThreshold: number;
              if (botPri > blockerPri) {
                // I'm higher priority — hold ground, let them dodge
                rerouteThreshold = 6;
              } else {
                // I'm lower priority — dodge quickly
                rerouteThreshold = 2;
              }

              // Entropy injection during global deadlock
              if (hasDeadlock) {
                rerouteThreshold = Math.max(1, rerouteThreshold - Math.floor(Math.random() * 3));
              }

              if (blocks >= rerouteThreshold) {
                // Strategy 1: Reroute via Soft-Obstacle A*
                const obstacles = prev.filter(r => r.id !== bot.id).map(r => ({x: r.x, z: r.z}));
                const target = bot.path[bot.path.length - 1];
                const newPath = astar({x: bot.x, z: bot.z}, target, obstacles, currentGrid);
                if (newPath.length > 0) {
                  needsUpdate = true;
                  m.reroutePenalties = (m.reroutePenalties || 0) + 1;
                  logEvt = { msg: `[Middleware] Rerouting around [${nextStep.x},${nextStep.z}] (pri: ${botPri.toFixed(0)})`, id: Date.now() + Math.random() };
                  fireTuple(mlAction, mlReward, m);
                  return { ...bot, path: newPath, pathIndex: 1, status: 'MOVING' as const, metrics: m, consecutiveBlocks: 0, batteryWarning: bWarn, lastLogEvent: logEvt };
                } else if (blocks > 30) {
                  // Strategy 2: SHATTER — mission-safe last resort
                  const neighbors = [{dx:1,dz:0},{dx:-1,dz:0},{dx:0,dz:1},{dx:0,dz:-1}];
                  for (const o of neighbors) {
                    const nx = bot.x + o.dx, nz = bot.z + o.dz;
                    if (nx >= 0 && nx < GRID_SIZE && nz >= 0 && nz < GRID_SIZE && currentGrid[nx][nz] === 0 && !prev.some(r => r.x === nx && r.z === nz)) {
                      needsUpdate = true;
                      // Preserve mission — just clear path so it repaths next tick
                      logEvt = { msg: `[Middleware] Shattering jam at [${bot.x},${bot.z}] → [${nx},${nz}]`, id: Date.now() + Math.random() };
                      fireTuple(mlAction, -50, m);
                      return { ...bot, x: nx, z: nz, path: [], pathIndex: 0, consecutiveBlocks: 0, batteryWarning: bWarn, lastLogEvent: logEvt };
                    }
                  }
                }
              }
              if (bot.status !== 'BLOCKED') needsUpdate = true;
              fireTuple(mlAction, mlReward, m);
              return { ...bot, status: 'BLOCKED' as const, metrics: m, consecutiveBlocks: blocks, batteryWarning: bWarn, lastLogEvent: logEvt };
            } else {
              // Path is clear — move!
              needsUpdate = true;
              fireTuple(mlAction, mlReward, m);
              return { ...bot, x: nextStep.x, z: nextStep.z, pathIndex: bot.pathIndex + 1, status: 'MOVING' as const, metrics: m, consecutiveBlocks: 0, batteryWarning: bWarn, lastLogEvent: logEvt };
            }
          } else {
            // Goal reached — phase transition
            needsUpdate = true;
            mlReward = +100;
            fireTuple(0, mlReward, m);
            if (bot.missionPhase === 'TO_PICK') {
              const np = astar({ x: bot.x, z: bot.z }, { x: parseInt(bot.missionData.dx), z: parseInt(bot.missionData.dz) }, [], currentGrid);
              return { ...bot, path: np, pathIndex: 1, missionPhase: 'TO_DROP' as const, payloadVisible: true, metrics: m, consecutiveBlocks: 0, batteryWarning: bWarn, lastLogEvent: logEvt };
            } else if (bot.missionPhase === 'TO_DROP') {
              const wOffsets = [{dx:2,dz:0},{dx:-2,dz:0},{dx:0,dz:2},{dx:0,dz:-2},{dx:2,dz:2},{dx:-2,dz:-2}];
              let wt = {x: bot.x, z: bot.z};
              for (const o of wOffsets) { const wx=bot.x+o.dx,wz=bot.z+o.dz; if(wx>=0&&wx<GRID_SIZE&&wz>=0&&wz<GRID_SIZE&&currentGrid[wx][wz]===0){wt={x:wx,z:wz};break;} }
              const np = astar({ x: bot.x, z: bot.z }, wt, [], currentGrid);
              return { ...bot, path: np, pathIndex: 1, missionPhase: 'TO_WAIT' as const, payloadVisible: false, metrics: m, consecutiveBlocks: 0, batteryWarning: bWarn, lastLogEvent: logEvt };
            } else if (bot.missionPhase === 'TO_WAIT') {
              return { ...bot, missionPhase: 'FINISHING' as const, status: 'IDLE' as const, path: [], pathIndex: 0, metrics: m, consecutiveBlocks: 0, batteryWarning: bWarn, lastLogEvent: logEvt };
            }
            return bot;
          }
        });

        return needsUpdate ? nextFleet : prev;
      });
    }, TICK_INTERVAL);

    return () => clearInterval(timer);
  }, [hasDeadlock, simulationMode, currentGrid]);




  const failedTasks = tasks.filter(t => t.status === 'failed');

  return (
    <div className="simulation-view">


      {/* ─── Failed Task Warning Banner ─── */}
      {failedTasks.length > 0 && !hasDeadlock && (
        <div className="failed-task-banner">
          ⚠️ {failedTasks.length} task(s) failed — path conflict or unreachable destination. Robot(s) have been stopped.
        </div>
      )}


      <div className="simulation-canvas-container">
        <Canvas camera={{ position: [CENTER_OFFSET + 10, 20, CENTER_OFFSET + 10], fov: 50 }}>
          <color attach="background" args={['#050510']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[20, 50, 20]} intensity={1} />
          <WarehouseEnvironment grid={currentGrid} />
          {robots.map(r => (
            <RobotModel
              key={r.id}
              robot={r}
              onSelect={setSelectedRobot}
              isDeadlocked={
                simulationMode === 'NORMAL'
                  ? normalDeadlocks.has(r.id)
                  : optimizedDeadlocks.has(r.id)
              }
            />
          ))}
          <PathOverlay robots={robots} mode={simulationMode} />
          {simulationMode === 'NORMAL' && <ConflictZones robots={robots} collisionCells={collisionCells} />}
          {simulationMode === 'OPTIMIZED' && <ConflictZones robots={robots} collisionCells={optimizedConflictCells} />}
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

      <aside className="sim-terminal">
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
              <b>✓ Middleware active.</b> Dynamic priority scheduling + swap detection + DFS cycle resolution + Collaborative A* prevents conflicts.
            </div>
          )}
        </div>
        <div className="panel glass" style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0, padding: '12px 15px' }}>
          <div className="sim-panel-title" style={{ fontSize: '0.9rem', marginBottom: '0' }}>Global <span>Efficiency</span></div>
          <div style={{ textAlign: 'center', margin: '0' }}>
            <span style={{ fontSize: '2.1rem', fontWeight: 'bold', color: '#00aaff', textShadow: '0 0 10px rgba(0,170,255,0.5)' }}>
              {(() => {
                let act = 0, q = 0, blk = 0;
                robots.forEach(r => { act += r.metrics.activeTicks; q += r.metrics.queuedTicks; blk += r.metrics.blockedTicks; });
                const tot = act + q + blk;
                return tot === 0 ? '100.0%' : ((act / tot) * 100).toFixed(1) + '%';
              })()}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', fontWeight: 'bold', opacity: 0.8, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '6px', marginTop: '2px' }}>
            <span style={{ color: '#00cc66' }}>Active: {robots.reduce((s, r) => s + r.metrics.activeTicks, 0)}t</span>
            <span style={{ color: '#ffcc00' }}>Wait: {robots.reduce((s, r) => s + r.metrics.queuedTicks, 0)}t</span>
            <span style={{ color: '#ff3333' }}>Jams: {robots.reduce((s, r) => s + r.metrics.blockedTicks, 0)}t</span>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: '300px', display: 'flex', flexDirection: 'column' }}>
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

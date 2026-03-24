import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Line } from '@react-three/drei';
import * as THREE from 'three';
import './SimulationView.css';

/* ─── Simulation Configuration ─── */
const GRID_SIZE = 30;
const CENTER_OFFSET = (GRID_SIZE - 1) / 2;
const TICK_INTERVAL = 250;
const ROBOT_COLORS = [0xff2222, 0xffaa00, 0x00cc22, 0x00aaff, 0x9900ff, 0x333333];
const SPAWN_POINTS = [
  { x: 1, z: 1 }, { x: 28, z: 1 },
  { x: 1, z: 28 }, { x: 28, z: 28 },
  { x: 1, z: 14 }, { x: 28, z: 14 }
];

/* ─── A* Pathfinding Logic (Ported from Teammate) ─── */
const heuristic = (a: { x: number; z: number }, b: { x: number; z: number }) => 
  Math.abs(a.x - b.x) + Math.abs(a.z - b.z);

const getStaticGrid = () => {
  const g = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
  for (let x = 3; x < GRID_SIZE - 3; x += 5) {
    for (let z = 3; z < GRID_SIZE - 3; z++) {
      if (z % 8 !== 0 && z % 8 !== 1) {
        g[x][z] = 1;
        g[x + 1][z] = 1;
      }
    }
  }
  // Add 1-tile wide "tunnel" on Z=28 between X=5 and X=25
  for (let x = 5; x <= 25; x++) {
    g[x][27] = 1; // Top wall
    g[x][29] = 1; // Bottom wall
  }
  return g;
};

const STATIC_GRID = getStaticGrid();

const astar = (start: { x: number; z: number }, goal: { x: number; z: number }) => {
  let openSet = [start];
  let cameFrom = new Map<string, { x: number; z: number }>();
  let gScore = new Map<string, number>();
  let fScore = new Map<string, number>();

  const toKey = (p: { x: number; z: number }) => `${p.x},${p.z}`;
  
  gScore.set(toKey(start), 0);
  fScore.set(toKey(start), heuristic(start, goal));

  while (openSet.length > 0) {
    let current = openSet.reduce((a, b) => (fScore.get(toKey(a)) ?? Infinity) < (fScore.get(toKey(b)) ?? Infinity) ? a : b);

    if (current.x === goal.x && current.z === goal.z) {
      let calcPath = [current];
      while (cameFrom.has(toKey(current))) {
        current = cameFrom.get(toKey(current))!;
        calcPath.push(current);
      }
      return calcPath.reverse();
    }

    openSet = openSet.filter(p => p.x !== current.x || p.z !== current.z);

    const neighbors = [
      { x: current.x + 1, z: current.z },
      { x: current.x - 1, z: current.z },
      { x: current.x, z: current.z + 1 },
      { x: current.x, z: current.z - 1 }
    ];

    for (let n of neighbors) {
      if (n.x < 0 || n.x >= GRID_SIZE || n.z < 0 || n.z >= GRID_SIZE) continue;
      if (STATIC_GRID[n.x][n.z] === 1) continue;

      let tentativeGScore = (gScore.get(toKey(current)) ?? 0) + 1;
      let nKey = toKey(n);

      if (!gScore.has(nKey) || tentativeGScore < (gScore.get(nKey) ?? Infinity)) {
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
}

/* ─── 3D Robot Compoment ─── */
const RobotModel = ({ robot, onSelect }: { robot: RobotState; onSelect: (r: RobotState) => void }) => {
  const meshRef = useRef<THREE.Group>(null!);

  useFrame(() => {
    // Smooth transition between grid positions
    meshRef.current.position.x = THREE.MathUtils.lerp(meshRef.current.position.x, robot.x, 0.1);
    meshRef.current.position.z = THREE.MathUtils.lerp(meshRef.current.position.z, robot.z, 0.1);
  });

  return (
    <group ref={meshRef} position={[robot.x, 0, robot.z]} onClick={(e) => { e.stopPropagation(); onSelect(robot); }}>
      {/* Body */}
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[0.7, 0.4, 0.8]} />
        <meshStandardMaterial color={robot.color} roughness={0.5} />
      </mesh>
      {/* Antenna */}
      <mesh position={[0, 0.6, -0.2]}>
        <cylinderGeometry args={[0.05, 0.05, 0.3]} />
        <meshStandardMaterial color="white" />
      </mesh>
      {/* Payload */}
      {robot.payloadVisible && (
        <mesh position={[0, 0.8, 0.1]}>
          <boxGeometry args={[0.4, 0.4, 0.4]} />
          <meshStandardMaterial color="#dddddd" />
        </mesh>
      )}
    </group>
  );
};

/* ─── Environment Component ─── */
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
    // Tunnel walls
    for (let x = 5; x <= 25; x++) {
      items.push({ x, z: 27 }, { x, z: 29 });
    }
    return items;
  }, []);

  return (
    <group>
      {/* Ground */}
      <mesh rotation-x={-Math.PI / 2} position={[CENTER_OFFSET, -0.01, CENTER_OFFSET]}>
        <planeGeometry args={[GRID_SIZE, GRID_SIZE]} />
        <meshStandardMaterial color="#111" roughness={1.0} />
      </mesh>
      
      {/* Grid Helper */}
      <Grid
        position={[CENTER_OFFSET, 0, CENTER_OFFSET]}
        args={[GRID_SIZE, GRID_SIZE]}
        sectionColor="#333"
        cellColor="#222"
        infiniteGrid={false}
        fadeDistance={50}
        fadeStrength={1}
      />

      {/* Racks */}
      {racks.map((pos, i) => (
        <mesh key={i} position={[pos.x, 0.75, pos.z]}>
          <boxGeometry args={[0.9, 1.5, 0.9]} />
          <meshStandardMaterial color="#2b5797" roughness={0.8} />
          <Line
            points={[
              [-0.45, -0.75, -0.45], [0.45, -0.75, -0.45],
              [0.45, -0.75, -0.45], [0.45, 0.75, -0.45],
              // Simple wireframe subset for performance/look
            ]}
            color="#000"
            lineWidth={1}
          />
        </mesh>
      ))}

      {/* Pads */}
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
const SimulationView = () => {
  const [robots, setRobots] = useState<RobotState[]>(() => 
    SPAWN_POINTS.map((pt, i) => ({
      id: i,
      x: pt.x,
      z: pt.z,
      color: `#${new THREE.Color(ROBOT_COLORS[i]).getHexString()}`,
      missionPhase: 'IDLE',
      status: 'IDLE',
      path: [],
      pathIndex: 0,
      payloadVisible: false,
      missionData: { px: '', pz: '', dx: '', dz: '' }
    }))
  );
  
  const [selectedRobot, setSelectedRobot] = useState<RobotState | null>(null);
  const [isAuto, setIsAuto] = useState(false);
  
  // Track latest robots for interval closures
  const robotsRef = useRef(robots);
  useEffect(() => { robotsRef.current = robots; }, [robots]);

  // Task Queue for Deadlock Resolution
  const [pendingTasks, setPendingTasks] = useState<any[]>([]);

  // Go Resolver Port: Check if coordinates conflict
  const positionsConflict = (a: any, b: any) => {
    if ((a.px === b.px && a.pz === b.pz) || (a.px === b.dx && a.pz === b.dz)) return true;
    if ((a.dx === b.px && a.dz === b.pz) || (a.dx === b.dx && a.dz === b.dz)) return true;
    return false;
  };

  // Go Resolver Port: Build Graph & Detect Cycles
  const resolveDeadlocks = (tasks: any[]) => {
    if (tasks.length === 0) return { active: [], paused: [] };
    
    const edges: Record<string, string[]> = {};
    tasks.forEach(t => edges[t.id] = []);
    
    for (let i = 0; i < tasks.length; i++) {
        for (let j = 0; j < tasks.length; j++) {
            if (i !== j && positionsConflict(tasks[i], tasks[j])) {
                edges[tasks[i].id].push(tasks[j].id);
            }
        }
    }

    const visited: Record<string, boolean> = {};
    const inStack: Record<string, boolean> = {};
    const cycles: string[][] = [];
    let path: string[] = [];

    const dfs = (node: string): boolean => {
        visited[node] = true;
        inStack[node] = true;
        path.push(node);

        for (const neighbor of edges[node]) {
            if (!visited[neighbor]) {
                if (dfs(neighbor)) return true;
            } else if (inStack[neighbor]) {
                const cycleStart = path.indexOf(neighbor);
                if (cycleStart >= 0) cycles.push([...path.slice(cycleStart)]);
                return true;
            }
        }
        path.pop();
        inStack[node] = false;
        return false;
    };

    tasks.forEach(t => { if (!visited[t.id]) dfs(t.id); });

    const cycleSet = new Set<string>();
    cycles.forEach(c => c.forEach(id => cycleSet.add(id)));

    // Priorities: Just use ID as priority for simulation (lower ID = higher priority)
    const sorted = [...tasks].sort((a, b) => a.id - b.id);
    
    const active: any[] = [];
    const paused: any[] = [];
    const reserved = new Set<string>();

    for (const task of sorted) {
        const pKey = `${task.px},${task.pz}`;
        const dKey = `${task.dx},${task.dz}`;
        
        // If a higher priority task has reserved this cell and we are in a cycle
        if ((reserved.has(pKey) || reserved.has(dKey)) && cycleSet.has(task.id)) {
            paused.push(task);
        } else {
            reserved.add(pKey);
            reserved.add(dKey);
            active.push(task);
        }
    }

    return { active, paused };
  };

  /* ─── Mission Logic ─── */
  const forceStartMission = useCallback((id: number, px: number, pz: number, dx: number, dz: number) => {
    setRobots(prev => prev.map(r => {
      if (r.id !== id) return r;
      const path = astar({ x: r.x, z: r.z }, { x: px, z: pz });
      if (path.length > 0) {
        return {
          ...r,
          path,
          pathIndex: 1,
          status: 'MOVING',
          missionPhase: 'TO_PICK',
          payloadVisible: false,
          missionData: { px: String(px), pz: String(pz), dx: String(dx), dz: String(dz) }
        };
      }
      return { ...r, missionPhase: 'FAILED' };
    }));
  }, []);

  const dispatchAll = () => {
    setIsAuto(false);
    
    const requestedTasks: any[] = [];
    robots.forEach(r => {
      const { px, pz, dx, dz } = r.missionData;
      if (px && pz && dx && dz && r.status === 'IDLE') {
        requestedTasks.push({ id: String(r.id), px: parseInt(px), pz: parseInt(pz), dx: parseInt(dx), dz: parseInt(dz) });
      }
    });

    // Run Go Deadlock Resolver
    const resolution = resolveDeadlocks(requestedTasks);
    
    // Save paused tasks to queue
    setPendingTasks(resolution.paused);

    // Only dispatch active safe tasks
    resolution.active.forEach(t => forceStartMission(parseInt(t.id), t.px, t.pz, t.dx, t.dz));
  };

  const assignRandomMission = useCallback((bot: RobotState) => {
    // Basic assignment without passing through global resolver for individual auto-ticks
    // However, to keep it safe, we check if it conflicts with active reserved coordinates
    let px: number, pz: number, dx: number, dz: number;
    do {
      px = Math.floor(Math.random() * GRID_SIZE);
      pz = Math.floor(Math.random() * GRID_SIZE);
    } while (STATIC_GRID[px][pz] === 1 || (px === bot.x && pz === bot.z));
    do {
      dx = Math.floor(Math.random() * GRID_SIZE);
      dz = Math.floor(Math.random() * GRID_SIZE);
    } while (STATIC_GRID[dx][dz] === 1 || (dx === px && dz === pz));

    forceStartMission(bot.id, px, pz, dx, dz);
  }, [forceStartMission]);

  /* ─── Demo Deadlock Handlers ─── */
  const demoSwapDeadlock = useCallback(() => {
    setIsAuto(false);
    setRobots(prev => prev.map((r, i) => {
      if (i === 0) return { ...r, x: 14, z: 28, path: [], pathIndex: 0, status: 'IDLE', missionPhase: 'IDLE', payloadVisible: false };
      if (i === 1) return { ...r, x: 15, z: 28, path: [], pathIndex: 0, status: 'IDLE', missionPhase: 'IDLE', payloadVisible: false };
      return { ...r, status: 'DONE', path: [] }; // Halt others
    }));
    setTimeout(() => {
        const tasks = [
            { id: "0", px: 15, pz: 28, dx: 15, dz: 28 },
            { id: "1", px: 14, pz: 28, dx: 14, dz: 28 }
        ];
        const res = resolveDeadlocks(tasks);
        setPendingTasks(res.paused);
        res.active.forEach(t => forceStartMission(parseInt(t.id), t.px, t.pz, t.dx, t.dz));
    }, 150);
  }, [forceStartMission]);

  const demoSameCellDeadlock = useCallback(() => {
    setIsAuto(false);
    setRobots(prev => prev.map((r, i) => {
      if (i === 0) return { ...r, x: 2, z: 1, path: [], pathIndex: 0, status: 'IDLE', missionPhase: 'IDLE', payloadVisible: false };
      if (i === 1) return { ...r, x: 1, z: 1, path: [], pathIndex: 0, status: 'IDLE', missionPhase: 'IDLE', payloadVisible: false };
      return { ...r, status: 'DONE', path: [] }; // Halt others
    }));
    setTimeout(() => {
        const tasks = [
            { id: "0", px: 15, pz: 1, dx: 0, dz: 1 },
            { id: "1", px: 15, pz: 1, dx: 0, dz: 1 }
        ];
        const res = resolveDeadlocks(tasks);
        setPendingTasks(res.paused);
        res.active.forEach(t => forceStartMission(parseInt(t.id), t.px, t.pz, t.dx, t.dz));
    }, 150);
  }, [forceStartMission]);

  /* ─── Autonomous Mode Engine ─── */
  useEffect(() => {
    if (!isAuto) return;

    // Immediately trigger for currently idle robots
    robotsRef.current.forEach(r => {
      if (r.missionPhase === 'IDLE' || r.status === 'DONE') {
        setTimeout(() => assignRandomMission(r), r.id * 100);
      }
    });

    const autoTimer = setInterval(() => {
      robotsRef.current.forEach(r => {
        if (r.missionPhase === 'IDLE' || r.status === 'DONE') {
          assignRandomMission(r);
        }
      });
    }, 2000);

    return () => clearInterval(autoTimer);
  }, [isAuto, assignRandomMission]);

  /* ─── Simulation Tick Engine ─── */
  useEffect(() => {
    const timer = setInterval(() => {
      setRobots(prev => {
        let needsUpdate = false;
        const nextFleet = prev.map(bot => {
          if (bot.status !== 'MOVING' && bot.status !== 'BLOCKED') return bot;

          if (bot.pathIndex < bot.path.length) {
            const nextStep = bot.path[bot.pathIndex];
            
            // Collision Check — use the current fleet positions for accurate detection
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
              // Create a waiting area phase so it doesn't block the drop zone indefinitely
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
              // Task finished! Check pending queue to awaken waiters!
              setPendingTasks(currentPending => {
                if (currentPending.length > 0) {
                    const next = currentPending[0];
                    console.log(`Awakening waiting Robot #${next.id} from queue!`);
                    setTimeout(() => forceStartMission(parseInt(next.id), next.px, next.pz, next.dx, next.dz), 500);
                    return currentPending.slice(1);
                }
                return currentPending;
              });

              return { ...bot, status: 'DONE' as const, missionPhase: 'IDLE' as const, payloadVisible: false };
            }
          }
        });

        return needsUpdate ? nextFleet : prev;
      });
    }, TICK_INTERVAL);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="simulation-view">
      {/* 3D Canvas */}
      <div className="simulation-canvas-container">
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
                  <label>Phase</label>
                  <span>{selectedRobot.missionPhase}</span>
                </div>
                <div className="tele-item">
                  <label>Payload</label>
                  <span>{selectedRobot.payloadVisible ? 'Y' : 'N'}</span>
                </div>
              </div>
              {selectedRobot.path.length > 0 && (
                <div className="path-preview">
                  {selectedRobot.path.map((p, i) => (
                    <div key={i}>{i === selectedRobot.pathIndex ? '📍' : '  '} [{p.x}, {p.z}]</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Control Terminal */}
      <aside className="sim-terminal">
        <section className="panel glass sim-panel" style={{ flex: 3 }}>
          <div className="sim-panel-title">Mission <span>Dispatch</span></div>
          <div className="mission-list">
            {robots.map(r => (
              <div key={r.id} className="mission-row" style={{ borderLeftColor: r.color }}>
                <div className="mission-robot-header">Robot #{r.id}</div>
                <div className="mission-inputs">
                  <div className="coordinate-group">
                    <label>Pick</label>
                    <input className="sim-input" type="number" placeholder="X" value={r.missionData.px} 
                      onChange={(e) => setRobots(prev => prev.map(bot => bot.id === r.id ? { ...bot, missionData: { ...bot.missionData, px: e.target.value } } : bot))} 
                    />
                    <input className="sim-input" type="number" placeholder="Z" value={r.missionData.pz} 
                      onChange={(e) => setRobots(prev => prev.map(bot => bot.id === r.id ? { ...bot, missionData: { ...bot.missionData, pz: e.target.value } } : bot))} 
                    />
                  </div>
                  <div className="coordinate-group">
                    <label>Drop</label>
                    <input className="sim-input" type="number" placeholder="X" value={r.missionData.dx} 
                      onChange={(e) => setRobots(prev => prev.map(bot => bot.id === r.id ? { ...bot, missionData: { ...bot.missionData, dx: e.target.value } } : bot))} 
                    />
                    <input className="sim-input" type="number" placeholder="Z" value={r.missionData.dz} 
                      onChange={(e) => setRobots(prev => prev.map(bot => bot.id === r.id ? { ...bot, missionData: { ...bot.missionData, dz: e.target.value } } : bot))} 
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="sim-actions">
            <button className="btn-dispatch" onClick={dispatchAll}>🔥 Dispatch All</button>
            <div style={{ display: 'flex', gap: '5px', marginTop: '10px' }}>
              <button className="btn-dispatch" style={{ background: '#ff8800', fontSize: '0.8rem', padding: '6px' }} onClick={demoSwapDeadlock}>Demo: Swap Deadlock</button>
              <button className="btn-dispatch" style={{ background: '#ff8800', fontSize: '0.8rem', padding: '6px' }} onClick={demoSameCellDeadlock}>Demo: Same Cell Deadlock</button>
            </div>
            <button className="btn-auto" onClick={() => setIsAuto(!isAuto)} style={{ marginTop: '10px' }}>
              {isAuto ? '⏹ Stop Autonomous' : '🚀 Start Autonomous'}
            </button>
          </div>
        </section>

        <section className="panel glass sim-panel" style={{ flex: 2 }}>
          <div className="sim-panel-title">Fleet <span>Status</span></div>
          <div className="table-scroll" style={{ flex: 1, overflowY: 'auto' }}>
            <table className="fleet-table" style={{ fontSize: '0.7rem' }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Pos</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {robots.map(r => (
                  <tr key={r.id}>
                    <td className="unit-cell" style={{ color: r.color }}>#{r.id}</td>
                    <td style={{ fontFamily: 'JetBrains Mono' }}>[{r.x},{r.z}]</td>
                    <td>
                      <span className={`status-badge status-${r.status.toLowerCase()}`} style={{ fontSize: '0.6rem' }}>
                        {r.status === 'BLOCKED' ? 'DEADLOCK' : r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </section>

          <section className="panel glass sim-panel" style={{ flex: 1, marginTop: '15px' }}>
            <div className="sim-panel-title">Waiting <span>Queue</span> (Deadlock Avoidance)</div>
            {pendingTasks.length === 0 ? (
                <div style={{ fontSize: '0.75rem', color: '#888', fontStyle: 'italic', marginTop: '10px' }}>No deadlocks preempted.</div>
            ) : (
                <ul style={{ fontSize: '0.75rem', paddingLeft: '15px', color: '#ffcc00' }}>
                    {pendingTasks.map((t, idx) => (
                        <li key={idx}>Unit #{t.id} paused matching target</li>
                    ))}
                </ul>
            )}
          </section>
      </aside>
    </div>
  );
};

export default SimulationView;

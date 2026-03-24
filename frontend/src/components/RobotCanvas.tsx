import { useRef, useState, useMemo, Suspense, useEffect, useCallback, useSyncExternalStore } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  OrbitControls,
  Grid,
  ContactShadows,
  Environment,
  Box,
  Cylinder
} from '@react-three/drei';
import * as THREE from 'three';

/* ─── Robot Model ─── */

const RobotModel = ({ targetPos }: { targetPos: THREE.Vector3 }) => {
  const group = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const currentPos = useRef(new THREE.Vector3(0, 0, 0));
  const [hovered, setHover] = useState(false);

  useFrame((state) => {
    if (!group.current || !head.current) return;

    currentPos.current.lerp(targetPos, 0.025);
    group.current.position.set(currentPos.current.x, 0.75, currentPos.current.z);

    const lookDir = new THREE.Vector3(targetPos.x, 0.75, targetPos.z);
    if (group.current.position.distanceTo(lookDir) > 0.15) {
      group.current.lookAt(lookDir);
    }

    head.current.rotation.y = Math.sin(state.clock.elapsedTime * 1.5) * 0.15;
    head.current.position.y = 0.5 + Math.sin(state.clock.elapsedTime * 2.5) * 0.02;
  });

  return (
    <group ref={group} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
      {/* Chassis — warm metallic */}
      <Box args={[1.8, 0.7, 1.8]} castShadow>
        <meshStandardMaterial color="#8B7355" metalness={0.85} roughness={0.15} />
      </Box>

      {/* Tracks */}
      {([-0.85, 0.85] as number[]).map((x, i) => (
        <Box key={i} args={[0.35, 0.45, 2]} position={[x, -0.05, 0]} castShadow>
          <meshStandardMaterial color="#3D3225" metalness={0.9} roughness={0.3} />
        </Box>
      ))}

      {/* Neck */}
      <Cylinder args={[0.12, 0.12, 0.45]} position={[0, 0.55, 0]}>
        <meshStandardMaterial color="#A0896C" metalness={0.9} roughness={0.1} />
      </Cylinder>

      {/* Head */}
      <group ref={head}>
        <Box args={[0.9, 0.7, 0.7]} position={[0, 0.4, 0]} castShadow>
          <meshStandardMaterial
            color={hovered ? '#D45A1F' : '#7A6A55'}
            metalness={0.85}
            roughness={0.1}
          />
        </Box>
        {/* Eye visor — copper glow */}
        <mesh position={[0, 0.4, 0.36]}>
          <planeGeometry args={[0.6, 0.15]} />
          <meshStandardMaterial color="#FF8C42" emissive="#FF8C42" emissiveIntensity={6} />
        </mesh>
        {/* Antenna */}
        <Cylinder args={[0.02, 0.02, 0.25]} position={[0.2, 0.8, 0]}>
          <meshStandardMaterial color="#8B7355" metalness={0.9} roughness={0.2} />
        </Cylinder>
        <mesh position={[0.2, 0.93, 0]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial color="#D45A1F" emissive="#D45A1F" emissiveIntensity={3} />
        </mesh>
      </group>

      {/* Underbody glow */}
      <pointLight position={[0, -0.1, 0]} intensity={0.5} color="#FF8C42" distance={4} />
    </group>
  );
};

/* ─── Warehouse Crates ─── */

const Warehouse = () => {
  const crates = useMemo(() => [
    [7, 1, 7], [-7, 1, -7], [10, 1, -4], [-10, 1, 4], [0, 1, -10], [13, 1, 13], [-13, 1, 12],
  ], []);

  return (
    <group>
      {crates.map((pos, i) => (
        <group key={i} position={pos as [number, number, number]}>
          <Box args={[2, 2, 2]} castShadow>
            <meshStandardMaterial color="#5C4A3A" metalness={0.4} roughness={0.6} />
          </Box>
          {/* Crate stripe */}
          <mesh position={[0, 0, 1.01]}>
            <planeGeometry args={[1.6, 0.2]} />
            <meshStandardMaterial color="#D45A1F" emissive="#D45A1F" emissiveIntensity={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

/* ─── Scene ─── */

const Scene = () => {
  const [targetPos] = useState(() => new THREE.Vector3(0, 0, 0));
  const lastInteraction = useRef(0);

  const pickRandom = useCallback(() => {
    const r = 18;
    targetPos.set((Math.random() - 0.5) * r, 0, (Math.random() - 0.5) * r);
  }, [targetPos]);

  useEffect(() => {
    pickRandom();
    const id = setInterval(() => {
      if (Date.now() - lastInteraction.current > 4000) {
        pickRandom();
      }
    }, 3500);
    return () => clearInterval(id);
  }, [pickRandom]);

  const onFloorClick = (e: any) => {
    e.stopPropagation();
    lastInteraction.current = Date.now();
    targetPos.set(e.point.x, 0, e.point.z);
  };

  return (
    <>
      <Environment preset="warehouse" />

      {/* Warm industrial lighting */}
      <ambientLight intensity={0.5} color="#FFF5E6" />
      <spotLight
        position={[20, 30, 20]}
        angle={0.3}
        penumbra={1}
        intensity={6}
        castShadow
        color="#FFE4C4"
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight position={[-15, 12, -15]} intensity={1.5} color="#D45A1F" />
      <directionalLight position={[5, 20, -5]} intensity={0.4} color="#FFF0DB" />

      {/* Concrete-style floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} onPointerDown={onFloorClick} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#3A342C" roughness={0.8} metalness={0.2} />
      </mesh>

      <Grid
        infiniteGrid
        fadeDistance={50}
        fadeStrength={4}
        cellColor="#5C4A3A"
        sectionColor="#D45A1F"
        cellSize={1}
        sectionSize={5}
      />

      <Suspense fallback={null}>
        <RobotModel targetPos={targetPos} />
        <Warehouse />
      </Suspense>

      <ContactShadows position={[0, 0.01, 0]} opacity={0.4} scale={40} blur={2.5} far={8} color="#2A2520" />
    </>
  );
};

/* ─── Canvas Wrapper ─── */

const useTheme = () => {
  const getTheme = () => document.documentElement.getAttribute('data-theme') || 'light';
  return useSyncExternalStore(
    (cb) => {
      const observer = new MutationObserver(cb);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      return () => observer.disconnect();
    },
    getTheme
  );
};

const RobotCanvas = () => {
  const theme = useTheme();
  const bg = theme === 'dark' ? '#1A1410' : '#2A2520';

  return (
  <div style={{
    position: 'absolute',
    inset: 0,
    cursor: 'crosshair',
    background: bg,
  }}>
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ position: [20, 16, 20], fov: 40 }}
      style={{ width: '100%', height: '100%' }}
    >
      <Scene />
      <OrbitControls
        enablePan={false}
        enableZoom={true}
        maxPolarAngle={Math.PI / 2.2}
        minDistance={12}
        maxDistance={45}
        autoRotate
        autoRotateSpeed={0.4}
      />
    </Canvas>
    <div className="canvas-overlay">
      <div className="status-indicator">SYSTEM ONLINE</div>
      <div className="coord-panel">
        UNIT: RX-7<br />
        MODE: AUTO_NAV<br />
        ZONE: WH_ALPHA
      </div>
    </div>
  </div>
  );
};

export default RobotCanvas;

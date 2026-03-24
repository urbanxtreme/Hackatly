import { useRef, useMemo, useSyncExternalStore } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';
// @ts-ignore
import * as random from 'maath/random/dist/maath-random.esm';

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

/* ─── Galaxy Stars (Dark) / Green Dots (Light) ─── */

const StarField = ({ color, count, size }: { color: string; count: number; size: number }) => {
  const ref = useRef<THREE.Points>(null!);
  const positions = useMemo(() => random.inSphere(new Float32Array(count * 3), { radius: 1.8 }), [count]);

  useFrame((_s, delta) => {
    ref.current.rotation.x -= delta / 18;
    ref.current.rotation.y -= delta / 22;
  });

  return (
    <Points ref={ref} positions={positions} stride={3} frustumCulled={false}>
      <PointMaterial transparent color={color} size={size} sizeAttenuation depthWrite={false} />
    </Points>
  );
};

const ScatteredDots = ({ color, count, size }: { color: string; count: number; size: number }) => {
  const ref = useRef<THREE.Points>(null!);
  const positions = useMemo(() => random.inSphere(new Float32Array(count * 3), { radius: 2.2 }), [count]);

  useFrame((_s, delta) => {
    ref.current.rotation.y += delta / 30;
    ref.current.rotation.z += delta / 40;
  });

  return (
    <Points ref={ref} positions={positions} stride={3} frustumCulled={false}>
      <PointMaterial transparent color={color} size={size} sizeAttenuation depthWrite={false} opacity={0.9} />
    </Points>
  );
};

const Scene = () => {
  const theme = useTheme();
  const isDark = theme === 'dark';

  return (
    <>
      <color attach="background" args={[isDark ? '#050510' : '#FDFBF7']} />

      {isDark ? (
        /* Galaxy mode: bright white/blue stars scattered everywhere */
        <>
          <StarField color="#ffffff" count={3000} size={0.004} />
          <ScatteredDots color="#8888ff" count={1500} size={0.003} />
          <ScatteredDots color="#E8723A" count={500} size={0.005} />
        </>
      ) : (
        /* Light mode: large, vivid colored dots clearly visible */
        <>
          <StarField color="#0d9488" count={1500} size={0.012} />
          <ScatteredDots color="#059669" count={1000} size={0.009} />
          <ScatteredDots color="#d97706" count={600} size={0.014} />
        </>
      )}
    </>
  );
};

const DashboardCanvas = () => (
  <div style={{ width: '100%', height: '100%', pointerEvents: 'none', position: 'absolute', top: 0, left: 0 }}>
    <Canvas camera={{ position: [0, 0, 1] }}>
      <Scene />
    </Canvas>
  </div>
);

export default DashboardCanvas;

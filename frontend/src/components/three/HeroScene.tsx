import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { TrainModel } from './TrainModel';
import * as THREE from 'three';

function Particles({ count = 200 }) {
  const meshRef = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 20;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10 - 5;
    }
    return pos;
  }, [count]);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.02;
    }
  });

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.05} color="#6C63FF" transparent opacity={0.6} sizeAttenuation />
    </points>
  );
}

function RouteLines() {
  const routes = useMemo(() => {
    const points = [
      [-3, 0.5, -2], [-1, 0.8, -1], [0, 1, 0], [1, 0.8, 1], [3, 0.5, 2],
    ];
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
    );
    return curve.getPoints(50);
  }, []);

  return (
    <mesh>
      <tubeGeometry args={[new THREE.CatmullRomCurve3(routes), 64, 0.02, 8, false]} />
      <meshStandardMaterial color="#00D4FF" emissive="#00D4FF" emissiveIntensity={0.3} transparent opacity={0.4} />
    </mesh>
  );
}

function CityMarkers() {
  const cities: { pos: [number, number, number]; label: string }[] = [
    { pos: [-3, 0.3, -2], label: 'Delhi' },
    { pos: [3, 0.3, 2], label: 'Mumbai' },
  ];

  return (
    <>
      {cities.map((city, i) => (
        <group key={i} position={city.pos}>
          <mesh>
            <sphereGeometry args={[0.08, 16, 16]} />
            <meshStandardMaterial color="#6C63FF" emissive="#6C63FF" emissiveIntensity={0.5} />
          </mesh>
          <mesh position={[0, -0.2, 0]}>
            <ringGeometry args={[0.1, 0.15, 32]} />
            <meshBasicMaterial color="#6C63FF" transparent opacity={0.3} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} />
      <directionalLight position={[-5, 3, -5]} intensity={0.4} color="#6C63FF" />
      <pointLight position={[0, 2, 0]} intensity={0.3} color="#00D4FF" />

      <TrainModel position={[0, 0.5, 0]} scale={2} />
      <Particles count={300} />
      <RouteLines />
      <CityMarkers />
    </>
  );
}

export function HeroScene() {
  return (
    <div className="absolute inset-0 -z-10">
      <Canvas camera={{ position: [0, 1.5, 6], fov: 45 }} dpr={[1, 2]}>
        <Scene />
      </Canvas>
    </div>
  );
}

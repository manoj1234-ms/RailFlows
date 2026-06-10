import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface TrainModelProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  color?: string;
  accentColor?: string;
}

export function TrainModel({ position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, color = '#6C63FF', accentColor = '#00D4FF' }: TrainModelProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 0.5) * 0.15;
      groupRef.current.rotation.y = rotation[1] + Math.sin(state.clock.elapsedTime * 0.2) * 0.1;
    }
  });

  return (
    <group ref={groupRef} position={position} rotation={rotation} scale={scale}>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[1.2, 0.4, 2]} />
        <meshStandardMaterial color={color} metalness={0.6} roughness={0.3} />
      </mesh>

      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[1.1, 0.15, 1.9]} />
        <meshStandardMaterial color="#ffffff" metalness={0.1} roughness={0.5} opacity={0.9} transparent />
      </mesh>

      <mesh position={[0, 0.2, -1.05]}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={1} />
      </mesh>

      <mesh position={[0, 0.2, 1.05]}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial color="#ff4444" emissive="#ff4444" emissiveIntensity={1} />
      </mesh>

      {[-0.45, 0.45].map((x, i) => (
        <mesh key={`wheel-${i}`} position={[x, 0.05, 0.8]}>
          <cylinderGeometry args={[0.08, 0.08, 0.05, 16]} />
          <meshStandardMaterial color="#333" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}
      {[-0.45, 0.45].map((x, i) => (
        <mesh key={`wheel-b-${i}`} position={[x, 0.05, -0.8]}>
          <cylinderGeometry args={[0.08, 0.08, 0.05, 16]} />
          <meshStandardMaterial color="#333" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}

      {[0.9, 1.05].map((z, i) => (
        <mesh key={`axle-${i}`} position={[0, 0.05, z]}>
          <cylinderGeometry args={[0.03, 0.03, 0.9, 8]} />
          <meshStandardMaterial color="#555" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

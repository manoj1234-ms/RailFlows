import { useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

interface SeatProps {
  position: [number, number, number];
  status: 'available' | 'booked' | 'selected';
  onSelect?: () => void;
}

function Seat({ position, status, onSelect }: SeatProps) {
  const [hovered, setHovered] = useState(false);

  const colors = {
    available: '#22c55e',
    booked: '#ef4444',
    selected: '#6C63FF',
  };

  return (
    <mesh
      position={position}
      scale={hovered && status === 'available' ? 1.15 : 1}
      onClick={(e) => {
        e.stopPropagation();
        if (status === 'available' && onSelect) onSelect();
      }}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <boxGeometry args={[0.2, 0.15, 0.2]} />
      <meshStandardMaterial color={colors[status]} metalness={0.3} roughness={0.4} />
    </mesh>
  );
}

interface SeatMap3DProps {
  rows?: number;
  cols?: number;
  bookedSeats?: string[];
  selectedSeats?: string[];
  onSeatSelect?: (seatId: string) => void;
}

export default function SeatMap3D({
  rows = 10,
  cols = 6,
  bookedSeats = [],
  selectedSeats = [],
  onSeatSelect,
}: SeatMap3DProps) {
  const getStatus = useCallback(
    (seatId: string): 'available' | 'booked' | 'selected' => {
      if (selectedSeats.includes(seatId)) return 'selected';
      if (bookedSeats.includes(seatId)) return 'booked';
      return 'available';
    },
    [bookedSeats, selectedSeats]
  );

  const seats: { id: string; pos: [number, number, number]; status: 'available' | 'booked' | 'selected' }[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const seatId = `${String.fromCharCode(65 + col)}${row + 1}`;
      const x = (col - cols / 2) * 0.35;
      const z = (row - rows / 2) * 0.35;
      seats.push({ id: seatId, pos: [x, 0.1, z], status: getStatus(seatId) });
    }
  }

  return (
    <div className="w-full h-[400px] rounded-xl overflow-hidden">
      <Canvas camera={{ position: [0, 3, 4], fov: 50 }} dpr={[1, 2]}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[3, 5, 3]} intensity={0.8} />
        <directionalLight position={[-3, 2, -3]} intensity={0.3} color="#6C63FF" />
        <OrbitControls enablePan={false} minPolarAngle={0.5} maxPolarAngle={1.3} />

        <group rotation={[-0.3, 0, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
            <planeGeometry args={[(cols + 1) * 0.35, (rows + 1) * 0.35]} />
            <meshStandardMaterial color="#1a1a2e" metalness={0.8} roughness={0.2} transparent opacity={0.5} />
          </mesh>

          {seats.map((seat) => (
            <Seat
              key={seat.id}
              position={seat.pos}
              status={seat.status}
              onSelect={() => onSeatSelect?.(seat.id)}
            />
          ))}
        </group>
      </Canvas>
    </div>
  );
}

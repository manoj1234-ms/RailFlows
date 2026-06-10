import { type ReactNode } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

interface FloatingRouteCardProps {
  children: ReactNode;
  className?: string;
  intensity?: number;
}

export function FloatingRouteCard({ children, className = '', intensity = 10 }: FloatingRouteCardProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const mouseXSpring = useSpring(x, { stiffness: 150, damping: 15 });
  const mouseYSpring = useSpring(y, { stiffness: 150, damping: 15 });

  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], [intensity, -intensity]);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], [-intensity, intensity]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    x.set(mouseX / width - 0.5);
    y.set(mouseY / height - 0.5);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
      className={`relative ${className}`}
    >
      <div style={{ transformStyle: 'preserve-3d' }} className="relative z-10">
        {children}
      </div>
      <div
        className="absolute inset-0 -z-10 rounded-xl opacity-30 blur-xl"
        style={{
          background: 'linear-gradient(135deg, #6C63FF, #00D4FF)',
          transform: 'translateZ(-20px)',
        }}
      />
    </motion.div>
  );
}

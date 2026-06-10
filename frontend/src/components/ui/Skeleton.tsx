import { cn } from '@/utils/cn';

interface SkeletonProps {
  className?: string;
  count?: number;
}

export function Skeleton({ className, count = 1 }: SkeletonProps) {
  const items = Array.from({ length: count }, (_, i) => i);
  return (
    <>
      {items.map((i) => (
        <div
          key={i}
          className={cn('animate-pulse rounded-lg bg-[var(--color-border)]', className)}
        />
      ))}
    </>
  );
}

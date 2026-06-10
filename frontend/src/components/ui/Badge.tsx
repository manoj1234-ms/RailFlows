import { cn } from '@/utils/cn';

interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  children: React.ReactNode;
  className?: string;
}

const colors = {
  default: 'bg-gray-500/20 text-gray-300',
  success: 'bg-[var(--color-success)]/20 text-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]/20 text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger)]/20 text-[var(--color-danger)]',
  info: 'bg-[var(--color-secondary)]/20 text-[var(--color-secondary)]',
};

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', colors[variant], className)}>
      {children}
    </span>
  );
}

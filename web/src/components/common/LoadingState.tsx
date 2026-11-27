import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LoadingStateProps {
  message?: string;
  variant?: 'spinner' | 'skeleton';
  rows?: number;
  columns?: 1 | 2 | 3;
  compact?: boolean;
  className?: string;
}

const SKELETON_COLUMNS_CLASS: Record<1 | 2 | 3, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
};

export function LoadingState({
  message = '加载中...',
  variant = 'spinner',
  rows = 3,
  columns = 3,
  compact = false,
  className,
}: LoadingStateProps) {
  if (variant === 'skeleton') {
    const items = Array.from({ length: Math.max(1, rows) }, (_, index) => index);
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={message}
        className={cn('grid gap-4', SKELETON_COLUMNS_CLASS[columns], className)}
      >
        <span className="sr-only">{message}</span>
        {items.map((item) => (
          <div
            key={item}
            className={cn(
              'animate-pulse space-y-3 rounded-xl border border-border bg-card',
              compact ? 'p-4' : 'p-6',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="h-4 w-24 rounded bg-muted" />
              <div className="h-5 w-16 rounded-full bg-muted" />
            </div>
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-3/4 rounded bg-muted" />
            {!compact ? <div className="h-3 w-2/3 rounded bg-muted" /> : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card/50 text-center',
        compact ? 'px-4 py-6' : 'px-6 py-12',
        className,
      )}
    >
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

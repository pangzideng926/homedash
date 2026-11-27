import type { ReactNode } from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  hideIcon?: boolean;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  hideIcon = false,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 text-center',
        compact ? 'px-4 py-6' : 'px-4 py-10 sm:px-6 sm:py-12',
        className,
      )}
    >
      {!hideIcon ? (
        <div
          className={cn(
            'flex items-center justify-center rounded-lg bg-muted text-muted-foreground',
            compact ? 'mb-2 size-9' : 'mb-3 size-11',
          )}
        >
          <Icon className={compact ? 'size-4' : 'size-5'} aria-hidden="true" />
        </div>
      ) : null}
      <h3
        className={cn(
          'max-w-full break-words font-medium text-foreground',
          compact ? 'text-sm' : 'text-base',
        )}
      >
        {title}
      </h3>
      {description ? (
        <p
          className={cn(
            'mt-1 max-w-md break-words text-muted-foreground',
            compact ? 'text-xs' : 'text-sm',
          )}
        >
          {description}
        </p>
      ) : null}
      {action ? <div className={compact ? 'mt-3' : 'mt-4'}>{action}</div> : null}
    </div>
  );
}

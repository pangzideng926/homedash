import type { ReactNode } from 'react';
import { AlertCircle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function ErrorState({
  title = '加载失败',
  message = '请求数据时发生错误，请稍后重试',
  onRetry,
  retryLabel = '重试',
  action,
  compact = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex min-w-0 flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 text-center',
        compact ? 'px-4 py-5' : 'px-4 py-8 sm:px-6 sm:py-10',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-lg bg-destructive/10 text-destructive',
          compact ? 'mb-2 size-9' : 'mb-3 size-11',
        )}
      >
        <AlertCircle className={compact ? 'size-4' : 'size-5'} aria-hidden="true" />
      </div>
      <h3
        className={cn(
          'max-w-full break-words font-medium text-foreground',
          compact ? 'text-sm' : 'text-base',
        )}
      >
        {title}
      </h3>
      <p
        className={cn(
          'mt-1 max-w-md break-words text-muted-foreground',
          compact ? 'text-xs' : 'text-sm',
        )}
      >
        {message}
      </p>
      {onRetry || action ? (
        <div
          className={cn(
            'flex flex-wrap items-center justify-center gap-2',
            compact ? 'mt-3' : 'mt-4',
          )}
        >
          {onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RotateCw className="size-4" aria-hidden="true" />
              <span>{retryLabel}</span>
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}

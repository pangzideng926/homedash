import { AlertCircle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  title = '加载失败',
  message = '请求数据时发生错误，请稍后重试',
  onRetry,
  retryLabel = '重试',
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="mb-3 flex size-11 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
        <AlertCircle className="size-5" aria-hidden="true" />
      </div>
      <h3 className="text-base font-medium text-foreground">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-4">
          <RotateCw className="size-4" aria-hidden="true" />
          <span>{retryLabel}</span>
        </Button>
      ) : null}
    </div>
  );
}

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { StatusBadge, type StatusVariant } from '@/components/common/StatusBadge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface DataCardProps {
  title: string;
  value: ReactNode;
  description?: string;
  icon?: LucideIcon;
  status?: StatusVariant;
  statusLabel?: string;
  footer?: ReactNode;
  compact?: boolean;
  interactive?: boolean;
  className?: string;
  valueClassName?: string;
  iconClassName?: string;
}

export function DataCard({
  title,
  value,
  description,
  icon: Icon,
  status,
  statusLabel,
  footer,
  compact = false,
  interactive = false,
  className,
  valueClassName,
  iconClassName,
}: DataCardProps) {
  return (
    <Card
      className={cn(
        'flex min-w-0 flex-col justify-between',
        interactive ? 'transition-colors hover:border-primary/40' : null,
        className,
      )}
    >
      <CardHeader
        className={cn(
          'flex flex-row flex-wrap items-start justify-between gap-2 space-y-0',
          compact ? 'px-4 pt-4 pb-2' : 'pb-3',
        )}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle
            className={compact ? 'text-xs font-medium text-muted-foreground' : 'text-base'}
          >
            {title}
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {Icon ? (
          compact ? (
            <Icon
              className={cn('size-4 shrink-0 text-muted-foreground', iconClassName)}
              aria-hidden="true"
            />
          ) : (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className={cn('size-4', iconClassName)} aria-hidden="true" />
            </div>
          )
        ) : null}
      </CardHeader>

      <CardContent className={cn(compact ? 'px-4 pb-3 pt-0' : 'space-y-3')}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div
            className={cn(
              'min-w-0 break-words text-2xl font-semibold tracking-tight tabular-nums text-foreground',
              valueClassName,
            )}
          >
            {value}
          </div>
          {status ? <StatusBadge status={status} label={statusLabel} /> : null}
        </div>
      </CardContent>

      {footer ? (
        <CardFooter
          className={cn(
            'min-w-0 break-words text-muted-foreground',
            compact ? 'px-4 pb-4 pt-0 text-[11px]' : 'text-xs',
          )}
        >
          {footer}
        </CardFooter>
      ) : null}
    </Card>
  );
}

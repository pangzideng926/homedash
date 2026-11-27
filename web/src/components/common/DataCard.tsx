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
  className?: string;
}

export function DataCard({
  title,
  value,
  description,
  icon: Icon,
  status,
  statusLabel,
  footer,
  className,
}: DataCardProps) {
  return (
    <Card className={cn('flex flex-col justify-between', className)}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {Icon ? (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
          {status ? <StatusBadge status={status} label={statusLabel} /> : null}
        </div>
      </CardContent>

      {footer ? <CardFooter className="text-xs text-muted-foreground">{footer}</CardFooter> : null}
    </Card>
  );
}

import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type StatusVariant =
  | 'success'
  | 'configured'
  | 'warning'
  | 'incomplete'
  | 'error'
  | 'unknown'
  | 'unconfigured'
  | 'info';

interface StatusStyleConfig {
  label: string;
  badgeClass: string;
  dotClass: string;
}

const STATUS_STYLE_MAP: Record<StatusVariant, StatusStyleConfig> = {
  success: {
    label: '正常',
    badgeClass: 'border-emerald-500/25 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
    dotClass: 'bg-emerald-500',
  },
  configured: {
    label: '已配置',
    badgeClass: 'border-emerald-500/25 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
    dotClass: 'bg-emerald-500',
  },
  warning: {
    label: '警告',
    badgeClass: 'border-amber-500/25 bg-amber-500/15 text-amber-700 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  },
  incomplete: {
    label: '配置不完整',
    badgeClass: 'border-amber-500/25 bg-amber-500/15 text-amber-700 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  },
  error: {
    label: '异常',
    badgeClass: 'border-red-500/25 bg-red-500/15 text-red-700 dark:text-red-400',
    dotClass: 'bg-red-500',
  },
  unknown: {
    label: '未知',
    badgeClass: 'border-border bg-muted text-muted-foreground',
    dotClass: 'bg-muted-foreground',
  },
  unconfigured: {
    label: '未配置',
    badgeClass: 'border-border bg-muted text-muted-foreground',
    dotClass: 'bg-muted-foreground',
  },
  info: {
    label: '信息',
    badgeClass: 'border-sky-500/25 bg-sky-500/15 text-sky-700 dark:text-sky-400',
    dotClass: 'bg-sky-500',
  },
};

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: StatusVariant;
  label?: string;
  showDot?: boolean;
}

export function StatusBadge({
  status,
  label,
  showDot = true,
  className,
  ...props
}: StatusBadgeProps) {
  const config = STATUS_STYLE_MAP[status] ?? STATUS_STYLE_MAP.unknown;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        config.badgeClass,
        className,
      )}
      {...props}
    >
      {showDot ? (
        <span aria-hidden="true" className={cn('size-1.5 rounded-full', config.dotClass)} />
      ) : null}
      <span>{label ?? config.label}</span>
    </span>
  );
}

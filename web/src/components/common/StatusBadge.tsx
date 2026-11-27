import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type StatusVariant =
  | 'success'
  | 'online'
  | 'configured'
  | 'warning'
  | 'incomplete'
  | 'error'
  | 'offline'
  | 'danger'
  | 'unknown'
  | 'unconfigured'
  | 'muted'
  | 'info';

export type StatusBadgeSize = 'sm' | 'md';

interface StatusStyleConfig {
  label: string;
  badgeClass: string;
  dotClass: string;
}

const EMERALD_STYLE = {
  badgeClass: 'border-emerald-500/25 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  dotClass: 'bg-emerald-500',
};

const AMBER_STYLE = {
  badgeClass: 'border-amber-500/25 bg-amber-500/15 text-amber-700 dark:text-amber-400',
  dotClass: 'bg-amber-500',
};

const RED_STYLE = {
  badgeClass: 'border-red-500/25 bg-red-500/15 text-red-700 dark:text-red-400',
  dotClass: 'bg-red-500',
};

const MUTED_STYLE = {
  badgeClass: 'border-border bg-muted text-muted-foreground',
  dotClass: 'bg-muted-foreground',
};

const INFO_STYLE = {
  badgeClass: 'border-sky-500/25 bg-sky-500/15 text-sky-700 dark:text-sky-400',
  dotClass: 'bg-sky-500',
};

const STATUS_STYLE_MAP: Record<StatusVariant, StatusStyleConfig> = {
  success: { label: '正常', ...EMERALD_STYLE },
  online: { label: '在线', ...EMERALD_STYLE },
  configured: { label: '已配置', ...EMERALD_STYLE },
  warning: { label: '警告', ...AMBER_STYLE },
  incomplete: { label: '配置不完整', ...AMBER_STYLE },
  error: { label: '异常', ...RED_STYLE },
  offline: { label: '离线', ...RED_STYLE },
  danger: { label: '危险', ...RED_STYLE },
  unknown: { label: '未知', ...MUTED_STYLE },
  unconfigured: { label: '未配置', ...MUTED_STYLE },
  muted: { label: '未知', ...MUTED_STYLE },
  info: { label: '信息', ...INFO_STYLE },
};

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: StatusVariant;
  label?: string;
  showDot?: boolean;
  size?: StatusBadgeSize;
}

export function StatusBadge({
  status,
  label,
  showDot = true,
  size = 'md',
  className,
  ...props
}: StatusBadgeProps) {
  const config = STATUS_STYLE_MAP[status] ?? STATUS_STYLE_MAP.unknown;

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0 text-[11px]' : 'px-2.5 py-0.5 text-xs',
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

import type { ReactNode } from 'react';
import {
  clampPercent,
  getProgressBarColorClass,
  getProgressLevel,
} from '@/components/common/progress-utils';
import { cn } from '@/lib/utils';

export type ProgressBarTone = 'usage' | 'info' | 'success' | 'warning' | 'danger';
export type ProgressBarSize = 'sm' | 'md';

export interface ProgressBarProps {
  value: number;
  ariaLabel?: string;
  label?: ReactNode;
  valueText?: ReactNode;
  showPercent?: boolean;
  tone?: ProgressBarTone;
  warnThreshold?: number;
  dangerThreshold?: number;
  size?: ProgressBarSize;
  className?: string;
  trackClassName?: string;
}

const FIXED_TONE_CLASS: Record<Exclude<ProgressBarTone, 'usage'>, string> = {
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
};

export function ProgressBar({
  value,
  ariaLabel,
  label,
  valueText,
  showPercent = false,
  tone = 'usage',
  warnThreshold = 75,
  dangerThreshold = 90,
  size = 'md',
  className,
  trackClassName,
}: ProgressBarProps) {
  const clamped = clampPercent(value);
  const level = getProgressLevel(clamped, warnThreshold, dangerThreshold);
  const fillClass =
    tone === 'usage'
      ? getProgressBarColorClass(clamped, warnThreshold, dangerThreshold)
      : FIXED_TONE_CLASS[tone];

  const computedAriaLabel = ariaLabel ?? (typeof label === 'string' ? label : '进度');
  const displayValue = valueText ?? (showPercent ? `${clamped}%` : null);
  const hasHeader = Boolean(label) || displayValue !== null;

  return (
    <div className={cn('min-w-0 w-full', hasHeader ? 'space-y-1.5' : undefined, className)}>
      {hasHeader ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
          {label ? (
            <span className="min-w-[3.5rem] max-w-full flex-1 truncate text-muted-foreground">
              {label}
            </span>
          ) : (
            <span />
          )}
          {displayValue !== null ? (
            <span className="max-w-full break-words font-medium tabular-nums text-foreground">
              {displayValue}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={computedAriaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        data-level={level}
        className={cn(
          'w-full overflow-hidden rounded-full bg-muted',
          size === 'sm' ? 'h-1.5' : 'h-2.5',
          trackClassName,
        )}
      >
        <div
          className={cn('h-full rounded-full transition-all', fillClass)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

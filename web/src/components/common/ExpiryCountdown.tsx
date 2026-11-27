import { StatusBadge } from '@/components/common/StatusBadge';
import {
  formatExpiryBadgeLabel,
  getExpiryPanelStyles,
  getExpiryStatusVariant,
  type ExpiryLevel,
} from '@/components/common/expiry-utils';
import { cn } from '@/lib/utils';

export interface ExpiryCountdownProps {
  daysLeft: number | null;
  level: ExpiryLevel | null;
  expiresAt?: string | null;
  error?: string;
  size?: 'md' | 'sm';
  showBadge?: boolean;
  className?: string;
}

export function ExpiryCountdown({
  daysLeft,
  level,
  expiresAt,
  error,
  size = 'md',
  showBadge = true,
  className,
}: ExpiryCountdownProps) {
  const hasError = Boolean(error) || daysLeft === null || level === null;
  const panelStyles = getExpiryPanelStyles(level, hasError);
  const badgeVariant = getExpiryStatusVariant(level, hasError);
  const badgeLabel = formatExpiryBadgeLabel(daysLeft, level, hasError);
  const numberSizeClass = size === 'sm' ? 'text-xl' : 'text-2xl';

  return (
    <div
      className={cn(
        'min-w-0 w-full rounded-lg border',
        size === 'sm' ? 'px-3 py-2' : 'px-3.5 py-3',
        panelStyles.containerClass,
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline">
            {hasError || daysLeft === null ? (
              <span
                className={cn(numberSizeClass, 'font-bold tracking-tight', panelStyles.accentClass)}
              >
                异常
              </span>
            ) : daysLeft < 0 ? (
              <>
                <span
                  className={cn(
                    numberSizeClass,
                    'font-bold tracking-tight tabular-nums',
                    panelStyles.accentClass,
                  )}
                >
                  {Math.abs(daysLeft)}
                </span>
                <span className="ml-1 text-xs font-medium text-muted-foreground">天前到期</span>
              </>
            ) : daysLeft === 0 ? (
              <>
                <span
                  className={cn(
                    numberSizeClass,
                    'font-bold tracking-tight tabular-nums',
                    panelStyles.accentClass,
                  )}
                >
                  0
                </span>
                <span className="ml-1 text-xs font-medium text-muted-foreground">天（今日）</span>
              </>
            ) : (
              <>
                <span
                  className={cn(
                    numberSizeClass,
                    'font-bold tracking-tight tabular-nums',
                    panelStyles.accentClass,
                  )}
                >
                  {daysLeft}
                </span>
                <span className="ml-1 text-xs font-medium text-muted-foreground">天</span>
              </>
            )}
          </div>
          {expiresAt !== undefined ? (
            <p className="mt-0.5 break-words font-mono text-xs text-muted-foreground">
              到期日：{expiresAt || '—'}
            </p>
          ) : null}
        </div>

        {showBadge ? <StatusBadge status={badgeVariant} label={badgeLabel} /> : null}
      </div>

      {error ? <p className="mt-1.5 break-words text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

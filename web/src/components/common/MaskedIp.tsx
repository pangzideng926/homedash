import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { maskIpAddress } from '@/components/common/ip-utils';
import { cn } from '@/lib/utils';

export interface MaskedIpProps {
  ip: string;
  label?: string;
  variant?: 'row' | 'inline';
  defaultRevealed?: boolean;
  revealed?: boolean;
  onRevealedChange?: (revealed: boolean) => void;
  showLabel?: string;
  hideLabel?: string;
  className?: string;
}

export function MaskedIp({
  ip,
  label = 'IP',
  variant = 'row',
  defaultRevealed = false,
  revealed,
  onRevealedChange,
  showLabel = '显示 IP',
  hideLabel = '隐藏 IP',
  className,
}: MaskedIpProps) {
  const [internalRevealed, setInternalRevealed] = useState(defaultRevealed);
  const isControlled = revealed !== undefined;
  const isRevealed = isControlled ? revealed : internalRevealed;

  const handleToggle = () => {
    const next = !isRevealed;
    if (!isControlled) {
      setInternalRevealed(next);
    }
    onRevealedChange?.(next);
  };

  const buttonNode = (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={isRevealed ? hideLabel : showLabel}
      aria-pressed={isRevealed}
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 font-mono text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        variant === 'inline' ? 'text-xs' : null,
      )}
    >
      <span className={isRevealed ? 'break-all text-right' : 'truncate'}>
        {isRevealed ? ip : maskIpAddress(ip)}
      </span>
      {isRevealed ? (
        <EyeOff className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : (
        <Eye className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
    </button>
  );

  if (variant === 'inline') {
    return <span className={cn('inline-flex min-w-0 items-center', className)}>{buttonNode}</span>;
  }

  return (
    <div
      className={cn(
        'flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/30 px-2.5 py-1.5 text-xs',
        className,
      )}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      {buttonNode}
    </div>
  );
}

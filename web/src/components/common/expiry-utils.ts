import type { StatusVariant } from '@/components/common/StatusBadge';

export type ExpiryLevel = 'expired' | 'danger' | 'warning' | 'ok';

export function getExpiryStatusVariant(level: ExpiryLevel | null, hasError = false): StatusVariant {
  if (hasError || level === null || level === 'expired' || level === 'danger') {
    return 'error';
  }
  if (level === 'warning') {
    return 'warning';
  }
  return 'success';
}

export function formatExpiryBadgeLabel(
  daysLeft: number | null,
  level: ExpiryLevel | null,
  hasError = false,
): string {
  if (hasError || daysLeft === null || level === null) {
    return '格式错误';
  }
  if (level === 'expired' || daysLeft < 0) {
    return `已过期 ${Math.abs(daysLeft)} 天`;
  }
  if (daysLeft === 0) {
    return '今天到期';
  }
  return `剩余 ${daysLeft} 天`;
}

export function getExpiryPanelStyles(
  level: ExpiryLevel | null,
  hasError = false,
): {
  containerClass: string;
  accentClass: string;
} {
  if (hasError || level === null || level === 'expired' || level === 'danger') {
    return {
      containerClass: 'border-red-500/25 bg-red-500/5',
      accentClass: 'text-red-600 dark:text-red-400',
    };
  }
  if (level === 'warning') {
    return {
      containerClass: 'border-amber-500/25 bg-amber-500/5',
      accentClass: 'text-amber-600 dark:text-amber-400',
    };
  }
  return {
    containerClass: 'border-emerald-500/25 bg-emerald-500/5',
    accentClass: 'text-emerald-600 dark:text-emerald-400',
  };
}

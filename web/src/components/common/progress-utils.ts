export type ProgressLevel = 'normal' | 'warning' | 'danger';

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function getProgressLevel(percent: number, warnAt = 75, dangerAt = 90): ProgressLevel {
  if (percent >= dangerAt) return 'danger';
  if (percent >= warnAt) return 'warning';
  return 'normal';
}

export function getProgressBarColorClass(percent: number, warnAt = 75, dangerAt = 90): string {
  const level = getProgressLevel(percent, warnAt, dangerAt);
  if (level === 'danger') return 'bg-red-500';
  if (level === 'warning') return 'bg-amber-500';
  return 'bg-emerald-500';
}

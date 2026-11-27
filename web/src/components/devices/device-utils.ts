import type { DetectedOs, DeviceOsConfig } from '@/lib/api';

export function getOsLabel(os: DetectedOs | DeviceOsConfig): string {
  if (os === 'windows') return 'Windows';
  if (os === 'macos') return 'macOS';
  if (os === 'linux') return 'Linux';
  if (os === 'auto') return '自动识别';
  return '未知系统';
}

export function formatUptime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);

  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }
  return `${minutes} 分钟`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex >= 2 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function getUsageLevel(percent: number): 'danger' | 'warning' | 'normal' {
  if (percent >= 90) return 'danger';
  if (percent >= 75) return 'warning';
  return 'normal';
}

export function getBarColorClass(percent: number): string {
  const level = getUsageLevel(percent);
  if (level === 'danger') return 'bg-red-500';
  if (level === 'warning') return 'bg-amber-500';
  return 'bg-emerald-500';
}

import type { StatusVariant } from '@/components/common';
import type { MediaSubscriptionItem, MediaSubscriptionNextAir } from '@/lib/api';

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

export function formatRelativeTime(
  importedAt: string,
  fallbackDate = '',
  nowMs: number = Date.now(),
): string {
  const source = importedAt || fallbackDate;
  if (!source) return '未知时间';

  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) {
    return fallbackDate || source;
  }

  const diffSeconds = Math.floor((nowMs - parsed.getTime()) / 1000);
  if (diffSeconds < 60) {
    return '刚刚';
  }
  if (diffSeconds < 3600) {
    return `${Math.floor(diffSeconds / 60)} 分钟前`;
  }
  if (diffSeconds < 86400) {
    return `${Math.floor(diffSeconds / 3600)} 小时前`;
  }
  const diffDays = Math.floor(diffSeconds / 86400);
  if (diffDays < 30) {
    return `${diffDays} 天前`;
  }
  return fallbackDate || source;
}

export function formatNextAirLabel(nextAir: MediaSubscriptionNextAir | null): string {
  if (!nextAir || !nextAir.date) {
    return '暂无排期';
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nextAir.date.trim());
  if (!match) {
    return nextAir.episodeNumber !== null
      ? `${nextAir.date} 第 ${nextAir.episodeNumber} 集`
      : nextAir.date;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  const weekday = WEEKDAY_LABELS[dt.getUTCDay()] ?? '';
  const dateShort = `${match[2]}/${match[3]}`;
  if (nextAir.episodeNumber !== null) {
    return `${weekday} ${dateShort} 第 ${nextAir.episodeNumber} 集`;
  }
  return `${weekday} ${dateShort}`;
}

export function formatMissingEpisodesBadge(
  episodes: readonly number[],
  maxShow = 6,
): string | null {
  if (episodes.length === 0) return null;
  const visible = episodes
    .slice(0, maxShow)
    .map((ep) => `E${String(ep).padStart(2, '0')}`)
    .join('、');
  if (episodes.length > maxShow) {
    return `缺 ${visible} + 更多`;
  }
  return `缺 ${visible}`;
}

export function isMovieSubscription(item: Pick<MediaSubscriptionItem, 'type'>): boolean {
  const lower = item.type.trim().toLowerCase();
  return lower === '电影' || lower === 'movie' || lower === 'movies';
}

export function getMovieAvailabilityBadge(item: MediaSubscriptionItem): {
  label: string;
  status: StatusVariant;
} {
  if (
    item.downloadedEpisodes.length > 0 ||
    item.lackEpisode === 0 ||
    (item.completedEpisode ?? 0) >= 1
  ) {
    return { label: '已入库', status: 'success' };
  }
  if (item.hasAired === false || item.nextAir !== null) {
    return { label: '待上映', status: 'info' };
  }
  return { label: '已上映未入库', status: 'warning' };
}

export function getMediaDownloadStateVariant(state: string): StatusVariant {
  if (state === '下载中' || state === '校验中') return 'info';
  if (state === '做种中' || state === '已完成') return 'success';
  if (state === '出错') return 'error';
  if (state === '等待连接' || state === '获取元数据') return 'warning';
  return 'unknown';
}

export function getMediaSubscribeStateVariant(state: string): StatusVariant {
  if (state === '订阅中') return 'info';
  if (state === '新建') return 'success';
  if (state === '暂停') return 'warning';
  return 'unknown';
}

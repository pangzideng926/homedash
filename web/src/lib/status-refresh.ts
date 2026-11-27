export const STATUS_REFRESH_STORAGE_KEY = 'homedash.statusRefreshIntervalSeconds';
export const STATUS_REFRESH_BROADCAST_CHANNEL = 'homedash.status-refresh';
export const STATUS_REFRESH_SYNC_STORAGE_KEY = 'homedash.statusRefreshSync';
export const STATUS_REFRESH_INTERVAL_EVENT = 'homedash:status-refresh-interval-changed';

export type StatusRefreshIntervalSeconds = 0 | 60 | 300 | 900;
export type StatusRefreshTopic = 'devices' | 'nas';

export const DEFAULT_STATUS_REFRESH_INTERVAL_SECONDS: StatusRefreshIntervalSeconds = 300;

export const STATUS_REFRESH_OPTIONS: ReadonlyArray<{
  value: StatusRefreshIntervalSeconds;
  label: string;
}> = [
  { value: 60, label: '1 分钟' },
  { value: 300, label: '5 分钟' },
  { value: 900, label: '15 分钟' },
  { value: 0, label: '关闭' },
];

export type StatusBroadcastMessage =
  | {
      type: 'status-updated';
      topic: StatusRefreshTopic;
      senderId: string;
      eventId: string;
      timestamp: number;
      payload?: unknown;
    }
  | {
      type: 'interval-changed';
      intervalSeconds: StatusRefreshIntervalSeconds;
      senderId: string;
    };

export interface StatusStorageSyncPayload {
  topic: StatusRefreshTopic;
  senderId: string;
  eventId: string;
  timestamp: number;
}

export function parseStatusRefreshInterval(
  raw: string | number | null | undefined,
): StatusRefreshIntervalSeconds {
  if (raw === 0 || raw === '0') return 0;
  if (raw === 60 || raw === '60') return 60;
  if (raw === 300 || raw === '300') return 300;
  if (raw === 900 || raw === '900') return 900;
  return DEFAULT_STATUS_REFRESH_INTERVAL_SECONDS;
}

export function readStatusRefreshInterval(): StatusRefreshIntervalSeconds {
  try {
    return parseStatusRefreshInterval(localStorage.getItem(STATUS_REFRESH_STORAGE_KEY));
  } catch {
    return DEFAULT_STATUS_REFRESH_INTERVAL_SECONDS;
  }
}

export function createTabSenderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function writeStatusRefreshInterval(
  seconds: StatusRefreshIntervalSeconds,
  senderId: string = 'settings',
): void {
  const normalized = parseStatusRefreshInterval(seconds);
  try {
    localStorage.setItem(STATUS_REFRESH_STORAGE_KEY, String(normalized));
  } catch {
    // 忽略存储受限异常
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<StatusRefreshIntervalSeconds>(STATUS_REFRESH_INTERVAL_EVENT, {
        detail: normalized,
      }),
    );
  }

  if (typeof BroadcastChannel === 'function') {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(STATUS_REFRESH_BROADCAST_CHANNEL);
      const message: StatusBroadcastMessage = {
        type: 'interval-changed',
        intervalSeconds: normalized,
        senderId,
      };
      channel.postMessage(message);
    } catch {
      // 忽略广播异常
    } finally {
      channel?.close();
    }
  }
}

export function broadcastStatusUpdate(params: {
  topic: StatusRefreshTopic;
  senderId: string;
  payload?: unknown;
}): string {
  const eventId = `${params.senderId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = Date.now();

  if (typeof BroadcastChannel === 'function') {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(STATUS_REFRESH_BROADCAST_CHANNEL);
      const message: StatusBroadcastMessage = {
        type: 'status-updated',
        topic: params.topic,
        senderId: params.senderId,
        eventId,
        timestamp,
        ...(params.payload !== undefined ? { payload: params.payload } : {}),
      };
      channel.postMessage(message);
    } catch {
      // 忽略广播异常
    } finally {
      channel?.close();
    }
  }

  // localStorage 事件兜底（仅写入轻量元数据，不包含敏感内容）
  try {
    const syncPayload: StatusStorageSyncPayload = {
      topic: params.topic,
      senderId: params.senderId,
      eventId,
      timestamp,
    };
    localStorage.setItem(STATUS_REFRESH_SYNC_STORAGE_KEY, JSON.stringify(syncPayload));
  } catch {
    // 忽略存储受限异常
  }

  return eventId;
}

function toTimestampMs(isoOrMs: string | number | null | undefined): number | null {
  if (isoOrMs === null || isoOrMs === undefined || isoOrMs === '') {
    return null;
  }
  if (typeof isoOrMs === 'number') {
    return Number.isFinite(isoOrMs) ? isoOrMs : null;
  }
  const parsed = Date.parse(isoOrMs);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatRelativeTimeSince(
  isoOrMs: string | number | null | undefined,
  nowMs: number = Date.now(),
): string {
  const ts = toTimestampMs(isoOrMs);
  if (ts === null) {
    return '尚未更新';
  }
  const diffMs = Math.max(0, nowMs - ts);
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) {
    return '刚刚';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} 天前`;
}

export function formatLastUpdated(
  isoOrMs: string | number | null | undefined,
  nowMs: number = Date.now(),
): string {
  const ts = toTimestampMs(isoOrMs);
  if (ts === null) {
    return '尚未更新';
  }
  return `上次更新 ${formatRelativeTimeSince(ts, nowMs)}`;
}

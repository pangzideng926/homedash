import type { DownloaderTag, DownloaderType } from '../integrations/types.js';

export type DownloaderErrorCode =
  | 'UNCONFIGURED'
  | 'AUTH_FAILED'
  | 'IP_BANNED'
  | 'TIMEOUT'
  | 'CONNECTION_FAILED'
  | 'API_ERROR'
  | 'PARSE_FAILED';

export interface DownloaderStateCounts {
  seeding: number;
  downloading: number;
  paused: number;
  error: number;
  stalled: number;
  total: number;
}

export interface DownloaderTrackerStat {
  domain: string;
  count: number;
  seedingCount: number;
  size: number;
}

export interface DownloaderGroupStat {
  name: string;
  count: number;
  seedingCount: number;
  size: number;
}

export interface DownloaderProblemTorrent {
  id: string;
  name: string;
  state: string;
  reason: string;
  size: number;
  trackerDomain: string;
  group: string;
  progress: number;
}

export interface DownloaderInstanceSummary {
  id: string;
  name: string;
  type: DownloaderType;
  tags: DownloaderTag[];
  online: boolean;
  checkedAt: string;
  cached: boolean;
  errorCode?: DownloaderErrorCode;
  error?: string;
  version: string;
  upSpeed: number;
  dlSpeed: number;
  totalUploaded?: number;
  totalDownloaded?: number;
  ratio?: number;
  totalsApproximate?: boolean;
  counts: DownloaderStateCounts;
  totalSize: number;
  byTracker: DownloaderTrackerStat[];
  byCategory?: DownloaderGroupStat[];
  byLabel?: DownloaderGroupStat[];
  problems: DownloaderProblemTorrent[];
  problemsTotal: number;
}

export interface DownloadersSummaryTotals {
  totalInstances: number;
  onlineInstances: number;
  offlineInstances: number;
  upSpeed: number;
  dlSpeed: number;
  totalSize: number;
  counts: DownloaderStateCounts;
}

export interface DownloadersSummaryResponse {
  configured: boolean;
  mock: boolean;
  checkedAt: string;
  instances: DownloaderInstanceSummary[];
  totals: DownloadersSummaryTotals;
}

export interface DownloaderTestResponse {
  ok: boolean;
  type: DownloaderType;
  version?: string;
  durationMs: number;
  detail?: string;
  error?: string;
}

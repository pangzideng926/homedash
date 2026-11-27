export interface QbitStateCounts {
  seeding: number;
  downloading: number;
  paused: number;
  error: number;
  stalled: number;
  other: number;
  total: number;
}

export interface QbitGroupStat {
  name: string;
  seedingCount: number;
  totalCount: number;
  totalSizeBytes: number;
}

export interface QbitProblemTorrent {
  hash: string;
  name: string;
  state: string;
  reason: string;
  sizeBytes: number;
  trackerDomain: string;
  category: string;
  progress: number;
}

export interface QbitSummaryData {
  version: string;
  transfer: {
    upSpeed: number;
    dlSpeed: number;
    alltimeUploadBytes: number;
    alltimeDownloadBytes: number;
    globalRatio: number;
    totalsApproximate: boolean;
  };
  counts: QbitStateCounts;
  byTracker: QbitGroupStat[];
  byCategory: QbitGroupStat[];
  problemTorrents: QbitProblemTorrent[];
  problemTorrentsTotal: number;
}

export type QbitErrorCode =
  | 'UNCONFIGURED'
  | 'AUTH_FAILED'
  | 'IP_BANNED'
  | 'TIMEOUT'
  | 'CONNECTION_FAILED'
  | 'API_ERROR'
  | 'PARSE_FAILED';

export interface QbitSummaryResponse {
  configured: boolean;
  mock: boolean;
  online: boolean;
  checkedAt: string;
  cached: boolean;
  errorCode?: QbitErrorCode;
  error?: string;
  data?: QbitSummaryData;
}

export interface MoviepilotSubscribeItem {
  id: number | string;
  name: string;
  year: string;
  type: string;
  season: number | null;
  state: string;
  totalEpisode: number | null;
  lackEpisode: number | null;
  lastUpdate: string;
}

export interface MoviepilotTransferItem {
  title: string;
  year: string;
  type: string;
  seasons: string;
  episodes: string;
  status: boolean;
  errmsg: string;
  date: string;
  category: string;
}

export interface MoviepilotDownloadItem {
  title: string;
  name: string;
  siteName: string;
  size: number;
  progress: number;
  state: string;
  dlSpeed: number;
  upSpeed: number;
  leftTime: string;
  downloader: string;
}

export interface MoviepilotSiteStatus {
  id: number | string;
  name: string;
  domain: string;
  isActive: boolean;
  priority: number | null;
  successCount: number;
  failCount: number;
  avgSeconds: number | null;
  lastState: 'success' | 'fail' | 'unknown';
  lastModDate: string;
}

export interface MoviepilotDownloaderStats {
  downloadSpeed: number;
  uploadSpeed: number;
  downloadSize: number;
  uploadSize: number;
  freeSpace: number;
}

export interface MoviepilotSummaryData {
  subscribes: MoviepilotSubscribeItem[];
  transfers: MoviepilotTransferItem[];
  transferTotal: number;
  downloads: MoviepilotDownloadItem[];
  sites: MoviepilotSiteStatus[];
  downloader: MoviepilotDownloaderStats | null;
}

export type MoviepilotErrorCode =
  'UNCONFIGURED' | 'AUTH_FAILED' | 'TIMEOUT' | 'CONNECTION_FAILED' | 'API_ERROR' | 'PARSE_FAILED';

export interface MoviepilotSummaryResponse {
  configured: boolean;
  mock: boolean;
  online: boolean;
  checkedAt: string;
  cached: boolean;
  errorCode?: MoviepilotErrorCode;
  error?: string;
  data?: MoviepilotSummaryData;
}

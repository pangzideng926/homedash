export interface MediaOverviewLibraryStats {
  movieCount: number;
  tvCount: number;
  episodeCount: number;
}

export interface MediaOverviewStats {
  downloading: number;
  pendingTransfer: number | null;
  todayImported: number;
  todayImportedApproximate: boolean;
  seeding: number | null;
  seedUploadSpeed: number | null;
  seedTotalUploaded: number | null;
  library: MediaOverviewLibraryStats | null;
}

export interface MediaRecentTransferCard {
  title: string;
  year: string;
  type: string;
  season: string;
  episodes: string;
  episodeCount: number | null;
  date: string;
  importedAt: string;
  posterUrl: string | null;
}

export interface MediaOverviewResponse {
  configured: boolean;
  mock: boolean;
  checkedAt: string;
  cached: boolean;
  warnings: string[];
  stats: MediaOverviewStats;
  recent: MediaRecentTransferCard[];
}

export interface MediaDownloadTaskItem {
  hash: string;
  displayName: string;
  torrentName: string;
  year: string;
  seasonEpisode: string;
  posterUrl: string | null;
  progress: number;
  dlSpeed: number | null;
  upSpeed: number | null;
  dlSpeedText: string | null;
  upSpeedText: string | null;
  eta: number | null;
  leftTime: string | null;
  size: number;
  state: string;
  instanceName: string;
  site: string;
  matched: boolean;
}

export interface MediaDownloadsResponse {
  configured: boolean;
  mock: boolean;
  checkedAt: string;
  cached: boolean;
  warnings: string[];
  items: MediaDownloadTaskItem[];
}

export interface MediaSubscriptionNextAir {
  date: string;
  episodeNumber: number | null;
  name: string;
}

export interface MediaSubscriptionItem {
  id: number | string;
  name: string;
  year: string;
  type: string;
  season: number | null;
  posterUrl: string | null;
  state: string;
  totalEpisode: number | null;
  startEpisode: number | null;
  completedEpisode: number | null;
  lackEpisode: number | null;
  downloadedEpisodes: number[];
  latestEpisode: number | null;
  missingEpisodes: number[];
  missingInferred: boolean;
  nextAir: MediaSubscriptionNextAir | null;
  hasAired: boolean | null;
  lastUpdate: string;
}

export interface MediaSubscriptionsResponse {
  configured: boolean;
  mock: boolean;
  checkedAt: string;
  cached: boolean;
  calendarAvailable: boolean;
  warnings: string[];
  items: MediaSubscriptionItem[];
}

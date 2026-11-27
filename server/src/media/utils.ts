import { normalizeQbitEta } from '../downloaders/aggregators.js';
import type { ResolvedDownloaderInstance } from '../integrations/types.js';
import type {
  MediaDownloadTaskItem,
  MediaRecentTransferCard,
  MediaSubscriptionItem,
  MediaSubscriptionNextAir,
} from './types.js';

export const QBIT_DOWNLOADING_CLASS_STATES = new Set([
  'downloading',
  'forcedDL',
  'metaDL',
  'forcedMetaDL',
  'queuedDL',
  'checkingDL',
  'allocating',
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (isRecord(value) && Array.isArray(value.data)) {
    return value.data.filter(isRecord);
  }
  return [];
}

export function toStr(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

export function toNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function toBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
  }
  return fallback;
}

/**
 * 筛选影视模块可用的下载实例：仅启用、qBittorrent、带 download 标签且不含 brush 标签。
 */
export function selectMediaDownloadInstances(
  instances: readonly ResolvedDownloaderInstance[],
): ResolvedDownloaderInstance[] {
  return instances.filter(
    (inst) =>
      inst.enabled &&
      inst.type === 'qbittorrent' &&
      inst.tags.includes('download') &&
      !inst.tags.includes('brush'),
  );
}

/**
 * 筛选影视模块可用的保种实例：启用、带 seed 标签且不含 brush 标签。
 */
export function selectMediaSeedInstances(
  instances: readonly ResolvedDownloaderInstance[],
): ResolvedDownloaderInstance[] {
  return instances.filter(
    (inst) => inst.enabled && inst.tags.includes('seed') && !inst.tags.includes('brush'),
  );
}

/**
 * 判断实例是否带有 brush 刷流标签。
 */
export function isBrushInstance(instance: Pick<ResolvedDownloaderInstance, 'tags'>): boolean {
  return instance.tags.includes('brush');
}

/**
 * 获取指定时区下的 YYYY-MM-DD 日期字符串。
 */
export function getDateKeyInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

const DATE_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}:\d{2}))?/;
const HAS_TZ_SUFFIX_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * 解析 MoviePilot 时间字符串在展示时区下的 YYYY-MM-DD 日期键。
 */
export function parseMpDateKey(rawDate: string, timeZone: string): string | null {
  const trimmed = rawDate.trim();
  if (!trimmed) return null;

  if (HAS_TZ_SUFFIX_PATTERN.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return getDateKeyInTimeZone(parsed, timeZone);
    }
  }

  const match = DATE_PREFIX_PATTERN.exec(trimmed);
  if (match && match[1]) {
    return match[1];
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return getDateKeyInTimeZone(parsed, timeZone);
  }
  return null;
}

/**
 * 对 YYYY-MM-DD 日期键增减天数。
 */
export function addDaysToDateKey(dateKey: string, deltaDays: number): string {
  const parts = dateKey.split('-').map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const dt = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return dt.toISOString().slice(0, 10);
}

/**
 * 计算两个 YYYY-MM-DD 日期键之间相隔天数（toKey - fromKey）。
 */
export function diffDateKeys(fromKey: string, toKey: string): number {
  const [fy = 1970, fm = 1, fd = 1] = fromKey.split('-').map(Number);
  const [ty = 1970, tm = 1, td = 1] = toKey.split('-').map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / 86_400_000);
}

function formatOffsetForTimeZone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';
    const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(tzPart);
    if (!match) return 'Z';
    const sign = match[1];
    const hh = String(match[2]).padStart(2, '0');
    const mm = String(match[3] ?? '00').padStart(2, '0');
    return `${sign}${hh}:${mm}`;
  } catch {
    return '+08:00';
  }
}

/**
 * 将 MoviePilot 时间字段转换为规范 ISO 时间戳（无时区字段按展示时区解释），便于前端准确展示相对时间。
 */
export function toIsoTimestampInTimeZone(rawDate: string, timeZone: string): string {
  const trimmed = rawDate.trim();
  if (!trimmed) return '';
  if (HAS_TZ_SUFFIX_PATTERN.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  }

  const match = DATE_PREFIX_PATTERN.exec(trimmed);
  if (match && match[1]) {
    const datePart = match[1];
    const timePart = match[2] ?? '00:00:00';
    const approxUtc = new Date(`${datePart}T${timePart}Z`);
    if (Number.isNaN(approxUtc.getTime())) return '';
    const offset = formatOffsetForTimeZone(approxUtc, timeZone);
    const withOffset = new Date(`${datePart}T${timePart}${offset}`);
    return Number.isNaN(withOffset.getTime()) ? '' : withOffset.toISOString();
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

/**
 * 解析整理记录的集数文本（支持 E03、E01-E03、E01,E02、01-03 等）。
 */
export function parseEpisodeNumbers(raw: string): number[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const nums = new Set<number>();
  const tokens = trimmed.split(/[,，、\s]+/).filter(Boolean);
  for (const token of tokens) {
    const rangeMatch = /^E?(\d{1,4})\s*[-~～]\s*E?(\d{1,4})$/i.exec(token);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start) {
        const cappedEnd = Math.min(end, start + 500);
        for (let ep = start; ep <= cappedEnd; ep += 1) {
          nums.add(ep);
        }
        continue;
      }
    }

    const singleMatches = token.matchAll(/E?(\d{1,4})/gi);
    for (const m of singleMatches) {
      const ep = Number(m[1]);
      if (Number.isInteger(ep) && ep >= 1) {
        nums.add(ep);
      }
    }
  }
  return [...nums].sort((a, b) => a - b);
}

function formatEpisodeNumber(ep: number): string {
  return `E${String(ep).padStart(2, '0')}`;
}

/**
 * 将正整数集号列表压缩为人类可读的集范围文本（如 E03-E05 或 E01-E02, E04）。
 */
export function formatEpisodeRanges(episodes: readonly number[]): string {
  if (episodes.length === 0) return '';
  const sorted = [...new Set(episodes.filter((n) => Number.isInteger(n) && n >= 1))].sort(
    (a, b) => a - b,
  );
  if (sorted.length === 0) return '';

  const segments: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;

  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i]!;
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    segments.push(
      start === prev
        ? formatEpisodeNumber(start)
        : `${formatEpisodeNumber(start)}-${formatEpisodeNumber(prev)}`,
    );
    start = cur;
    prev = cur;
  }
  segments.push(
    start === prev
      ? formatEpisodeNumber(start)
      : `${formatEpisodeNumber(start)}-${formatEpisodeNumber(prev)}`,
  );
  return segments.join(', ');
}

function normalizeSeasonCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^\d+$/.test(trimmed)) {
    return `S${trimmed.padStart(2, '0')}`;
  }
  const sMatch = /^S(\d+)$/i.exec(trimmed);
  if (sMatch) {
    return `S${String(sMatch[1]).padStart(2, '0')}`;
  }
  return trimmed.toUpperCase();
}

export interface RawTransferHistoryParsed {
  list: Record<string, unknown>[];
  total: number;
}

export function extractTransferHistoryList(raw: unknown): RawTransferHistoryParsed {
  if (Array.isArray(raw)) {
    return { list: raw.filter(isRecord), total: raw.length };
  }
  if (isRecord(raw)) {
    const node = isRecord(raw.data) ? raw.data : raw;
    const list = Array.isArray(node.list) ? node.list.filter(isRecord) : [];
    const total = toNum(node.total) ?? list.length;
    return { list, total };
  }
  return { list: [], total: 0 };
}

/**
 * 合并同一部剧集同一季的成功入库记录为单张海报卡片，最多返回 24 张；
 * 严格白名单提取字段，绝不读取或透传 dest 路径。
 */
export function groupRecentTransfers(
  rawList: readonly Record<string, unknown>[],
  toPosterUrl: (rawImage: unknown) => string | null,
  timeZone: string,
  maxCards = 24,
): MediaRecentTransferCard[] {
  interface GroupBucket {
    title: string;
    year: string;
    type: string;
    season: string;
    episodeNums: Set<number>;
    rawEpisodeTexts: Set<string>;
    latestDate: string;
    latestImportedAt: string;
    latestSortMs: number;
    posterUrl: string | null;
  }

  const buckets = new Map<string, GroupBucket>();

  for (const item of rawList) {
    if (!toBool(item.status, false)) continue;

    const title = toStr(item.title, '未知条目');
    const year = toStr(item.year);
    const type = toStr(item.type);
    const season = normalizeSeasonCode(toStr(item.seasons));
    const episodesRaw = toStr(item.episodes);
    const date = toStr(item.date);
    const importedAt = toIsoTimestampInTimeZone(date, timeZone);
    const sortMs = importedAt ? new Date(importedAt).getTime() : 0;
    const posterUrl = toPosterUrl(item.image);

    const key = `${title.toLowerCase()}||${season}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        title,
        year,
        type,
        season,
        episodeNums: new Set<number>(),
        rawEpisodeTexts: new Set<string>(),
        latestDate: date,
        latestImportedAt: importedAt,
        latestSortMs: sortMs,
        posterUrl,
      };
      buckets.set(key, bucket);
    }

    if (episodesRaw) {
      const parsedNums = parseEpisodeNumbers(episodesRaw);
      if (parsedNums.length > 0) {
        for (const ep of parsedNums) {
          bucket.episodeNums.add(ep);
        }
      } else {
        bucket.rawEpisodeTexts.add(episodesRaw);
      }
    }

    if (!bucket.posterUrl && posterUrl) {
      bucket.posterUrl = posterUrl;
    }
    if (!bucket.year && year) {
      bucket.year = year;
    }
    if (!bucket.type && type) {
      bucket.type = type;
    }
    if (sortMs > bucket.latestSortMs || (!bucket.latestDate && date)) {
      bucket.latestSortMs = sortMs;
      bucket.latestDate = date;
      bucket.latestImportedAt = importedAt;
    }
  }

  const cards = [...buckets.values()]
    .sort((a, b) => b.latestSortMs - a.latestSortMs || a.title.localeCompare(b.title))
    .slice(0, maxCards)
    .map((bucket): MediaRecentTransferCard => {
      const sortedEps = [...bucket.episodeNums].sort((a, b) => a - b);
      const episodesText =
        sortedEps.length > 0
          ? formatEpisodeRanges(sortedEps)
          : [...bucket.rawEpisodeTexts].join(', ');
      return {
        title: bucket.title,
        year: bucket.year,
        type: bucket.type,
        season: bucket.season,
        episodes: episodesText,
        episodeCount: sortedEps.length > 0 ? sortedEps.length : null,
        date: bucket.latestDate,
        importedAt: bucket.latestImportedAt,
        posterUrl: bucket.posterUrl,
      };
    });

  return cards;
}

/**
 * 简单清洗未匹配种子名称：去掉开头方括号站点前缀，并将点号/下划线转为空格。
 */
export function cleanTorrentName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return '未命名任务';
  const withoutPrefix = trimmed.replace(/^(?:\s*[[【][^\]】]+[\]】]\s*)+/, '');
  const cleaned = withoutPrefix.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || trimmed;
}

/**
 * 映射 qBittorrent 原始种子状态为中文展示状态，并判断是否属于活跃/未完成下载任务。
 */
export function classifyQbitStateForMedia(
  rawState: string,
  progress: number,
): {
  chineseState: string;
  isDownloadingClass: boolean;
  includeInDownloadsList: boolean;
} {
  const s = rawState.trim();
  const isUnfinished = progress < 0.9999;

  if (s === 'error' || s === 'missingFiles') {
    return {
      chineseState: '出错',
      isDownloadingClass: false,
      includeInDownloadsList: isUnfinished,
    };
  }
  if (s === 'metaDL' || s === 'forcedMetaDL') {
    return {
      chineseState: '获取元数据',
      isDownloadingClass: true,
      includeInDownloadsList: true,
    };
  }
  if (s === 'stalledDL') {
    return {
      chineseState: '等待连接',
      isDownloadingClass: false,
      includeInDownloadsList: true,
    };
  }
  if (s === 'queuedDL') {
    return {
      chineseState: '排队中',
      isDownloadingClass: true,
      includeInDownloadsList: true,
    };
  }
  if (s === 'checkingDL' || s === 'checkingUP' || s === 'checkingResumeData') {
    return {
      chineseState: '校验中',
      isDownloadingClass: s === 'checkingDL',
      includeInDownloadsList: isUnfinished || s === 'checkingDL',
    };
  }
  if (s === 'downloading' || s === 'forcedDL' || s === 'allocating') {
    return {
      chineseState: '下载中',
      isDownloadingClass: true,
      includeInDownloadsList: true,
    };
  }
  if (s === 'pausedDL' || s === 'stoppedDL') {
    return {
      chineseState: '已暂停',
      isDownloadingClass: false,
      includeInDownloadsList: true,
    };
  }
  if (s === 'uploading' || s === 'stalledUP' || s === 'forcedUP' || s === 'queuedUP') {
    return {
      chineseState: '做种中',
      isDownloadingClass: false,
      includeInDownloadsList: isUnfinished,
    };
  }
  if (s === 'pausedUP' || s === 'stoppedUP') {
    return {
      chineseState: '已完成',
      isDownloadingClass: false,
      includeInDownloadsList: isUnfinished,
    };
  }
  return {
    chineseState: isUnfinished ? '下载中' : '未知',
    isDownloadingClass: isUnfinished,
    includeInDownloadsList: isUnfinished,
  };
}

function mapMpDownloadStateToChinese(rawState: string): string {
  const lower = rawState.trim().toLowerCase();
  if (lower === 'downloading') return '下载中';
  if (lower === 'seeding' || lower === 'uploading') return '做种中';
  if (lower === 'paused' || lower === 'stopped') return '已暂停';
  if (lower === 'queued' || lower === 'waiting') return '排队中';
  if (lower === 'checking') return '校验中';
  if (lower === 'error' || lower === 'failed') return '出错';
  if (lower === 'stalled') return '等待连接';
  return rawState.trim() || '未知';
}

function normalizeProgressZeroToOne(raw: unknown): number {
  const num = toNum(raw) ?? 0;
  const fraction = num > 1 ? num / 100 : num;
  return Math.round(Math.min(1, Math.max(0, fraction)) * 10000) / 10000;
}

export interface PosterFallbackIndexes {
  byMediaId: Map<string, string>;
  byTitle: Map<string, string>;
}

/**
 * 从订阅列表与入库记录构建海报回退索引（均已通过代理签名）。
 */
export function buildPosterFallbackIndexes(
  subscribesRaw: readonly Record<string, unknown>[],
  transfersRaw: readonly Record<string, unknown>[],
  toPosterUrl: (rawImage: unknown) => string | null,
): PosterFallbackIndexes {
  const byMediaId = new Map<string, string>();
  const byTitle = new Map<string, string>();

  for (const sub of subscribesRaw) {
    const poster = toPosterUrl(sub.poster);
    if (!poster) continue;
    const mediaId = toStr(sub.media_id);
    if (mediaId && !byMediaId.has(mediaId)) {
      byMediaId.set(mediaId, poster);
    }
    const name = toStr(sub.name ?? sub.title).toLowerCase();
    if (name && !byTitle.has(name)) {
      byTitle.set(name, poster);
    }
  }

  for (const tr of transfersRaw) {
    const poster = toPosterUrl(tr.image);
    if (!poster) continue;
    const title = toStr(tr.title).toLowerCase();
    if (title && !byTitle.has(title)) {
      byTitle.set(title, poster);
    }
  }

  return { byMediaId, byTitle };
}

export interface QbitTorrentWithInstance {
  instanceName: string;
  torrent: Record<string, unknown>;
}

/**
 * 合并 qB-download 实例任务与 MoviePilot 下载列表（按 hash 不区分大小写匹配）。
 */
export function mergeMediaDownloads(params: {
  qbitTorrents: readonly QbitTorrentWithInstance[];
  mpDownloadsRaw: readonly Record<string, unknown>[];
  brushInstanceNames: ReadonlySet<string>;
  posterFallbacks: PosterFallbackIndexes;
  toPosterUrl: (rawImage: unknown) => string | null;
}): MediaDownloadTaskItem[] {
  const mpByHash = new Map<string, Record<string, unknown>>();
  for (const mpItem of params.mpDownloadsRaw) {
    const hash = toStr(mpItem.hash).toLowerCase();
    if (hash && !mpByHash.has(hash)) {
      mpByHash.set(hash, mpItem);
    }
  }

  const matchedMpHashes = new Set<string>();
  const items: MediaDownloadTaskItem[] = [];

  for (const entry of params.qbitTorrents) {
    const t = entry.torrent;
    const hash = toStr(t.hash);
    const hashKey = hash.toLowerCase();
    const torrentName = toStr(t.name, '未命名任务');
    const progress = normalizeProgressZeroToOne(t.progress);
    const rawState = toStr(t.state, 'unknown');
    const classified = classifyQbitStateForMedia(rawState, progress);
    if (!classified.includeInDownloadsList) {
      continue;
    }

    const dlSpeed = Math.max(0, toNum(t.dlspeed) ?? 0);
    const upSpeed = Math.max(0, toNum(t.upspeed) ?? 0);
    const eta = normalizeQbitEta(t.eta);
    const size = Math.max(0, toNum(t.size ?? t.total_size) ?? 0);
    const mpMatch = hashKey ? mpByHash.get(hashKey) : undefined;

    if (mpMatch) {
      matchedMpHashes.add(hashKey);
      const mpTitle = toStr(mpMatch.title);
      const mpName = toStr(mpMatch.name);
      const displayName = mpTitle || mpName || cleanTorrentName(torrentName);
      const mediaId = toStr(mpMatch.media_id);
      const directPoster = params.toPosterUrl(mpMatch.poster ?? mpMatch.image);
      const fallbackPoster =
        (mediaId ? params.posterFallbacks.byMediaId.get(mediaId) : undefined) ??
        (mpTitle ? params.posterFallbacks.byTitle.get(mpTitle.toLowerCase()) : undefined) ??
        (mpName ? params.posterFallbacks.byTitle.get(mpName.toLowerCase()) : undefined) ??
        null;

      items.push({
        hash,
        displayName,
        torrentName,
        year: toStr(mpMatch.year),
        seasonEpisode: toStr(mpMatch.season_episode),
        posterUrl: directPoster ?? fallbackPoster,
        progress,
        dlSpeed,
        upSpeed,
        dlSpeedText: null,
        upSpeedText: null,
        eta,
        leftTime: null,
        size,
        state: classified.chineseState,
        instanceName: entry.instanceName,
        site: toStr(mpMatch.site_name),
        matched: true,
      });
    } else {
      items.push({
        hash,
        displayName: cleanTorrentName(torrentName),
        torrentName,
        year: '',
        seasonEpisode: '',
        posterUrl: null,
        progress,
        dlSpeed,
        upSpeed,
        dlSpeedText: null,
        upSpeedText: null,
        eta,
        leftTime: null,
        size,
        state: classified.chineseState,
        instanceName: entry.instanceName,
        site: '',
        matched: false,
      });
    }
  }

  for (const mpItem of params.mpDownloadsRaw) {
    const hash = toStr(mpItem.hash);
    const hashKey = hash.toLowerCase();
    if (hashKey && matchedMpHashes.has(hashKey)) {
      continue;
    }

    const downloaderName = toStr(mpItem.downloader);
    if (downloaderName && params.brushInstanceNames.has(downloaderName.toLowerCase())) {
      continue;
    }

    const mpTitle = toStr(mpItem.title);
    const mpName = toStr(mpItem.name);
    const displayName = mpTitle || mpName || '未知下载任务';
    const mediaId = toStr(mpItem.media_id);
    const directPoster = params.toPosterUrl(mpItem.poster ?? mpItem.image);
    const fallbackPoster =
      (mediaId ? params.posterFallbacks.byMediaId.get(mediaId) : undefined) ??
      (mpTitle ? params.posterFallbacks.byTitle.get(mpTitle.toLowerCase()) : undefined) ??
      (mpName ? params.posterFallbacks.byTitle.get(mpName.toLowerCase()) : undefined) ??
      null;

    const dlNum =
      typeof mpItem.dlspeed === 'number' && Number.isFinite(mpItem.dlspeed) ? mpItem.dlspeed : null;
    const upNum =
      typeof mpItem.upspeed === 'number' && Number.isFinite(mpItem.upspeed) ? mpItem.upspeed : null;

    items.push({
      hash,
      displayName,
      torrentName: mpName || displayName,
      year: toStr(mpItem.year),
      seasonEpisode: toStr(mpItem.season_episode),
      posterUrl: directPoster ?? fallbackPoster,
      progress: normalizeProgressZeroToOne(mpItem.progress),
      dlSpeed: dlNum,
      upSpeed: upNum,
      dlSpeedText: dlNum === null ? toStr(mpItem.dlspeed) || null : null,
      upSpeedText: upNum === null ? toStr(mpItem.upspeed) || null : null,
      eta: null,
      leftTime: toStr(mpItem.left_time) || null,
      size: Math.max(0, toNum(mpItem.size) ?? 0),
      state: mapMpDownloadStateToChinese(toStr(mpItem.state, 'downloading')),
      instanceName: downloaderName || 'MoviePilot',
      site: toStr(mpItem.site_name),
      matched: true,
    });
  }

  return items.sort((a, b) => {
    const aDownloading = a.state === '下载中' || (a.dlSpeed ?? 0) > 0;
    const bDownloading = b.state === '下载中' || (b.dlSpeed ?? 0) > 0;
    if (aDownloading !== bDownloading) {
      return aDownloading ? -1 : 1;
    }
    if (aDownloading && bDownloading) {
      const speedDiff = (b.dlSpeed ?? 0) - (a.dlSpeed ?? 0);
      if (speedDiff !== 0) return speedDiff;
    }
    return b.progress - a.progress || a.displayName.localeCompare(b.displayName);
  });
}

function mapSubscribeStateToChinese(rawState: string): string {
  const upper = rawState.trim().toUpperCase();
  if (upper === 'N') return '新建';
  if (upper === 'R') return '订阅中';
  if (upper === 'P') return '待定';
  if (upper === 'S') return '暂停';
  return rawState.trim() || '未知';
}

function parseDownloadedEpisodesNote(rawNote: unknown): number[] {
  let candidates: unknown[] = [];
  if (Array.isArray(rawNote)) {
    candidates = rawNote;
  } else if (typeof rawNote === 'string') {
    const trimmed = rawNote.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) candidates = parsed;
      } catch {
        candidates = trimmed.split(/[,，\s]+/);
      }
    } else if (trimmed) {
      candidates = trimmed.split(/[,，\s]+/);
    }
  }

  const nums = new Set<number>();
  for (const item of candidates) {
    const n = toNum(item);
    if (n !== null && Number.isInteger(n) && n >= 1) {
      nums.add(n);
    }
  }
  return [...nums].sort((a, b) => a - b);
}

interface CalendarEpisodeEntry {
  date: string;
  episodeNumber: number | null;
  name: string;
}

export function extractCalendarItems(rawCalendar: unknown): Record<string, unknown>[] {
  if (Array.isArray(rawCalendar)) {
    return rawCalendar.filter(isRecord);
  }
  if (isRecord(rawCalendar)) {
    const node = isRecord(rawCalendar.data) ? rawCalendar.data : rawCalendar;
    if (Array.isArray(node.items)) {
      return node.items.filter(isRecord);
    }
    if (Array.isArray(node.list)) {
      return node.list.filter(isRecord);
    }
  }
  return [];
}

function isMovieMediaType(rawType: string): boolean {
  const lower = rawType.trim().toLowerCase();
  return lower === '电影' || lower === 'movie' || lower === 'movies';
}

function inferMissingEpisodes(params: {
  isMovie: boolean;
  startEpisode: number | null;
  totalEpisode: number | null;
  lackEpisode: number | null;
  downloadedEpisodes: number[];
}): number[] {
  if (params.isMovie) {
    return [];
  }
  if (params.lackEpisode === 0) {
    return [];
  }

  const downloadedSet = new Set(params.downloadedEpisodes);
  const start = Math.max(1, params.startEpisode ?? 1);

  if (params.totalEpisode !== null && params.totalEpisode >= start) {
    const candidates: number[] = [];
    const upperBound = Math.min(params.totalEpisode, start + 500);
    for (let ep = start; ep <= upperBound; ep += 1) {
      if (!downloadedSet.has(ep)) {
        candidates.push(ep);
      }
    }
    if (params.lackEpisode !== null && params.lackEpisode > 0) {
      return candidates.slice(0, params.lackEpisode);
    }
    return candidates;
  }

  if (params.downloadedEpisodes.length > 0) {
    const maxEp = params.downloadedEpisodes[params.downloadedEpisodes.length - 1]!;
    const gaps: number[] = [];
    for (let ep = start; ep <= maxEp; ep += 1) {
      if (!downloadedSet.has(ep)) {
        gaps.push(ep);
      }
    }
    if (params.lackEpisode !== null && params.lackEpisode > 0) {
      return gaps.slice(0, params.lackEpisode);
    }
    return gaps;
  }

  return [];
}

/**
 * 组装并排序订阅追剧列表（支持日历精确缺集与降级推断缺集）。
 */
export function buildMediaSubscriptions(params: {
  subscribesRaw: readonly Record<string, unknown>[];
  calendarItemsRaw: readonly Record<string, unknown>[];
  calendarAvailable: boolean;
  todayKey: string;
  toPosterUrl: (rawImage: unknown) => string | null;
}): MediaSubscriptionItem[] {
  const entriesBySubId = new Map<string, CalendarEpisodeEntry[]>();
  const entriesByNameSeason = new Map<string, CalendarEpisodeEntry[]>();

  if (params.calendarAvailable) {
    for (const item of params.calendarItemsRaw) {
      const dateRaw = toStr(item.date);
      const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(dateRaw);
      const date = dateMatch ? dateMatch[1]! : '';
      if (!date) continue;

      const subNode = isRecord(item.subscribe) ? item.subscribe : null;
      if (!subNode) continue;

      const subIdKey =
        typeof subNode.id === 'number' || typeof subNode.id === 'string' ? String(subNode.id) : '';
      const subName = toStr(subNode.name ?? subNode.title).toLowerCase();
      const subSeason = toNum(subNode.season);
      const nameSeasonKey = subName ? `${subName}||${subSeason ?? ''}` : '';

      const episodesArr = Array.isArray(item.episodes) ? item.episodes.filter(isRecord) : [];
      const parsedEntries: CalendarEpisodeEntry[] =
        episodesArr.length > 0
          ? episodesArr.map((ep) => ({
              date,
              episodeNumber: toNum(ep.episode_number),
              name: toStr(ep.name),
            }))
          : [
              {
                date,
                episodeNumber: null,
                name: toStr(subNode.name ?? subNode.title),
              },
            ];

      if (subIdKey) {
        const list = entriesBySubId.get(subIdKey) ?? [];
        list.push(...parsedEntries);
        entriesBySubId.set(subIdKey, list);
      }
      if (nameSeasonKey) {
        const list = entriesByNameSeason.get(nameSeasonKey) ?? [];
        list.push(...parsedEntries);
        entriesByNameSeason.set(nameSeasonKey, list);
      }
    }
  }

  const items: MediaSubscriptionItem[] = params.subscribesRaw.map((sub, idx) => {
    const id: number | string =
      typeof sub.id === 'number' || typeof sub.id === 'string' ? sub.id : `sub-${idx + 1}`;
    const name = toStr(sub.name ?? sub.title, '未命名订阅');
    const year = toStr(sub.year);
    const type = toStr(sub.type, '电视剧');
    const season = toNum(sub.season);
    const posterUrl = params.toPosterUrl(sub.poster);
    const state = mapSubscribeStateToChinese(toStr(sub.state));
    const totalEpisode = toNum(sub.total_episode);
    const startEpisode = toNum(sub.start_episode);
    const completedEpisode = toNum(sub.completed_episode);
    const lackEpisode = toNum(sub.lack_episode);
    const downloadedEpisodes = parseDownloadedEpisodesNote(sub.note);
    const latestEpisode =
      downloadedEpisodes.length > 0 ? downloadedEpisodes[downloadedEpisodes.length - 1]! : null;
    const lastUpdate = toStr(sub.last_update);
    const isMovie = isMovieMediaType(type);

    const downloadedSet = new Set(downloadedEpisodes);
    const minEp = Math.max(1, startEpisode ?? 1);

    const calendarEntries =
      entriesBySubId.get(String(id)) ??
      entriesByNameSeason.get(`${name.toLowerCase()}||${season ?? ''}`) ??
      [];

    let missingEpisodes: number[] = [];
    let missingInferred = false;
    let nextAir: MediaSubscriptionNextAir | null = null;
    let hasAired: boolean | null = null;

    if (params.calendarAvailable) {
      const airedEpisodes = new Set<number>();
      let movieAiredPast = false;
      const futureEntries: CalendarEpisodeEntry[] = [];

      for (const entry of calendarEntries) {
        if (entry.date <= params.todayKey) {
          if (isMovie) {
            movieAiredPast = true;
          } else if (
            entry.episodeNumber !== null &&
            Number.isInteger(entry.episodeNumber) &&
            entry.episodeNumber >= minEp
          ) {
            airedEpisodes.add(entry.episodeNumber);
          }
        } else {
          futureEntries.push(entry);
        }
      }

      if (isMovie) {
        hasAired = movieAiredPast ? true : futureEntries.length > 0 ? false : null;
      } else {
        missingEpisodes = [...airedEpisodes]
          .filter((ep) => !downloadedSet.has(ep))
          .sort((a, b) => a - b);
      }

      if (futureEntries.length > 0) {
        futureEntries.sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          return (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0);
        });
        const earliest = futureEntries[0]!;
        nextAir = {
          date: earliest.date,
          episodeNumber: isMovie ? null : earliest.episodeNumber,
          name: earliest.name,
        };
      }
    } else {
      missingInferred = true;
      missingEpisodes = inferMissingEpisodes({
        isMovie,
        startEpisode,
        totalEpisode,
        lackEpisode,
        downloadedEpisodes,
      });
    }

    return {
      id,
      name,
      year,
      type,
      season,
      posterUrl,
      state,
      totalEpisode,
      startEpisode,
      completedEpisode,
      lackEpisode,
      downloadedEpisodes,
      latestEpisode,
      missingEpisodes,
      missingInferred,
      nextAir,
      hasAired,
      lastUpdate,
    };
  });

  function getSortTier(item: MediaSubscriptionItem): 0 | 1 | 2 {
    if (item.missingEpisodes.length > 0) return 0;
    if (item.nextAir && diffDateKeys(params.todayKey, item.nextAir.date) <= 7) return 1;
    return 2;
  }

  return items.sort((a, b) => {
    const tierA = getSortTier(a);
    const tierB = getSortTier(b);
    if (tierA !== tierB) return tierA - tierB;
    if (tierA === 0) {
      const diff = b.missingEpisodes.length - a.missingEpisodes.length;
      if (diff !== 0) return diff;
    }
    if (tierA === 1 && a.nextAir && b.nextAir) {
      const dateDiff = a.nextAir.date.localeCompare(b.nextAir.date);
      if (dateDiff !== 0) return dateDiff;
    }
    if (a.lastUpdate !== b.lastUpdate) {
      return b.lastUpdate.localeCompare(a.lastUpdate);
    }
    return a.name.localeCompare(b.name);
  });
}

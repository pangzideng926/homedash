import { formatVpsCardTitle } from '@/components/vps/vps-utils';
import type {
  DetectedOs,
  DeviceDiskInfo,
  DevicesStatusResponse,
  DeviceStatusItem,
  DownloaderInstanceSummary,
  DownloadersSummaryResponse,
  MoviepilotSummaryResponse,
  NasStatusResponse,
  NasVolumeInfo,
  VpsListResponse,
  VpsServerView,
} from '@/lib/api';

export interface GroupedDevices {
  windows: DeviceStatusItem[];
  macos: DeviceStatusItem[];
  other: DeviceStatusItem[];
}

export function resolveDeviceOs(device: DeviceStatusItem): DetectedOs {
  if (device.data?.os) {
    return device.data.os;
  }
  return device.os;
}

export function groupHomeDevicesByOs(devices: readonly DeviceStatusItem[]): GroupedDevices {
  const windows: DeviceStatusItem[] = [];
  const macos: DeviceStatusItem[] = [];
  const other: DeviceStatusItem[] = [];

  for (const device of devices) {
    const os = resolveDeviceOs(device);
    if (os === 'windows') {
      windows.push(device);
    } else if (os === 'macos') {
      macos.push(device);
    } else {
      other.push(device);
    }
  }

  return { windows, macos, other };
}

export function getHighestDeviceDisk(disks: readonly DeviceDiskInfo[]): DeviceDiskInfo | null {
  if (disks.length === 0) return null;
  return disks.reduce((highest, current) =>
    current.usedPercent > highest.usedPercent ? current : highest,
  );
}

export function getHighestNasVolume(volumes: readonly NasVolumeInfo[]): NasVolumeInfo | null {
  if (volumes.length === 0) return null;
  return volumes.reduce((highest, current) =>
    current.usedPercent > highest.usedPercent ? current : highest,
  );
}

/**
 * 按到期日从近到远排序并取前 limit 台（已过期与即将到期的优先展示）。
 */
export function getNearestVpsServers(
  servers: readonly VpsServerView[],
  limit = 3,
): VpsServerView[] {
  if (servers.length === 0 || limit <= 0) return [];

  const sorted = [...servers].sort((a, b) => {
    const aValid = a.daysLeft !== null && !a.error;
    const bValid = b.daysLeft !== null && !b.error;
    if (aValid && bValid) {
      return (a.daysLeft ?? 0) - (b.daysLeft ?? 0);
    }
    if (aValid) return -1;
    if (bValid) return 1;
    return 0;
  });

  return sorted.slice(0, limit);
}

export interface MediaDownloadOverview {
  hasDownloaders: boolean;
  hasMoviepilot: boolean;
  downloadingCount: number;
  downloadSpeed: number;
  uploadSpeed: number;
  seedingCount: number | null;
  pendingTransfer: number | null;
  subscribesCount: number | null;
  mediaInstances: DownloaderInstanceSummary[];
}

export function isBrushDownloader(instance: Pick<DownloaderInstanceSummary, 'tags'>): boolean {
  return instance.tags.includes('brush');
}

/**
 * 汇总首页「影视下载概况」：仅统计非 brush 标签的 download / seed 实例与 MoviePilot。
 */
export function computeMediaDownloadOverview(
  downloaders: DownloadersSummaryResponse | null,
  mp: MoviepilotSummaryResponse | null,
): MediaDownloadOverview {
  const allInstances = downloaders?.configured ? downloaders.instances : [];
  const mediaInstances = allInstances.filter(
    (inst) =>
      !isBrushDownloader(inst) && (inst.tags.includes('download') || inst.tags.includes('seed')),
  );
  const downloadInstances = mediaInstances.filter((inst) => inst.tags.includes('download'));
  const seedInstances = mediaInstances.filter((inst) => inst.tags.includes('seed'));

  let downloadSpeed = 0;
  let uploadSpeed = 0;
  for (const inst of mediaInstances) {
    if (!inst.online) continue;
    downloadSpeed += inst.dlSpeed;
    uploadSpeed += inst.upSpeed;
  }

  const onlineDownloadInstances = downloadInstances.filter((inst) => inst.online);
  const onlineSeedInstances = seedInstances.filter((inst) => inst.online);

  const mpOnline = Boolean(mp?.configured && mp.online && mp.data);
  const mpData = mpOnline ? mp?.data : undefined;

  const mpDownloadingCount = mpData
    ? (mpData.activeDownloadsTotal ?? mpData.activeDownloads?.length ?? mpData.downloads.length)
    : 0;

  const downloadingCount =
    onlineDownloadInstances.length > 0
      ? onlineDownloadInstances.reduce((sum, inst) => sum + inst.counts.downloading, 0)
      : mpDownloadingCount;

  const seedingCount =
    onlineSeedInstances.length > 0
      ? onlineSeedInstances.reduce((sum, inst) => sum + inst.counts.seeding, 0)
      : null;

  const pendingTransfer = mpData
    ? mpData.transferQueue
      ? mpData.transferQueue.available
        ? (mpData.transferQueueTotal ?? mpData.transferQueue.total)
        : null
      : (mpData.transferQueueTotal ?? null)
    : null;

  const subscribesCount = mpData ? mpData.subscribes.length : null;

  return {
    hasDownloaders: mediaInstances.length > 0,
    hasMoviepilot: Boolean(mp?.configured),
    downloadingCount,
    downloadSpeed,
    uploadSpeed,
    seedingCount,
    pendingTransfer,
    subscribesCount,
    mediaInstances,
  };
}

export type OverviewAnomalyCategory =
  'device-offline' | 'vps-expiry' | 'disk-high' | 'downloader-offline';

export interface OverviewAnomalyItem {
  id: string;
  category: OverviewAnomalyCategory;
  categoryLabel: string;
  severity: 'error' | 'warning';
  title: string;
  detail: string;
  to: string;
}

export interface CollectOverviewAnomaliesInput {
  devicesData: DevicesStatusResponse | null;
  devicesError: Error | null;
  nasData: NasStatusResponse | null;
  nasError: Error | null;
  vpsData: VpsListResponse | null;
  vpsError: Error | null;
  downloadersData: DownloadersSummaryResponse | null;
  downloadersError: Error | null;
}

export function collectOverviewAnomalies({
  devicesData,
  devicesError,
  nasData,
  nasError,
  vpsData,
  vpsError,
  downloadersData,
  downloadersError,
}: CollectOverviewAnomaliesInput): OverviewAnomalyItem[] {
  const anomalies: OverviewAnomalyItem[] = [];

  // 1. 设备离线（家用设备 + NAS）
  if (devicesData?.configured && !devicesData.error) {
    for (const device of devicesData.devices) {
      if (!device.online) {
        anomalies.push({
          id: `device-offline:${device.id}`,
          category: 'device-offline',
          categoryLabel: '设备离线',
          severity: 'error',
          title: device.name,
          detail: device.error ?? '设备离线或无法采集状态',
          to: '/devices',
        });
      }
    }
  } else if (devicesError && !devicesData) {
    anomalies.push({
      id: 'device-api-error',
      category: 'device-offline',
      categoryLabel: '设备离线',
      severity: 'error',
      title: '家用设备状态获取失败',
      detail: devicesError.message,
      to: '/devices',
    });
  }

  if (nasData?.configured && !nasData.online) {
    anomalies.push({
      id: 'nas-offline',
      category: 'device-offline',
      categoryLabel: '设备离线',
      severity: 'error',
      title: 'NAS',
      detail: nasData.error ?? 'NAS 离线或连接失败',
      to: '/nas',
    });
  } else if (nasError && !nasData) {
    anomalies.push({
      id: 'nas-api-error',
      category: 'device-offline',
      categoryLabel: '设备离线',
      severity: 'error',
      title: 'NAS 状态获取失败',
      detail: nasError.message,
      to: '/nas',
    });
  }

  // 2. VPS 剩余 ≤ 7 天（含今天到期、已过期）
  if (vpsData?.configured && !vpsData.error && !vpsError) {
    for (const server of vpsData.servers) {
      if (server.daysLeft !== null && server.daysLeft <= 7) {
        const expiryText =
          server.daysLeft < 0
            ? `已过期 ${Math.abs(server.daysLeft)} 天`
            : server.daysLeft === 0
              ? '今天到期'
              : `剩余 ${server.daysLeft} 天`;

        anomalies.push({
          id: `vps-expiry:${server.id}`,
          category: 'vps-expiry',
          categoryLabel: '即将到期',
          severity: 'error',
          title: formatVpsCardTitle(server.name, server.region),
          detail: `${expiryText}（到期日 ${server.expiresAt}）`,
          to: '/vps',
        });
      }
    }
  }

  // 3. 磁盘占用 ≥ 90%（家用设备磁盘与 NAS 卷均检查）
  if (devicesData?.configured && !devicesData.error) {
    for (const device of devicesData.devices) {
      if (!device.online || !device.data) continue;
      for (const disk of device.data.disks) {
        if (disk.usedPercent >= 90) {
          anomalies.push({
            id: `device-disk:${device.id}:${disk.mount}`,
            category: 'disk-high',
            categoryLabel: '磁盘告警',
            severity: 'warning',
            title: `${device.name} · ${disk.mount}`,
            detail: `磁盘占用 ${disk.usedPercent}%（≥ 90%）`,
            to: '/devices',
          });
        }
      }
    }
  }

  if (nasData?.configured && nasData.online && nasData.data) {
    for (const volume of nasData.data.volumes) {
      if (volume.usedPercent >= 90) {
        anomalies.push({
          id: `nas-disk:${volume.mount}`,
          category: 'disk-high',
          categoryLabel: '磁盘告警',
          severity: 'warning',
          title: `NAS · ${volume.mount}`,
          detail: `存储卷占用 ${volume.usedPercent}%（≥ 90%）`,
          to: '/nas',
        });
      }
    }
  }

  // 4. 下载器连不上（实例 error / 离线 / 接口失败）
  if (downloadersError && !downloadersData) {
    anomalies.push({
      id: 'downloader-api-error',
      category: 'downloader-offline',
      categoryLabel: '下载器异常',
      severity: 'error',
      title: '下载器状态获取失败',
      detail: downloadersError.message,
      to: '/seeding',
    });
  } else if (downloadersData?.configured) {
    for (const inst of downloadersData.instances) {
      if (!inst.online || Boolean(inst.error)) {
        anomalies.push({
          id: `downloader-offline:${inst.id}`,
          category: 'downloader-offline',
          categoryLabel: '下载器异常',
          severity: 'error',
          title: inst.name,
          detail: inst.error ?? '下载器连接失败',
          to: `/seeding/${encodeURIComponent(inst.id)}`,
        });
      }
    }
  }

  return anomalies;
}

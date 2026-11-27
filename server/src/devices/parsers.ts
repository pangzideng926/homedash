import { z } from 'zod';
import type { DeviceDiskInfo, DeviceErrorCode, DeviceStatusData } from './types.js';

export class DeviceStatusClassifiedError extends Error {
  readonly code: DeviceErrorCode;

  constructor(code: DeviceErrorCode, message: string) {
    super(message);
    this.name = 'DeviceStatusClassifiedError';
    this.code = code;
  }
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

function calcUsedPercentByUsed(totalBytes: number, usedBytes: number): number {
  if (totalBytes <= 0) return 0;
  return clampPercent((Math.max(0, usedBytes) / totalBytes) * 100);
}

const rawWindowsDiskSchema = z.object({
  mount: z.string().min(1).optional(),
  drive: z.string().min(1).optional(),
  label: z.string().optional().default(''),
  totalBytes: z.number().finite().nonnegative(),
  freeBytes: z.number().finite().nonnegative(),
});

const rawWindowsPayloadSchema = z.object({
  hostname: z.string().min(1),
  os: z.string().min(1),
  bootTime: z.string().min(1),
  uptimeSeconds: z.number().finite().nonnegative(),
  cpu: z.object({
    model: z.string().min(1),
    cores: z.number().finite().nonnegative().optional(),
    loadPercent: z.number().finite().min(0).max(100),
  }),
  memory: z.object({
    totalBytes: z.number().finite().positive(),
    freeBytes: z.number().finite().nonnegative().optional(),
    usedBytes: z.number().finite().nonnegative().optional(),
  }),
  disks: z
    .union([z.array(rawWindowsDiskSchema), rawWindowsDiskSchema, z.null(), z.undefined()])
    .transform((val) => {
      if (!val) return [];
      return Array.isArray(val) ? val : [val];
    }),
});

/**
 * 解析 Windows PowerShell 输出的压缩 JSON，兼容单块磁盘及旧版字段。
 */
export function parseWindowsDeviceOutput(stdout: string): DeviceStatusData {
  const cleaned = stdout.replace(/^\uFEFF/, '').trim();
  if (!cleaned) {
    throw new DeviceStatusClassifiedError('PARSE_FAILED', '采集输出解析失败，返回内容为空');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    throw new DeviceStatusClassifiedError('PARSE_FAILED', '采集输出解析失败，JSON 格式无效');
  }

  const result = rawWindowsPayloadSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new DeviceStatusClassifiedError('PARSE_FAILED', '采集输出解析失败，字段结构不符合预期');
  }

  const raw = result.data;
  const totalMem = raw.memory.totalBytes;
  const usedMem =
    raw.memory.usedBytes !== undefined
      ? Math.min(totalMem, raw.memory.usedBytes)
      : Math.max(0, totalMem - Math.min(totalMem, raw.memory.freeBytes ?? 0));

  const disks: DeviceDiskInfo[] = raw.disks
    .map((disk) => {
      const mount = (disk.mount ?? disk.drive ?? '').trim();
      if (!mount) return null;
      const freeBytes = Math.min(disk.freeBytes, disk.totalBytes);
      const usedBytes = Math.max(0, disk.totalBytes - freeBytes);
      return {
        mount,
        label: disk.label.trim(),
        totalBytes: disk.totalBytes,
        freeBytes,
        usedPercent: calcUsedPercentByUsed(disk.totalBytes, usedBytes),
      };
    })
    .filter((disk): disk is DeviceDiskInfo => disk !== null);

  return {
    hostname: raw.hostname.trim(),
    os: 'windows',
    osVersion: raw.os.trim(),
    bootTime: raw.bootTime,
    uptimeSeconds: Math.floor(raw.uptimeSeconds),
    cpu: {
      model: raw.cpu.model.trim(),
      cores: Math.max(0, Math.floor(raw.cpu.cores ?? 0)),
      loadPercent: clampPercent(raw.cpu.loadPercent),
    },
    memory: {
      totalBytes: totalMem,
      usedBytes: usedMem,
      usedPercent: calcUsedPercentByUsed(totalMem, usedMem),
    },
    disks,
  };
}

interface ParsedSectionOutput {
  kv: Record<string, string>;
  sections: Record<string, string[]>;
}

function parseKeyValueSections(stdout: string): ParsedSectionOutput {
  const kv: Record<string, string> = {};
  const sections: Record<string, string[]> = {};
  let currentSection: string | null = null;

  const normalized = stdout.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  for (const rawLine of normalized.split('\n')) {
    const sectionMatch = /^===([A-Z0-9_]+)===$/.exec(rawLine.trim());
    if (sectionMatch) {
      const name = sectionMatch[1];
      if (name === 'END') {
        currentSection = null;
      } else if (name) {
        currentSection = name;
        if (!sections[currentSection]) {
          sections[currentSection] = [];
        }
      }
      continue;
    }

    if (currentSection) {
      sections[currentSection]!.push(rawLine);
      continue;
    }

    const eqIndex = rawLine.indexOf('=');
    if (eqIndex > 0) {
      const key = rawLine.slice(0, eqIndex).trim();
      const value = rawLine.slice(eqIndex + 1).trim();
      if (key) {
        kv[key] = value;
      }
    }
  }

  return { kv, sections };
}

function parseVmStatPages(lines: readonly string[], labelPrefix: string): number {
  const escaped = labelPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}:\\s*(\\d+)\\.?$`, 'i');
  for (const line of lines) {
    const match = pattern.exec(line.trim());
    if (match?.[1]) {
      return Number(match[1]);
    }
  }
  return 0;
}

function parseMacosTopLoadPercent(lines: readonly string[]): number {
  for (const line of lines) {
    if (!/cpu usage:/i.test(line)) continue;
    const idleMatch = /([\d.]+)%\s*idle/i.exec(line);
    if (idleMatch?.[1]) {
      const idle = Number(idleMatch[1]);
      if (Number.isFinite(idle)) {
        return clampPercent(100 - idle);
      }
    }
    const userMatch = /([\d.]+)%\s*user/i.exec(line);
    const sysMatch = /([\d.]+)%\s*sys/i.exec(line);
    if (userMatch?.[1] || sysMatch?.[1]) {
      const user = Number(userMatch?.[1] ?? 0);
      const sys = Number(sysMatch?.[1] ?? 0);
      return clampPercent(user + sys);
    }
  }
  return 0;
}

interface MacDfEntry {
  containerKey: string;
  mount: string;
  priority: number;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
}

function parseMacosDisks(lines: readonly string[]): DeviceDiskInfo[] {
  const candidatesByContainer = new Map<string, MacDfEntry>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('Filesystem')) continue;

    // 兼容 macOS 9 列 df -k（带 iused/ifree/%iused）与 6 列 POSIX 格式，完整保留挂载点空格
    const match9 = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+\d+\s+\d+\s+\d+%\s+(.+)$/.exec(line);
    const match6 = !match9 ? /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/.exec(line) : null;
    const match = match9 ?? match6;
    if (!match) continue;

    const fsName = match[1]!;
    const blocks = Number(match[2]);
    const usedBlocks = Number(match[3]);
    const availBlocks = Number(match[4]);
    const mount = match[5]!.trim();

    if (!Number.isFinite(blocks) || blocks <= 0) continue;

    const isRoot = mount === '/';
    const isDataVolume = mount === '/System/Volumes/Data';
    const isExternalVolume = mount.startsWith('/Volumes/');
    if (!isRoot && !isDataVolume && !isExternalVolume) {
      continue;
    }

    // 同一 APFS 容器下（例如 /dev/disk3s1s1 与 /dev/disk3s5）优先保留 /System/Volumes/Data
    const apfsContainerMatch = /^(\/dev\/disk\d+)s\d+/.exec(fsName);
    const containerKey = apfsContainerMatch?.[1] ?? fsName;
    const priority = isDataVolume ? 3 : isRoot ? 2 : 1;

    const totalBytes = blocks * 1024;
    const usedBytes = Math.max(0, usedBlocks * 1024);
    const freeBytes = Math.min(totalBytes, Math.max(0, availBlocks * 1024));

    const existing = candidatesByContainer.get(containerKey);
    if (!existing || priority > existing.priority) {
      candidatesByContainer.set(containerKey, {
        containerKey,
        mount,
        priority,
        totalBytes,
        usedBytes,
        freeBytes,
      });
    }
  }

  return [...candidatesByContainer.values()].map((entry) => {
    const label =
      entry.mount === '/System/Volumes/Data' || entry.mount === '/'
        ? '系统盘'
        : entry.mount.startsWith('/Volumes/')
          ? entry.mount.slice('/Volumes/'.length)
          : '';
    return {
      mount: entry.mount,
      label,
      totalBytes: entry.totalBytes,
      freeBytes: entry.freeBytes,
      usedPercent: calcUsedPercentByUsed(entry.totalBytes, entry.usedBytes),
    };
  });
}

/**
 * 解析 macOS 只读采集脚本输出（sysctl / sw_vers / vm_stat / top / df -k）。
 */
export function parseMacosDeviceOutput(
  stdout: string,
  nowMs: number = Date.now(),
): DeviceStatusData {
  if (!stdout.trim()) {
    throw new DeviceStatusClassifiedError('PARSE_FAILED', 'macOS 采集输出为空');
  }

  const { kv, sections } = parseKeyValueSections(stdout);
  const hostname = kv.HOSTNAME?.trim();
  if (!hostname) {
    throw new DeviceStatusClassifiedError('PARSE_FAILED', 'macOS 采集输出缺少主机名');
  }

  const bootMatch = /sec\s*=\s*(\d+)/.exec(kv.BOOTTIME ?? '');
  if (!bootMatch?.[1]) {
    throw new DeviceStatusClassifiedError('PARSE_FAILED', 'macOS 采集输出缺少开机时间');
  }
  const bootSec = Number(bootMatch[1]);
  const nowSecRaw = Number(kv.NOW_EPOCH);
  const nowSec = Number.isFinite(nowSecRaw) && nowSecRaw > 0 ? nowSecRaw : Math.floor(nowMs / 1000);
  const uptimeSeconds = Math.max(0, Math.floor(nowSec - bootSec));
  const bootTime = new Date(bootSec * 1000).toISOString();

  const totalMem = Number(kv.MEM_TOTAL);
  if (!Number.isFinite(totalMem) || totalMem <= 0) {
    throw new DeviceStatusClassifiedError('PARSE_FAILED', 'macOS 采集输出内存总量无效');
  }

  const vmLines = sections.VM_STAT ?? [];
  let pageSize = 4096;
  for (const line of vmLines) {
    const pageMatch = /page size of (\d+) bytes/i.exec(line);
    if (pageMatch?.[1]) {
      const parsedPageSize = Number(pageMatch[1]);
      if (Number.isFinite(parsedPageSize) && parsedPageSize > 0) {
        pageSize = parsedPageSize;
      }
      break;
    }
  }

  const activePages = parseVmStatPages(vmLines, 'Pages active');
  const wiredPages = parseVmStatPages(vmLines, 'Pages wired down');
  const compressedPages = parseVmStatPages(vmLines, 'Pages occupied by compressor');
  const usedBytes = Math.min(totalMem, (activePages + wiredPages + compressedPages) * pageSize);

  const product = kv.OS_PRODUCT?.trim() || 'macOS';
  const version = kv.OS_VERSION?.trim() || '';
  const build = kv.OS_BUILD?.trim() || '';
  const osVersion = [product, version, build ? `(${build})` : ''].filter(Boolean).join(' ');

  const coresRaw = Number(kv.CPU_CORES);
  const cores = Number.isFinite(coresRaw) && coresRaw > 0 ? Math.floor(coresRaw) : 0;

  return {
    hostname,
    os: 'macos',
    osVersion,
    bootTime,
    uptimeSeconds,
    cpu: {
      model: kv.CPU_MODEL?.trim() || '未知型号',
      cores,
      loadPercent: parseMacosTopLoadPercent(sections.TOP ?? []),
    },
    memory: {
      totalBytes: totalMem,
      usedBytes,
      usedPercent: calcUsedPercentByUsed(totalMem, usedBytes),
    },
    disks: parseMacosDisks(sections.DF ?? []),
  };
}

function parseCpuStatLine(line: string | undefined): { total: number; idle: number } | null {
  if (!line) return null;
  const trimmed = line.trim();
  if (!trimmed.startsWith('cpu')) return null;
  const parts = trimmed.split(/\s+/).slice(1).map(Number);
  if (parts.length < 4 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
  const total = parts.reduce((sum, val) => sum + val, 0);
  return { total, idle };
}

function parseLinuxOsVersion(lines: readonly string[]): string {
  const map: Record<string, string> = {};
  for (const line of lines) {
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    const rawVal = line.slice(eqIndex + 1).trim();
    map[key] = rawVal.replace(/^["']|["']$/g, '');
  }
  if (map.PRETTY_NAME) return map.PRETTY_NAME;
  if (map.NAME && map.VERSION) return `${map.NAME} ${map.VERSION}`;
  return map.NAME || 'Linux';
}

function parseLinuxMeminfoKb(lines: readonly string[], key: string): number | null {
  const pattern = new RegExp(`^${key}:\\s*(\\d+)\\s*kB`, 'i');
  for (const line of lines) {
    const match = pattern.exec(line.trim());
    if (match?.[1]) {
      return Number(match[1]);
    }
  }
  return null;
}

const LINUX_EXCLUDED_FS = new Set([
  'tmpfs',
  'devtmpfs',
  'overlay',
  'squashfs',
  'ramfs',
  'proc',
  'sysfs',
  'cgroup',
  'cgroup2',
  'debugfs',
  'tracefs',
  'securityfs',
  'fusectl',
  'pstore',
  'mqueue',
  'hugetlbfs',
  'configfs',
  'efivarfs',
  'nsfs',
  'devpts',
  'autofs',
]);

function parseLinuxDisks(lines: readonly string[]): DeviceDiskInfo[] {
  const seenMounts = new Set<string>();
  const disks: DeviceDiskInfo[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('Filesystem')) continue;

    // 优先匹配 df -kPT（含 Type 列）
    const match7 = /^(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/.exec(line);
    const match6 = !match7 ? /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/.exec(line) : null;

    let fsName = '';
    let fsType = '';
    let blocks = 0;
    let usedBlocks = 0;
    let availBlocks = 0;
    let mount = '';

    if (match7) {
      fsName = match7[1]!;
      fsType = match7[2]!.toLowerCase();
      blocks = Number(match7[3]);
      usedBlocks = Number(match7[4]);
      availBlocks = Number(match7[5]);
      mount = match7[6]!.trim();
    } else if (match6) {
      fsName = match6[1]!;
      fsType = fsName.toLowerCase();
      blocks = Number(match6[2]);
      usedBlocks = Number(match6[3]);
      availBlocks = Number(match6[4]);
      mount = match6[5]!.trim();
    } else {
      continue;
    }

    if (LINUX_EXCLUDED_FS.has(fsType) || LINUX_EXCLUDED_FS.has(fsName.toLowerCase())) {
      continue;
    }
    if (!Number.isFinite(blocks) || blocks <= 0 || !mount) {
      continue;
    }
    if (seenMounts.has(mount)) {
      continue;
    }
    seenMounts.add(mount);

    const totalBytes = blocks * 1024;
    const usedBytes = Math.max(0, usedBlocks * 1024);
    const freeBytes = Math.min(totalBytes, Math.max(0, availBlocks * 1024));

    disks.push({
      mount,
      label: mount === '/' ? '根分区' : '',
      totalBytes,
      freeBytes,
      usedPercent: calcUsedPercentByUsed(totalBytes, usedBytes),
    });
  }

  return disks;
}

/**
 * 解析 Linux 只读采集脚本输出（/proc/uptime、/proc/meminfo、/proc/stat、df -kPT）。
 */
export function parseLinuxDeviceOutput(
  stdout: string,
  nowMs: number = Date.now(),
): DeviceStatusData {
  if (!stdout.trim()) {
    throw new DeviceStatusClassifiedError('PARSE_FAILED', 'Linux 采集输出为空');
  }

  const { kv, sections } = parseKeyValueSections(stdout);
  const hostname = kv.HOSTNAME?.trim();
  if (!hostname) {
    throw new DeviceStatusClassifiedError('PARSE_FAILED', 'Linux 采集输出缺少主机名');
  }

  const uptimeMatch = /^([\d.]+)/.exec(kv.UPTIME ?? '');
  if (!uptimeMatch?.[1]) {
    throw new DeviceStatusClassifiedError('PARSE_FAILED', 'Linux 采集输出缺少运行时长');
  }
  const uptimeSeconds = Math.max(0, Math.floor(Number(uptimeMatch[1])));
  const nowSecRaw = Number(kv.NOW_EPOCH);
  const nowSec = Number.isFinite(nowSecRaw) && nowSecRaw > 0 ? nowSecRaw : Math.floor(nowMs / 1000);
  const bootTime = new Date((nowSec - uptimeSeconds) * 1000).toISOString();

  const memLines = sections.MEMINFO ?? [];
  const memTotalKb = parseLinuxMeminfoKb(memLines, 'MemTotal');
  if (!memTotalKb || memTotalKb <= 0) {
    throw new DeviceStatusClassifiedError('PARSE_FAILED', 'Linux 采集输出内存总量无效');
  }

  const memAvailableKb = parseLinuxMeminfoKb(memLines, 'MemAvailable');
  let usedMemKb: number;
  if (memAvailableKb !== null) {
    usedMemKb = Math.max(0, memTotalKb - memAvailableKb);
  } else {
    const memFreeKb = parseLinuxMeminfoKb(memLines, 'MemFree') ?? 0;
    const buffersKb = parseLinuxMeminfoKb(memLines, 'Buffers') ?? 0;
    const cachedKb = parseLinuxMeminfoKb(memLines, 'Cached') ?? 0;
    usedMemKb = Math.max(0, memTotalKb - (memFreeKb + buffersKb + cachedKb));
  }

  const totalBytes = memTotalKb * 1024;
  const usedBytes = Math.min(totalBytes, usedMemKb * 1024);

  const coresRaw = Number(kv.CPU_CORES);
  const cores = Number.isFinite(coresRaw) && coresRaw > 0 ? Math.floor(coresRaw) : 0;

  let loadPercent = 0;
  const stat1 = parseCpuStatLine(kv.CPU_STAT_1);
  const stat2 = parseCpuStatLine(kv.CPU_STAT_2);
  if (stat1 && stat2 && stat2.total > stat1.total) {
    const deltaTotal = stat2.total - stat1.total;
    const deltaIdle = Math.max(0, stat2.idle - stat1.idle);
    loadPercent = clampPercent(((deltaTotal - deltaIdle) / deltaTotal) * 100);
  } else {
    const loadAvgMatch = /^([\d.]+)/.exec(kv.LOADAVG ?? '');
    if (loadAvgMatch?.[1]) {
      const load1m = Number(loadAvgMatch[1]);
      if (Number.isFinite(load1m)) {
        loadPercent = clampPercent((load1m / Math.max(1, cores)) * 100);
      }
    }
  }

  return {
    hostname,
    os: 'linux',
    osVersion: parseLinuxOsVersion(sections.OS_RELEASE ?? []),
    bootTime,
    uptimeSeconds,
    cpu: {
      model: kv.CPU_MODEL?.trim() || '未知型号',
      cores,
      loadPercent,
    },
    memory: {
      totalBytes,
      usedBytes,
      usedPercent: calcUsedPercentByUsed(totalBytes, usedBytes),
    },
    disks: parseLinuxDisks(sections.DF ?? []),
  };
}

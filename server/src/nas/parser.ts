import { clampPercent, DeviceStatusClassifiedError } from '../devices/parsers.js';
import type {
  NasDockerContainer,
  NasDockerInfo,
  NasRaidArray,
  NasSmartDiskTemp,
  NasSmartInfo,
  NasStatusData,
  NasTemperatureCategory,
  NasTemperatureGroup,
  NasVolumeInfo,
} from './types.js';

interface ParsedSections {
  kv: Record<string, string>;
  sections: Record<string, string[]>;
}

function parseKeyValueAndSections(stdout: string): ParsedSections {
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

function parseOsVersion(lines: readonly string[]): string {
  const map: Record<string, string> = {};
  for (const line of lines) {
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    const val = line
      .slice(eqIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    map[key] = val;
  }
  if (map.PRETTY_NAME) return map.PRETTY_NAME;
  if (map.NAME && map.VERSION) return `${map.NAME} ${map.VERSION}`;
  return map.NAME || 'Linux NAS';
}

function parseMeminfoKb(lines: readonly string[], key: string): number | null {
  const pattern = new RegExp(`^${key}:\\s*(\\d+)\\s*kB`, 'i');
  for (const line of lines) {
    const match = pattern.exec(line.trim());
    if (match?.[1]) {
      return Number(match[1]);
    }
  }
  return null;
}

function parseCpuStat(line: string | undefined): { total: number; idle: number } | null {
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

function parseLoadAvg(raw: string | undefined): [number, number, number] {
  if (!raw) return [0, 0, 0];
  const parts = raw.trim().split(/\s+/);
  const l1 = Number(parts[0]);
  const l5 = Number(parts[1]);
  const l15 = Number(parts[2]);
  return [
    Number.isFinite(l1) ? Math.round(l1 * 100) / 100 : 0,
    Number.isFinite(l5) ? Math.round(l5 * 100) / 100 : 0,
    Number.isFinite(l15) ? Math.round(l15 * 100) / 100 : 0,
  ];
}

const TEMP_GROUP_LABELS: Record<NasTemperatureCategory, string> = {
  cpu: 'CPU',
  nvme: 'NVMe',
  memory: '内存',
  motherboard: '主板',
  disk: '硬盘',
  other: '其他',
};

function classifyThermalCategory(rawName: string, rawLabel: string): NasTemperatureCategory {
  const combined = `${rawName} ${rawLabel}`.toLowerCase();
  if (
    combined.includes('coretemp') ||
    combined.includes('x86_pkg_temp') ||
    combined.includes('k10temp') ||
    combined.includes('zenpower') ||
    combined.includes('cpu_thermal') ||
    combined.includes('package') ||
    combined.includes('tctl') ||
    combined.includes('tdie')
  ) {
    return 'cpu';
  }
  if (combined.includes('nvme')) {
    return 'nvme';
  }
  if (
    combined.includes('spd5118') ||
    combined.includes('jc42') ||
    combined.includes('dimm') ||
    combined.includes('ddr')
  ) {
    return 'memory';
  }
  if (
    combined.includes('acpitz') ||
    combined.includes('pch') ||
    combined.includes('nct') ||
    combined.includes('it87') ||
    combined.includes('systin') ||
    combined.includes('motherboard') ||
    combined.includes('board')
  ) {
    return 'motherboard';
  }
  if (combined.includes('drivetemp') || combined.includes('sata') || combined.includes('hdd')) {
    return 'disk';
  }
  return 'other';
}

function normalizeTemperatureC(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  // Linux sysfs 温度多为毫摄氏度（例如 45000 = 45.0℃）
  const tempC = Math.abs(num) >= 1000 ? num / 1000 : num;
  if (tempC <= -40 || tempC >= 150) return null;
  return Math.round(tempC * 10) / 10;
}

/**
 * 解析 thermal_zone 与 hwmon 温度并按组件分组取各组最高温度。
 */
export function parseNasTemperatures(lines: readonly string[]): NasTemperatureGroup[] {
  const groups = new Map<NasTemperatureCategory, Array<{ name: string; tempC: number }>>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('TZ|')) {
      const parts = line.split('|');
      const zoneType = parts[1]?.trim() || 'thermal_zone';
      const tempC = normalizeTemperatureC(parts[2] ?? '');
      if (tempC === null) continue;
      const category = classifyThermalCategory(zoneType, '');
      const list = groups.get(category) ?? [];
      list.push({ name: zoneType, tempC });
      groups.set(category, list);
      continue;
    }

    if (line.startsWith('HW|')) {
      const parts = line.split('|');
      const hwName = parts[1]?.trim() || 'hwmon';
      const hwLabel = parts[2]?.trim() || '';
      const tempC = normalizeTemperatureC(parts[3] ?? '');
      if (tempC === null) continue;
      const category = classifyThermalCategory(hwName, hwLabel);
      const sensorName = hwLabel ? `${hwName} (${hwLabel})` : hwName;
      const list = groups.get(category) ?? [];
      list.push({ name: sensorName, tempC });
      groups.set(category, list);
    }
  }

  const order: NasTemperatureCategory[] = ['cpu', 'nvme', 'memory', 'motherboard', 'disk', 'other'];
  const result: NasTemperatureGroup[] = [];
  for (const category of order) {
    const sensors = groups.get(category);
    if (!sensors || sensors.length === 0) continue;
    const maxTempC = Math.max(...sensors.map((s) => s.tempC));
    result.push({
      category,
      label: TEMP_GROUP_LABELS[category],
      maxTempC,
      sensors,
    });
  }
  return result;
}

/**
 * 解析 smartctl -A -j 输出；若无权限或执行失败则整体跳过并标注原因。
 */
export function parseNasSmartOutput(lines: readonly string[]): NasSmartInfo {
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  if (nonEmpty.length === 0 || nonEmpty.includes('SMART_UNAVAILABLE')) {
    return { available: false, reason: '未检测到 smartctl 工具，已跳过', disks: [] };
  }
  if (nonEmpty.includes('SMART_NO_DISKS')) {
    return { available: false, reason: '未检测到 /dev/sd* SATA 硬盘，已跳过', disks: [] };
  }

  const disks: NasSmartDiskTemp[] = [];
  let currentDevice: string | null = null;
  let currentRc: number | null = null;
  let jsonLines: string[] = [];

  const flushCurrent = (): 'ok' | 'permission_denied' | 'skip' => {
    if (!currentDevice) return 'ok';
    const body = jsonLines.join('\n').trim();
    const lower = body.toLowerCase();
    if (
      lower.includes('permission denied') ||
      lower.includes('operation not permitted') ||
      lower.includes('root')
    ) {
      return 'permission_denied';
    }
    if (currentRc !== 0 && currentRc !== null) {
      // smartctl 退出码 2 或无权限打开设备通常也是因为需要 root
      return 'permission_denied';
    }
    try {
      const parsed = JSON.parse(body) as {
        temperature?: { current?: unknown };
        model_name?: unknown;
      };
      const currentTemp = parsed.temperature?.current;
      if (typeof currentTemp === 'number' && Number.isFinite(currentTemp)) {
        disks.push({
          device: currentDevice,
          ...(typeof parsed.model_name === 'string' && parsed.model_name.trim()
            ? { model: parsed.model_name.trim() }
            : {}),
          tempC: Math.round(currentTemp * 10) / 10,
        });
      }
      return 'ok';
    } catch {
      return 'skip';
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('SMART_DISK_START|')) {
      currentDevice = trimmed.slice('SMART_DISK_START|'.length).trim();
      currentRc = null;
      jsonLines = [];
      continue;
    }
    if (trimmed.startsWith('SMART_RC|')) {
      const rcNum = Number(trimmed.slice('SMART_RC|'.length).trim());
      currentRc = Number.isFinite(rcNum) ? rcNum : null;
      continue;
    }
    if (trimmed === 'SMART_DISK_END') {
      const res = flushCurrent();
      currentDevice = null;
      currentRc = null;
      jsonLines = [];
      if (res === 'permission_denied') {
        return { available: false, reason: '需要 root 权限，已跳过', disks: [] };
      }
      continue;
    }
    if (currentDevice) {
      jsonLines.push(rawLine);
    }
  }

  if (disks.length === 0) {
    return { available: false, reason: '需要 root 权限，已跳过', disks: [] };
  }

  return { available: true, disks };
}

/**
 * 解析 /proc/mdstat 输出中的 RAID 阵列信息。
 */
export function parseMdstatOutput(lines: readonly string[]): NasRaidArray[] {
  const arrays: NasRaidArray[] = [];
  let current: {
    name: string;
    status: string;
    level: string;
    members: string[];
  } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('Personalities') || line.startsWith('unused devices')) {
      continue;
    }

    const headerMatch = /^(md\d+)\s*:\s*(\S+)\s+(raid\d+|linear|multipath)\s+(.+)$/i.exec(line);
    if (headerMatch) {
      if (current) {
        arrays.push({
          ...current,
          stateFlags: '',
          activeDevices: current.members.length,
          totalDevices: current.members.length,
          healthy: !current.members.some((m) => m.includes('(F)')),
          statusLabel: current.members.some((m) => m.includes('(F)')) ? '降级' : '正常',
        });
      }
      current = {
        name: headerMatch[1]!,
        status: headerMatch[2]!.toLowerCase(),
        level: headerMatch[3]!.toLowerCase(),
        members: headerMatch[4]!.trim().split(/\s+/).filter(Boolean),
      };
      continue;
    }

    if (current) {
      const detailMatch = /\[(\d+)\/(\d+)\]\s*\[([U_]+)\]/i.exec(line);
      if (detailMatch) {
        const totalDevices = Number(detailMatch[1]);
        const activeDevices = Number(detailMatch[2]);
        const stateFlags = `[${detailMatch[3]}]`;
        const hasDown = detailMatch[3]!.includes('_');
        const hasFailedMember = current.members.some((m) => m.includes('(F)'));
        const healthy =
          current.status === 'active' &&
          !hasDown &&
          !hasFailedMember &&
          activeDevices === totalDevices;

        arrays.push({
          ...current,
          stateFlags,
          activeDevices,
          totalDevices,
          healthy,
          statusLabel: healthy ? '正常' : '降级',
        });
        current = null;
      }
    }
  }

  if (current) {
    const hasFailedMember = current.members.some((m) => m.includes('(F)'));
    arrays.push({
      ...current,
      stateFlags: '',
      activeDevices: current.members.length,
      totalDevices: current.members.length,
      healthy: current.status === 'active' && !hasFailedMember,
      statusLabel: current.status === 'active' && !hasFailedMember ? '正常' : '降级',
    });
  }

  return arrays;
}

const NAS_EXCLUDED_FS = new Set([
  'tmpfs',
  'devtmpfs',
  'overlay',
  'squashfs',
  'vfat',
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

const NAS_EXCLUDED_MOUNT_PREFIXES = [
  '/boot',
  '/rootfs',
  '/mnt/factory',
  '/overlay',
  '/ugreen',
  '/dev',
  '/proc',
  '/sys',
  '/run',
  '/snap',
];

function isExcludedMount(mount: string): boolean {
  return NAS_EXCLUDED_MOUNT_PREFIXES.some(
    (prefix) => mount === prefix || mount.startsWith(`${prefix}/`),
  );
}

/**
 * 解析 df -kPT 输出，排除虚拟/系统分区并重点标记 /volume* 存储卷。
 */
export function parseNasDfOutput(lines: readonly string[]): NasVolumeInfo[] {
  const seenMounts = new Set<string>();
  const volumes: NasVolumeInfo[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('Filesystem')) continue;

    const match7 = /^(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/.exec(line);
    const match6 = !match7 ? /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/.exec(line) : null;

    let device = '';
    let fsType = '';
    let blocks = 0;
    let usedBlocks = 0;
    let availBlocks = 0;
    let mount = '';

    if (match7) {
      device = match7[1]!;
      fsType = match7[2]!.toLowerCase();
      blocks = Number(match7[3]);
      usedBlocks = Number(match7[4]);
      availBlocks = Number(match7[5]);
      mount = match7[6]!.trim();
    } else if (match6) {
      device = match6[1]!;
      fsType = device.toLowerCase();
      blocks = Number(match6[2]);
      usedBlocks = Number(match6[3]);
      availBlocks = Number(match6[4]);
      mount = match6[5]!.trim();
    } else {
      continue;
    }

    if (NAS_EXCLUDED_FS.has(fsType) || NAS_EXCLUDED_FS.has(device.toLowerCase())) {
      continue;
    }
    if (!mount || isExcludedMount(mount)) {
      continue;
    }
    if (!Number.isFinite(blocks) || blocks <= 0) {
      continue;
    }
    if (seenMounts.has(mount)) {
      continue;
    }
    seenMounts.add(mount);

    const totalBytes = blocks * 1024;
    const usedBytes = Math.max(0, usedBlocks * 1024);
    const availableBytes = Math.min(totalBytes, Math.max(0, availBlocks * 1024));
    const usedPercent = clampPercent((usedBytes / totalBytes) * 100);
    const isVolume = /^\/volume\d*/i.test(mount);

    volumes.push({
      mount,
      device,
      fsType,
      totalBytes,
      usedBytes,
      availableBytes,
      usedPercent,
      isVolume,
    });
  }

  // /volume* 存储卷优先置前展示
  volumes.sort((a, b) => {
    if (a.isVolume !== b.isVolume) return a.isVolume ? -1 : 1;
    return a.mount.localeCompare(b.mount);
  });

  return volumes;
}

/**
 * 解析 docker ps -a --format "{{json .}}" 输出，兼容权限不足与未安装场景。
 */
export function parseNasDockerOutput(lines: readonly string[]): NasDockerInfo {
  const trimmedLines = lines.map((l) => l.trim()).filter(Boolean);
  if (trimmedLines.length === 0 || trimmedLines.includes('DOCKER_NOT_INSTALLED')) {
    return {
      available: false,
      reason: '未检测到 Docker 服务，已跳过',
      containers: [],
    };
  }

  let exitCode: number | null = null;
  const contentLines: string[] = [];
  for (const line of trimmedLines) {
    if (line.startsWith('DOCKER_EXIT=')) {
      const codeNum = Number(line.slice('DOCKER_EXIT='.length));
      exitCode = Number.isFinite(codeNum) ? codeNum : null;
      continue;
    }
    contentLines.push(line);
  }

  const combinedLower = contentLines.join('\n').toLowerCase();
  if (
    combinedLower.includes('permission denied') ||
    combinedLower.includes('got permission denied') ||
    combinedLower.includes('cannot connect')
  ) {
    return {
      available: false,
      reason: '当前账号无权访问 Docker（需要加入 docker 组），已跳过',
      containers: [],
    };
  }

  if (exitCode !== null && exitCode !== 0 && contentLines.length === 0) {
    return {
      available: false,
      reason: 'Docker 命令执行超时或不可用，已跳过',
      containers: [],
    };
  }

  const containers: NasDockerContainer[] = [];
  for (const line of contentLines) {
    if (!line.startsWith('{')) continue;
    try {
      const item = JSON.parse(line) as Record<string, unknown>;
      const name = typeof item.Names === 'string' ? item.Names : '';
      const image = typeof item.Image === 'string' ? item.Image : '';
      const state = typeof item.State === 'string' ? item.State : '';
      const status = typeof item.Status === 'string' ? item.Status : '';
      const runningFor = typeof item.RunningFor === 'string' ? item.RunningFor : '';
      const ports = typeof item.Ports === 'string' ? item.Ports : '';
      const id = typeof item.ID === 'string' ? item.ID : name || String(containers.length + 1);
      containers.push({ id, name, image, state, status, runningFor, ports });
    } catch {
      // 忽略单行非 JSON 输出
    }
  }

  return {
    available: true,
    containers,
  };
}

/**
 * 解析 NAS 只读 SSH 脚本完整输出。
 */
export function parseNasStatusOutput(stdout: string, nowMs: number = Date.now()): NasStatusData {
  if (!stdout.trim()) {
    throw new DeviceStatusClassifiedError('PARSE_FAILED', 'NAS 采集输出为空');
  }

  const { kv, sections } = parseKeyValueAndSections(stdout);
  const hostname = kv.HOSTNAME?.trim();
  if (!hostname) {
    throw new DeviceStatusClassifiedError('PARSE_FAILED', 'NAS 采集输出缺少主机名');
  }

  const uptimeMatch = /^([\d.]+)/.exec(kv.UPTIME ?? '');
  if (!uptimeMatch?.[1]) {
    throw new DeviceStatusClassifiedError('PARSE_FAILED', 'NAS 采集输出缺少运行时长');
  }
  const uptimeSeconds = Math.max(0, Math.floor(Number(uptimeMatch[1])));
  const nowSecRaw = Number(kv.NOW_EPOCH);
  const nowSec = Number.isFinite(nowSecRaw) && nowSecRaw > 0 ? nowSecRaw : Math.floor(nowMs / 1000);
  const bootTime = new Date((nowSec - uptimeSeconds) * 1000).toISOString();

  const memLines = sections.MEMINFO ?? [];
  const memTotalKb = parseMeminfoKb(memLines, 'MemTotal');
  if (!memTotalKb || memTotalKb <= 0) {
    throw new DeviceStatusClassifiedError('PARSE_FAILED', 'NAS 采集输出内存总量无效');
  }

  const memAvailableKb = parseMeminfoKb(memLines, 'MemAvailable');
  let availableKb: number;
  if (memAvailableKb !== null) {
    availableKb = Math.min(memTotalKb, Math.max(0, memAvailableKb));
  } else {
    const memFreeKb = parseMeminfoKb(memLines, 'MemFree') ?? 0;
    const buffersKb = parseMeminfoKb(memLines, 'Buffers') ?? 0;
    const cachedKb = parseMeminfoKb(memLines, 'Cached') ?? 0;
    availableKb = Math.min(memTotalKb, Math.max(0, memFreeKb + buffersKb + cachedKb));
  }
  const usedMemKb = Math.max(0, memTotalKb - availableKb);
  const totalBytes = memTotalKb * 1024;
  const availableBytes = availableKb * 1024;
  const usedBytes = Math.min(totalBytes, usedMemKb * 1024);

  const coresRaw = Number(kv.CPU_CORES);
  const cores = Number.isFinite(coresRaw) && coresRaw > 0 ? Math.floor(coresRaw) : 0;
  const loadAvg = parseLoadAvg(kv.LOADAVG);

  let loadPercent = 0;
  const stat1 = parseCpuStat(kv.CPU_STAT_1);
  const stat2 = parseCpuStat(kv.CPU_STAT_2);
  if (stat1 && stat2 && stat2.total > stat1.total) {
    const deltaTotal = stat2.total - stat1.total;
    const deltaIdle = Math.max(0, stat2.idle - stat1.idle);
    loadPercent = clampPercent(((deltaTotal - deltaIdle) / deltaTotal) * 100);
  } else {
    loadPercent = clampPercent((loadAvg[0] / Math.max(1, cores)) * 100);
  }

  const temperatures = parseNasTemperatures(sections.THERMAL ?? []);
  const smart = parseNasSmartOutput(sections.SMART ?? []);
  const tempCandidates = [
    ...temperatures.map((g) => g.maxTempC),
    ...(smart.available ? smart.disks.map((d) => d.tempC) : []),
  ];
  const maxTemperatureC = tempCandidates.length > 0 ? Math.max(...tempCandidates) : null;

  return {
    hostname,
    osVersion: parseOsVersion(sections.OS_RELEASE ?? []),
    uptimeSeconds,
    bootTime,
    loadAvg,
    cpu: {
      model: kv.CPU_MODEL?.trim() || '未知型号',
      cores,
      loadPercent,
    },
    memory: {
      totalBytes,
      usedBytes,
      availableBytes,
      usedPercent: clampPercent((usedBytes / totalBytes) * 100),
    },
    temperatures,
    maxTemperatureC,
    smart,
    raids: parseMdstatOutput(sections.MDSTAT ?? []),
    volumes: parseNasDfOutput(sections.DF ?? []),
    docker: parseNasDockerOutput(sections.DOCKER ?? []),
  };
}

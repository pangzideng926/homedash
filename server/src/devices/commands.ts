/**
 * 将 PowerShell 脚本编码为 UTF-16LE Base64，供 -EncodedCommand 参数安全传递，
 * 避免引号转义以及 Windows OpenSSH 默认 shell 为 PowerShell 时双引号内变量提前展开的问题。
 */
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * Unix 系统只读识别命令（仅调用 uname -s 查询内核名称，绝对只读）。
 */
export const UNIX_OS_PROBE_COMMAND = 'uname -s';

/**
 * Windows PowerShell 只读识别脚本（仅读取 $PSVersionTable.PSVersion.Major，绝对只读）。
 */
export const WINDOWS_OS_PROBE_SCRIPT = '$PSVersionTable.PSVersion.Major';

/**
 * 固定的只读 Windows PowerShell 系统识别命令常量（通过 -EncodedCommand 执行，避免外层 PowerShell 展开 $PSVersionTable）。
 */
export const WINDOWS_OS_PROBE_COMMAND = `powershell -NoProfile -NonInteractive -EncodedCommand ${encodePowerShellCommand(WINDOWS_OS_PROBE_SCRIPT)}`;

/**
 * Windows 只读状态采集脚本（严格只读）：
 * 仅在开头设置当前 PowerShell 进程的标准输出编码为 UTF-8（[Console]::OutputEncoding 仅作用于当前进程输出，不修改系统设置，仍保持只读），
 * 避免中文 Windows 通过 SSH 输出时使用系统代码页（如 GBK）导致 os 等字段中的中文乱码；
 * 随后仅通过 Get-CimInstance 查询操作系统、主机名、处理器核数与负载、内存与本地固定磁盘（DriveType=3），
 * 并通过 ConvertTo-Json -Compress 输出 JSON；绝对不包含重启、关机、安装或写文件等任何修改操作。
 */
export const WINDOWS_READONLY_STATUS_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "$ErrorActionPreference = 'Stop'",
  '$os = Get-CimInstance -ClassName Win32_OperatingSystem',
  '$cs = Get-CimInstance -ClassName Win32_ComputerSystem',
  '$cpus = @(Get-CimInstance -ClassName Win32_Processor)',
  "$disks = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=3')",
  '$cpuLoads = @($cpus | Where-Object { $null -ne $_.LoadPercentage } | ForEach-Object { [double]$_.LoadPercentage })',
  '$avgLoad = if ($cpuLoads.Count -gt 0) { [math]::Round(($cpuLoads | Measure-Object -Average).Average, 1) } else { 0 }',
  "$cpuModel = if ($cpus.Count -gt 0 -and $cpus[0].Name) { $cpus[0].Name.Trim() } else { '未知型号' }",
  '$logicalCores = [int](($cpus | Where-Object { $null -ne $_.NumberOfLogicalProcessors } | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum)',
  '$physicalCores = [int](($cpus | Where-Object { $null -ne $_.NumberOfCores } | Measure-Object -Property NumberOfCores -Sum).Sum)',
  '$cpuCores = if ($logicalCores -gt 0) { $logicalCores } elseif ($physicalCores -gt 0) { $physicalCores } else { 0 }',
  '$bootTimeUtc = $os.LastBootUpTime.ToUniversalTime()',
  '$uptimeSeconds = [int64][math]::Max([double]0, [math]::Floor(((Get-Date).ToUniversalTime() - $bootTimeUtc).TotalSeconds))',
  '$totalMem = [int64]$os.TotalVisibleMemorySize * 1024',
  '$freeMem = [int64]$os.FreePhysicalMemory * 1024',
  '$usedMem = [math]::Max([int64]0, [int64]($totalMem - $freeMem))',
  '$diskList = @($disks | ForEach-Object {',
  '  @{',
  '    drive = $_.DeviceID',
  '    mount = $_.DeviceID',
  "    label = if ($_.VolumeName) { $_.VolumeName } else { '' }",
  '    totalBytes = if ($null -ne $_.Size) { [int64]$_.Size } else { 0 }',
  '    freeBytes = if ($null -ne $_.FreeSpace) { [int64]$_.FreeSpace } else { 0 }',
  '  }',
  '})',
  '$result = @{',
  '  hostname = $cs.Name',
  "  os = ($os.Caption + ' ' + $os.Version).Trim()",
  "  bootTime = $bootTimeUtc.ToString('o')",
  '  uptimeSeconds = $uptimeSeconds',
  '  cpu = @{',
  '    model = $cpuModel',
  '    cores = $cpuCores',
  '    loadPercent = $avgLoad',
  '  }',
  '  memory = @{',
  '    totalBytes = $totalMem',
  '    freeBytes = $freeMem',
  '    usedBytes = $usedMem',
  '  }',
  '  disks = $diskList',
  '}',
  '$result | ConvertTo-Json -Depth 4 -Compress',
].join('\n');

/**
 * 固定的只读 Windows 状态采集命令常量（通过 -EncodedCommand 执行）。
 */
export const WINDOWS_READONLY_STATUS_COMMAND = `powershell -NoProfile -NonInteractive -EncodedCommand ${encodePowerShellCommand(WINDOWS_READONLY_STATUS_SCRIPT)}`;

/**
 * macOS 只读状态采集脚本（严格只读）：
 * 仅使用 scutil --get ComputerName / hostname / sw_vers / sysctl / date / vm_stat / top / df -k
 * 读取主机名、系统版本、开机时间、CPU、内存页统计与磁盘用量，输出结构化 key=value 行与分段；
 * 绝对不包含重启、关机、写文件、安装或修改系统配置的任何操作（脚本内不含单引号，可直接安全传入 /bin/sh -c）。
 */
export const MACOS_READONLY_STATUS_SCRIPT = [
  'echo "HOSTNAME=$(scutil --get ComputerName 2>/dev/null || hostname 2>/dev/null || echo unknown)"',
  'echo "OS_PRODUCT=$(sw_vers -productName 2>/dev/null || echo macOS)"',
  'echo "OS_VERSION=$(sw_vers -productVersion 2>/dev/null || true)"',
  'echo "OS_BUILD=$(sw_vers -buildVersion 2>/dev/null || true)"',
  'echo "BOOTTIME=$(sysctl -n kern.boottime 2>/dev/null || true)"',
  'echo "NOW_EPOCH=$(date +%s)"',
  'echo "CPU_MODEL=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || sysctl -n hw.model 2>/dev/null || echo unknown)"',
  'echo "CPU_CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo 0)"',
  'echo "MEM_TOTAL=$(sysctl -n hw.memsize 2>/dev/null || echo 0)"',
  'echo "===VM_STAT==="',
  'vm_stat 2>/dev/null || true',
  'echo "===TOP==="',
  'top -l 1 -n 0 2>/dev/null || true',
  'echo "===DF==="',
  'df -k 2>/dev/null || true',
  'echo "===END==="',
].join('\n');

/**
 * 固定的只读 macOS 状态采集命令常量（通过 /bin/sh -c 执行）。
 */
export const MACOS_READONLY_STATUS_COMMAND = `/bin/sh -c '${MACOS_READONLY_STATUS_SCRIPT}'`;

/**
 * Linux 只读状态采集脚本（严格只读）：
 * 仅读取 /proc/uptime、/proc/meminfo、/proc/stat（间隔短时两次采样）、/proc/loadavg、/proc/cpuinfo、
 * /etc/os-release、nproc 与 df -kPT/df -kP 输出结构化 key=value 行与分段；
 * 绝对不包含重启、关机、写文件、安装或修改系统配置的任何操作（脚本内不含单引号，可直接安全传入 /bin/sh -c）。
 */
export const LINUX_READONLY_STATUS_SCRIPT = [
  'echo "HOSTNAME=$(hostname 2>/dev/null || cat /proc/sys/kernel/hostname 2>/dev/null || echo unknown)"',
  'echo "NOW_EPOCH=$(date +%s)"',
  'echo "UPTIME=$(cat /proc/uptime 2>/dev/null || true)"',
  'echo "CPU_CORES=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 0)"',
  'echo "CPU_MODEL=$(grep -m1 -E "^model name" /proc/cpuinfo 2>/dev/null | cut -d: -f2- || true)"',
  'echo "LOADAVG=$(cat /proc/loadavg 2>/dev/null || true)"',
  'echo "CPU_STAT_1=$(head -n 1 /proc/stat 2>/dev/null || true)"',
  'sleep 0.2 2>/dev/null || sleep 1',
  'echo "CPU_STAT_2=$(head -n 1 /proc/stat 2>/dev/null || true)"',
  'echo "===OS_RELEASE==="',
  'cat /etc/os-release 2>/dev/null || true',
  'echo "===MEMINFO==="',
  'cat /proc/meminfo 2>/dev/null || true',
  'echo "===DF==="',
  'df -kPT 2>/dev/null || df -kP 2>/dev/null || true',
  'echo "===END==="',
].join('\n');

/**
 * 固定的只读 Linux 状态采集命令常量（通过 /bin/sh -c 执行）。
 */
export const LINUX_READONLY_STATUS_COMMAND = `/bin/sh -c '${LINUX_READONLY_STATUS_SCRIPT}'`;

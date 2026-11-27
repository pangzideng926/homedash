/**
 * Windows 只读状态采集脚本（严格只读）：
 * 仅通过 Get-CimInstance 查询操作系统、主机名、处理器负载、内存与本地固定磁盘（DriveType=3），
 * 并通过 ConvertTo-Json -Compress 输出 JSON；绝对不包含重启、关机、安装或写文件等任何修改操作。
 */
export const WINDOWS_READONLY_STATUS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$os = Get-CimInstance -ClassName Win32_OperatingSystem',
  '$cs = Get-CimInstance -ClassName Win32_ComputerSystem',
  '$cpus = @(Get-CimInstance -ClassName Win32_Processor)',
  "$disks = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=3')",
  '$cpuLoads = @($cpus | Where-Object { $null -ne $_.LoadPercentage } | ForEach-Object { [double]$_.LoadPercentage })',
  '$avgLoad = if ($cpuLoads.Count -gt 0) { [math]::Round(($cpuLoads | Measure-Object -Average).Average, 1) } else { 0 }',
  "$cpuModel = if ($cpus.Count -gt 0 -and $cpus[0].Name) { $cpus[0].Name.Trim() } else { '未知型号' }",
  '$bootTimeUtc = $os.LastBootUpTime.ToUniversalTime()',
  '$uptimeSeconds = [int][math]::Max(0, [math]::Floor(((Get-Date).ToUniversalTime() - $bootTimeUtc).TotalSeconds))',
  '$totalMem = [int64]$os.TotalVisibleMemorySize * 1024',
  '$freeMem = [int64]$os.FreePhysicalMemory * 1024',
  '$diskList = @($disks | ForEach-Object {',
  '  @{',
  '    drive = $_.DeviceID',
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
  '    loadPercent = $avgLoad',
  '  }',
  '  memory = @{',
  '    totalBytes = $totalMem',
  '    freeBytes = $freeMem',
  '  }',
  '  disks = $diskList',
  '}',
  '$result | ConvertTo-Json -Depth 4 -Compress',
].join('\n');

/**
 * 将 PowerShell 脚本编码为 UTF-16LE Base64，供 -EncodedCommand 参数安全传递，避免引号转义问题。
 */
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * 固定的只读 Windows 状态采集命令常量（通过 -EncodedCommand 执行）。
 */
export const WINDOWS_READONLY_STATUS_COMMAND = `powershell -NoProfile -NonInteractive -EncodedCommand ${encodePowerShellCommand(WINDOWS_READONLY_STATUS_SCRIPT)}`;

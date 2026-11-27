/**
 * NAS 只读状态采集脚本（严格只读）：
 * 仅读取主机名、/etc/os-release、/proc/uptime、/proc/loadavg、nproc、/proc/cpuinfo、
 * /proc/stat（间隔短时两次采样）、/proc/meminfo、/sys/class/thermal、/sys/class/hwmon、
 * 只读 smartctl -A -j（不使用 sudo，无权限则跳过）、/proc/mdstat、df -kPT 与 docker ps -a；
 * 绝对不包含 sudo、重启、关机、写文件、docker start/stop/rm 等任何修改远端状态的命令。
 * 脚本内部不含单引号，可直接安全传入 /bin/sh -c 执行。
 */
export const NAS_READONLY_STATUS_SCRIPT = [
  'echo "HOSTNAME=$(hostname 2>/dev/null || cat /proc/sys/kernel/hostname 2>/dev/null || echo unknown)"',
  'echo "NOW_EPOCH=$(date +%s)"',
  'echo "UPTIME=$(cat /proc/uptime 2>/dev/null || true)"',
  'echo "LOADAVG=$(cat /proc/loadavg 2>/dev/null || true)"',
  'echo "CPU_CORES=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 0)"',
  'echo "CPU_MODEL=$(grep -m1 -E "^model name" /proc/cpuinfo 2>/dev/null | cut -d: -f2- || true)"',
  'echo "CPU_STAT_1=$(head -n 1 /proc/stat 2>/dev/null || true)"',
  'sleep 0.2 2>/dev/null || sleep 1',
  'echo "CPU_STAT_2=$(head -n 1 /proc/stat 2>/dev/null || true)"',
  'echo "===OS_RELEASE==="',
  'cat /etc/os-release 2>/dev/null || true',
  'echo "===MEMINFO==="',
  'cat /proc/meminfo 2>/dev/null || true',
  'echo "===THERMAL==="',
  'for z in /sys/class/thermal/thermal_zone*; do [ -d "$z" ] || continue; t=$(cat "$z/type" 2>/dev/null || true); v=$(cat "$z/temp" 2>/dev/null || true); [ -n "$v" ] && echo "TZ|$t|$v"; done',
  'for h in /sys/class/hwmon/hwmon*; do [ -d "$h" ] || continue; n=$(cat "$h/name" 2>/dev/null || true); for f in "$h"/temp*_input; do [ -r "$f" ] || continue; b=${f%_input}; l=$(cat "${b}_label" 2>/dev/null || true); v=$(cat "$f" 2>/dev/null || true); [ -n "$v" ] && echo "HW|$n|$l|$v"; done; done',
  'echo "===SMART==="',
  'if command -v smartctl >/dev/null 2>&1; then found=0; for d in /dev/sd[a-z]; do [ -b "$d" ] || continue; found=1; echo "SMART_DISK_START|$d"; if command -v timeout >/dev/null 2>&1; then out=$(timeout 3 smartctl -A -j "$d" 2>&1); rc=$?; else out=$(smartctl -A -j "$d" 2>&1); rc=$?; fi; echo "SMART_RC|$rc"; printf "%s\n" "$out"; echo "SMART_DISK_END"; done; [ "$found" -eq 0 ] && echo "SMART_NO_DISKS"; else echo "SMART_UNAVAILABLE"; fi',
  'echo "===MDSTAT==="',
  'cat /proc/mdstat 2>/dev/null || true',
  'echo "===DF==="',
  'df -kPT 2>/dev/null || df -kP 2>/dev/null || true',
  'echo "===DOCKER==="',
  'if command -v docker >/dev/null 2>&1; then if command -v timeout >/dev/null 2>&1; then timeout 4 docker ps -a --format "{{json .}}" 2>&1; else docker ps -a --format "{{json .}}" 2>&1; fi; echo "DOCKER_EXIT=$?"; else echo "DOCKER_NOT_INSTALLED"; fi',
  'echo "===END==="',
].join('\n');

/**
 * 固定的只读 NAS 状态采集命令常量（通过 /bin/sh -c 执行）。
 */
export const NAS_READONLY_STATUS_COMMAND = `/bin/sh -c '${NAS_READONLY_STATUS_SCRIPT}'`;

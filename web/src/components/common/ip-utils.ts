/**
 * 将 IPv4 或 IPv6 地址打码显示（保留首尾片段，隐藏中间片段）。
 */
export function maskIpAddress(ip: string): string {
  const trimmed = ip.trim();
  if (!trimmed) {
    return '';
  }

  const ipv4Parts = trimmed.split('.');
  if (ipv4Parts.length === 4 && !trimmed.includes(':')) {
    return `${ipv4Parts[0]}.•••.•••.${ipv4Parts[3]}`;
  }

  if (trimmed.includes(':')) {
    const segments = trimmed.split(':').filter((part) => part !== '');
    if (segments.length >= 2) {
      return `${segments[0]}:••••:${segments[segments.length - 1]}`;
    }
    if (segments.length === 1) {
      return `•••:${segments[0]}`;
    }
    return '•••';
  }

  if (trimmed.length <= 4) {
    return '••••';
  }
  return `${trimmed.slice(0, 2)}•••${trimmed.slice(-2)}`;
}

function isValidIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith('0')) return false;
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

function isValidIpv6Group(group: string): boolean {
  return /^[0-9a-fA-F]{1,4}$/.test(group);
}

function isValidIpv6(value: string): boolean {
  if (!value.includes(':')) return false;
  const zoneIndex = value.indexOf('%');
  const addressPart = zoneIndex === -1 ? value : value.slice(0, zoneIndex);
  if (zoneIndex !== -1 && value.slice(zoneIndex + 1).trim() === '') {
    return false;
  }

  const doubleColonCount = addressPart.split('::').length - 1;
  if (doubleColonCount > 1) return false;

  const [leftRaw = '', rightRaw = ''] = addressPart.split('::');
  const leftGroups = leftRaw === '' ? [] : leftRaw.split(':');
  const rightGroups = doubleColonCount === 1 && rightRaw !== '' ? rightRaw.split(':') : [];

  const checkTailForIpv4 = (groups: string[]): { valid: boolean; hextetCount: number } => {
    if (groups.length === 0) return { valid: true, hextetCount: 0 };
    const last = groups[groups.length - 1];
    if (last && last.includes('.')) {
      if (!isValidIpv4(last)) return { valid: false, hextetCount: 0 };
      const prefix = groups.slice(0, -1);
      return {
        valid: prefix.every(isValidIpv6Group),
        hextetCount: prefix.length + 2,
      };
    }
    return {
      valid: groups.every(isValidIpv6Group),
      hextetCount: groups.length,
    };
  };

  if (doubleColonCount === 0) {
    const res = checkTailForIpv4(leftGroups);
    return res.valid && res.hextetCount === 8;
  }

  if (!leftGroups.every(isValidIpv6Group)) return false;
  const rightRes = checkTailForIpv4(rightGroups);
  if (!rightRes.valid) return false;
  return leftGroups.length + rightRes.hextetCount < 8;
}

/**
 * 在浏览器端校验文本是否为有效的 IPv4 或 IPv6 地址。
 */
export function isValidIpInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return isValidIpv4(trimmed) || isValidIpv6(trimmed);
}

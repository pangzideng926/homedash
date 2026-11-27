export { isValidIpInput, maskIpAddress } from '@/components/common/ip-utils';

export const LONG_NOTE_THRESHOLD = 40;

/**
 * 组合 VPS 卡片标题（地区 + 名称），若名称已等于或包含地区则不重复显示。
 */
export function formatVpsCardTitle(name: string, region: string | null | undefined): string {
  const trimmedName = name.trim();
  const trimmedRegion = region?.trim() ?? '';
  if (!trimmedRegion) {
    return trimmedName;
  }
  if (
    trimmedName === trimmedRegion ||
    trimmedName.toLowerCase().includes(trimmedRegion.toLowerCase())
  ) {
    return trimmedName;
  }
  return `${trimmedRegion} · ${trimmedName}`;
}

/**
 * 格式化月流量额度（单位 GB）。
 */
export function formatMonthlyTraffic(gb: number | null): string | null {
  if (gb === null) return null;
  return `${gb} GB`;
}

/**
 * 格式化价格与币种。
 */
export function formatVpsPrice(price: number | null, currency: string | null): string | null {
  if (price === null) return null;
  return currency ? `${price} ${currency}` : String(price);
}

/**
 * 判断备注是否属于需要默认折叠的较长备注。
 */
export function isLongNote(note: string | null): boolean {
  if (!note) return false;
  return note.length > LONG_NOTE_THRESHOLD || note.includes('\n');
}

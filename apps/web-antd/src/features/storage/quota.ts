export type QuotaUnit = 'B' | 'GB' | 'TB';

const unitDecimals: Record<QuotaUnit, number> = {
  B: 0,
  GB: 9,
  TB: 12,
};

/**
 * Choose an initial quota unit: exact terabytes use TB, sub-gigabyte byte
 * fixtures use B, and zero or gigabyte-scale quotas default to decimal GB.
 */
export function defaultQuotaUnit(limitBytes: number): QuotaUnit {
  if (limitBytes >= 1_000_000_000_000 && limitBytes % 1_000_000_000_000 === 0) {
    return 'TB';
  }
  if (limitBytes > 0 && limitBytes < 1_000_000_000) {
    return 'B';
  }
  return 'GB';
}

export function formatQuotaPlaceholder(
  limitBytes: number,
  unit: QuotaUnit,
): string {
  const decimals = unitDecimals[unit];
  if (decimals === 0 || limitBytes === 0) return String(limitBytes);
  const digits = String(limitBytes).padStart(decimals + 1, '0');
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/u, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * Convert a human-entered decimal quota and unit into an exact safe-integer
 * byte count without IEEE-754 floating-point rounding.
 */
export function parseQuotaBytes(
  raw: string,
  unit: QuotaUnit,
): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const decimals = unitDecimals[unit];
  if (decimals === 0) {
    if (!/^\d+$/u.test(trimmed)) return undefined;
    const value = BigInt(trimmed);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
  }
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(trimmed);
  if (!match) return undefined;
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) return undefined;
  const scale = BigInt(`1${'0'.repeat(decimals)}`);
  const padded = fraction.padEnd(decimals, '0');
  const bytes = BigInt(whole) * scale + BigInt(padded || '0');
  return bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : undefined;
}

/** Display name of a storage adapter; unknown adapters show their identifier. */
export const adapterName = (id: string) => (id === 'bhpan' ? 'BHpan' : id);

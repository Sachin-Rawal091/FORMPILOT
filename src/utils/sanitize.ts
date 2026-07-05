const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function sanitizeTextValue(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n');
}

export function sanitizeObjectKey(key: string): string | null {
  const sanitized = sanitizeTextValue(key).trim();
  if (!sanitized || UNSAFE_KEYS.has(sanitized.toLowerCase())) {
    return null;
  }
  return sanitized;
}

export function normalizeCellValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return sanitizeTextValue(value);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  return sanitizeTextValue(String(value));
}

export function sanitizeLogText(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return sanitizeTextValue(String(value));
}

import { ValidationError } from './errors.js';
import type { Limits } from './limits.js';

export function parseDecimalInteger(text: string, limits: Limits): bigint {
  if (typeof text !== 'string') {
    throw new ValidationError('INVALID_INTEGER_TEXT', '整数必须是十进制字符串。', { value: String(text) });
  }
  const value = text.trim();
  if (!/^[+-]?\d+$/.test(value)) {
    throw new ValidationError('INVALID_INTEGER_TEXT', '非法十进制整数文本。', { value: text });
  }
  const digits = value.replace(/^[+-]/, '').replace(/^0+(?=\d)/, '');
  if (digits.length > limits.maxIntegerDigits) {
    throw new ValidationError('INTEGER_TOO_LARGE', `整数位数超过上限 ${limits.maxIntegerDigits}。`, {
      digits: digits.length
    });
  }
  return BigInt(value);
}

export function parseIntegerArray(values: unknown, limits: Limits, field = 'values'): bigint[] {
  if (!Array.isArray(values)) {
    throw new ValidationError('INVALID_ARRAY', `${field} 必须是数组。`);
  }
  if (values.length === 0) {
    throw new ValidationError('EMPTY_ARRAY', '数组不能为空。');
  }
  if (values.length > limits.maxLength) {
    throw new ValidationError('LENGTH_TOO_LARGE', `数组长度超过上限 ${limits.maxLength}。`, {
      length: values.length
    });
  }
  const parsed = values.map((value) => parseDecimalInteger(String(value), limits));
  assertPowerOfTwo(parsed.length);
  return parsed;
}

export function assertPowerOfTwo(length: number): void {
  if (!Number.isSafeInteger(length) || length < 1 || (length & (length - 1)) !== 0) {
    throw new ValidationError('LENGTH_NOT_POWER_OF_TWO', '数组长度必须是二的非负整数次幂。', { length });
  }
}

export function assertSameLength(a: bigint[], b: bigint[]): void {
  if (a.length !== b.length) {
    throw new ValidationError('LENGTH_MISMATCH', '异或卷积要求两个数组等长。', {
      aLength: a.length,
      bLength: b.length
    });
  }
}

export function assertIndex(index: unknown, length: number): number {
  const numberIndex = typeof index === 'string' ? Number(index) : typeof index === 'number' ? index : NaN;
  if (!Number.isInteger(numberIndex) || numberIndex < 0 || numberIndex >= length) {
    throw new ValidationError('INVALID_INDEX', '下标超出数组范围。', { index, length });
  }
  return numberIndex as number;
}

export function bitWidthOf(length: number): number {
  return Math.log2(length);
}

export function maskOf(index: number, width: number): string {
  return index.toString(2).padStart(width, '0');
}

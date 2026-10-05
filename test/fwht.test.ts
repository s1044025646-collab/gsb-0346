import { describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directXorConvolutionForTest, forwardTransform, inverseTransform, xorConvolve } from '../src/core/fwht.js';
import { ValidationError } from '../src/core/errors.js';
import { DEFAULT_LIMITS } from '../src/core/limits.js';
import { parseIntegerArray } from '../src/core/validate.js';
import { AnalysisStore } from '../src/db/store.js';
import { AnalysisService } from '../src/services/analysisService.js';

function independentMatrix(values: bigint[]): bigint[] {
  return values.map((_, k) =>
    values.reduce((sum, value, i) => sum + ((popCount(BigInt(i & k)) % 2n === 0n ? 1n : -1n) * value), 0n)
  );
}

function popCount(value: bigint): bigint {
  let count = 0n;
  while (value) {
    count += value & 1n;
    value >>= 1n;
  }
  return count;
}

describe('Walsh-Hadamard 核心算法', () => {
  test('长度四自然顺序未归一化变换', () => {
    const a = parseIntegerArray(['1', '2', '3', '4'], DEFAULT_LIMITS);
    expect(forwardTransform(a).coefficients.map(String)).toEqual(['10', '-2', '-4', '0']);
    expect(forwardTransform(a).coefficients).toEqual(independentMatrix(a));
  });

  test('两次前向变换等于长度倍原数组', () => {
    const a = parseIntegerArray(['7', '-8', '0', '4'], DEFAULT_LIMITS);
    const twice = forwardTransform(forwardTransform(a).coefficients).coefficients;
    expect(twice).toEqual(a.map((value) => value * 4n));
  });

  test('长度一、全零、负数和超出安全整数', () => {
    expect(forwardTransform([123456789012345678901234567890n]).coefficients[0]).toBe(123456789012345678901234567890n);
    expect(forwardTransform([0n, 0n]).coefficients).toEqual([0n, 0n]);
    expect(forwardTransform([-3n, 5n]).coefficients).toEqual([2n, -8n]);
  });

  test('快速异或卷积与直接二重循环一致且可交换', () => {
    const a = parseIntegerArray(['1', '2', '3', '4'], DEFAULT_LIMITS);
    const b = parseIntegerArray(['1', '-1', '0', '2'], DEFAULT_LIMITS);
    const fast = xorConvolve(a, b).coefficients;
    expect(fast).toEqual(directXorConvolutionForTest(a, b));
    expect(fast.map(String)).toEqual(['7', '7', '3', '3']);
    expect(xorConvolve(b, a).coefficients).toEqual(fast);
  });

  test('单位脉冲：零下标保持，其他下标异或重排', () => {
    const b = parseIntegerArray(['10', '11', '12', '13'], DEFAULT_LIMITS);
    expect(xorConvolve([1n, 0n, 0n, 0n], b).coefficients).toEqual(b);
    expect(xorConvolve([0n, 0n, 1n, 0n], b).coefficients).toEqual([12n, 13n, 10n, 11n]);
  });

  test('任意外部系数的逆变换保留约分有理数和非整除标记', () => {
    const inverse = inverseTransform([1n, 0n, 0n, 0n]).coefficients;
    expect(inverse).toEqual([
      { numerator: '1', denominator: '4' },
      { numerator: '1', denominator: '4' },
      { numerator: '1', denominator: '4' },
      { numerator: '1', denominator: '4' }
    ]);
  });

  test('拒绝非法输入', () => {
    expect(() => parseIntegerArray([], DEFAULT_LIMITS)).toThrow(ValidationError);
    expect(() => parseIntegerArray(['1.2'], DEFAULT_LIMITS)).toThrowError(/非法十进制整数文本/);
    expect(() => parseIntegerArray(['1.2'], DEFAULT_LIMITS)).toThrowError(
      expect.objectContaining({ code: 'INVALID_INTEGER_TEXT' })
    );
    expect(() => parseIntegerArray(['1', '2', '3'], DEFAULT_LIMITS)).toThrowError(
      expect.objectContaining({ code: 'LENGTH_NOT_POWER_OF_TWO' })
    );
    expect(() => xorConvolve([1n, 2n], [1n])).toThrowError(
      expect.objectContaining({ code: 'LENGTH_MISMATCH' })
    );
  });
});

describe('SQLite 服务', () => {
  test('完成结果原子保存，重启后仍按冻结版本解释', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fwht-'));
    const dbPath = join(dir, 'test.sqlite');
    const first = new AnalysisService(new AnalysisStore(dbPath));
    const report = first.convolution(['1', '2'], ['3', '4']);
    expect(report.result).toEqual(['11', '10']);
    expect(report.algorithmVersion).toBe('fwht-natural-butterfly/v1');
    first['store'].close();

    const reopened = new AnalysisService(new AnalysisStore(dbPath));
    const loaded = reopened.report(report.id);
    expect(loaded.coefficientOrder).toBe('NATURAL_BINARY');
    expect(loaded.scaling).toBe('FORWARD_POINTWISE_INVERSE');
    expect(reopened.contribution(report.id, 1).contributions[0]).toMatchObject({ i: 0, j: 1 });
    reopened['store'].close();
  });

  test('非法参数失败记录不发布半个数组', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fwht-'));
    const store = new AnalysisStore(join(dir, 'test.sqlite'));
    const service = new AnalysisService(store);
    expect(() => service.convolution(['1'], ['2', '3'])).toThrowError(
      expect.objectContaining({ code: 'LENGTH_MISMATCH' })
    );
    store.saveFailure({ operation: 'convolution', errorCode: 'TEST', errorMessage: 'rollback' });
    expect(store.get(1).status).toBe('failed');
    expect(store.get(1).result).toBeNull();
    store.close();
  });
});

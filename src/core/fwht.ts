import type { ButterflyLayerView, ButterflyPair, Rational } from './types.js';
import { assertSameLength, bitWidthOf } from './validate.js';

function clone(values: bigint[]): bigint[] {
  return values.slice();
}

export function forwardTransform(values: bigint[]): { coefficients: bigint[]; layers: ButterflyLayerView[] } {
  const current = clone(values);
  const layers: ButterflyLayerView[] = [];
  const width = bitWidthOf(current.length);

  for (let layer = 0; layer < width; layer += 1) {
    const before = clone(current);
    const span = 1 << layer;
    const pairs: ButterflyPair[] = [];

    for (let base = 0; base < current.length; base += span * 2) {
      for (let offset = 0; offset < span; offset += 1) {
        const lowIndex = base + offset;
        const highIndex = lowIndex + span;
        const u = current[lowIndex];
        const v = current[highIndex];
        current[lowIndex] = u + v;
        current[highIndex] = u - v;
        pairs.push({
          layer,
          span,
          lowIndex,
          highIndex,
          oldU: u.toString(),
          oldV: v.toString(),
          newU: (u + v).toString(),
          newV: (u - v).toString()
        });
      }
    }

    layers.push({ layer, span, before: before.map(String), after: clone(current).map(String), pairs });
  }

  return { coefficients: current, layers };
}

function normalizeRational(numerator: bigint, denominator: bigint): Rational {
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const divisor = gcd(numerator < 0n ? -numerator : numerator, denominator);
  return {
    numerator: (numerator / divisor).toString(),
    denominator: (denominator / divisor).toString()
  };
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a;
  let y = b;
  while (y !== 0n) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x === 0n ? 1n : x;
}

export function inverseTransform(values: bigint[]): { coefficients: Rational[]; layers: ButterflyLayerView[] } {
  const transformed = forwardTransform(values);
  const length = BigInt(values.length);
  return {
    coefficients: transformed.coefficients.map((value) => normalizeRational(value, length)),
    layers: transformed.layers
  };
}

export function xorConvolve(a: bigint[], b: bigint[]): {
  coefficients: bigint[];
  transformedA: bigint[];
  transformedB: bigint[];
} {
  assertSameLength(a, b);
  const fa = forwardTransform(a).coefficients;
  const fb = forwardTransform(b).coefficients;
  const product = fa.map((value, index) => value * fb[index]);
  const restored = inverseTransform(product).coefficients;
  if (restored.some((value) => value.denominator !== '1')) {
    throw new Error('整数数组的异或卷积逆变换应全部整除。');
  }
  return {
    coefficients: restored.map((value) => BigInt(value.numerator)),
    transformedA: fa,
    transformedB: fb
  };
}

export function directXorConvolutionForTest(a: bigint[], b: bigint[]): bigint[] {
  const result = new Array<bigint>(a.length).fill(0n);
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      result[i ^ j] += a[i] * b[j];
    }
  }
  return result;
}

export function contributionsAt(a: bigint[], b: bigint[], k: number, limit: number) {
  const width = bitWidthOf(a.length);
  const contributions = [];
  for (let i = 0; i < a.length && contributions.length < limit; i += 1) {
    const j = i ^ k;
    contributions.push({
      i,
      j,
      iMask: i.toString(2).padStart(width, '0'),
      jMask: j.toString(2).padStart(width, '0'),
      a: a[i].toString(),
      b: b[j].toString(),
      product: (a[i] * b[j]).toString()
    });
  }
  return { contributions, truncated: a.length > limit };
}

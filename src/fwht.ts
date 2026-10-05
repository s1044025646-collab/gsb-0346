// 核心：自然二进制下标顺序的 Walsh-Hadamard 快速蝶形变换（BigInt 精确）。
// 约定：未归一化前向变换。矩阵 H 满足 H*H = n*I，即变换两次 = 原数组 * n。
// 逆变换 = 相同蝶形后每项除以 n（对任意外部系数可能产生有理数）。

export interface ButterflyStep {
  layer: number;   // 层号，从 0 开始；该层配对跨度 span = 2^layer
  span: number;
  i: number;       // 较小下标
  j: number;       // i + span
  u: string;       // 旧值 a[i]
  v: string;       // 旧值 a[j]
  sum: string;     // 新值 a[i] = u + v
  diff: string;    // 新值 a[j] = u - v
}

export interface ForwardResult {
  coeffs: bigint[];
  steps: ButterflyStep[]; // 完整蝶形步骤（计算总是完整的，仅展示端可分页/截断）
  bitWidth: number;       // log2(n)，下标位掩码宽度
}

export function isPowerOfTwo(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0;
}

export function bitWidthOf(n: number): number {
  let w = 0;
  while ((1 << w) < n) w++;
  return w;
}

// 就地蝶形：每层先取旧值 u、v 再写回，保证层内不会读到已覆盖的值。
function butterflyInPlace(a: bigint[], record: ButterflyStep[] | null): void {
  const n = a.length;
  let layer = 0;
  for (let span = 1; span < n; span <<= 1, layer++) {
    for (let start = 0; start < n; start += span * 2) {
      for (let i = start; i < start + span; i++) {
        const j = i + span;
        const u = a[i];
        const v = a[j];
        const sum = u + v;
        const diff = u - v;
        a[i] = sum;
        a[j] = diff;
        if (record) {
          record.push({
            layer, span, i, j,
            u: u.toString(), v: v.toString(),
            sum: sum.toString(), diff: diff.toString(),
          });
        }
      }
    }
  }
}

export function fwhtForward(input: bigint[], recordSteps = true): ForwardResult {
  const a = input.slice();
  const steps: ButterflyStep[] | null = recordSteps ? [] : null;
  butterflyInPlace(a, steps);
  return { coeffs: a, steps: steps ?? [], bitWidth: bitWidthOf(a.length) };
}

export interface Rational {
  num: bigint;
  den: bigint; // 正，约分后
}

export function gcd(x: bigint, y: bigint): bigint {
  let a = x < 0n ? -x : x;
  let b = y < 0n ? -y : y;
  while (b !== 0n) { const t = a % b; a = b; b = t; }
  return a === 0n ? 1n : a;
}

export interface InverseResult {
  // 每项为约分后的有理数；den === 1n 时为整数
  terms: Rational[];
  exactIntegers: boolean;
  nonIntegerIndices: number[]; // 明确标记非整除位置
  steps: ButterflyStep[];
  bitWidth: number;
}

export function fwhtInverse(input: bigint[], recordSteps = true): InverseResult {
  const a = input.slice();
  const steps: ButterflyStep[] | null = recordSteps ? [] : null;
  butterflyInPlace(a, steps);
  const n = BigInt(a.length);
  const terms: Rational[] = a.map((v) => {
    const g = gcd(v, n);
    return { num: v / g, den: n / g };
  });
  const nonIntegerIndices: number[] = [];
  terms.forEach((t, idx) => { if (t.den !== 1n) nonIntegerIndices.push(idx); });
  return {
    terms,
    exactIntegers: nonIntegerIndices.length === 0,
    nonIntegerIndices,
    steps: steps ?? [],
    bitWidth: bitWidthOf(a.length),
  };
}

export interface ConvolveResult {
  coeffs: bigint[]; // 精确整数
  bitWidth: number;
  stepsA: ButterflyStep[];
  stepsB: ButterflyStep[];
}

export function xorConvolve(a: bigint[], b: bigint[]): ConvolveResult {
  const fa = fwhtForward(a, true);
  const fb = fwhtForward(b, true);
  const n = a.length;
  const prod = new Array<bigint>(n);
  for (let k = 0; k < n; k++) prod[k] = fa.coeffs[k] * fb.coeffs[k];
  const inv = fwhtInverse(prod, false);
  if (!inv.exactIntegers) {
    // 理论上整数输入必然整除；此处防御性检查
    throw new Error("internal: convolution inverse not divisible");
  }
  return {
    coeffs: inv.terms.map((t) => t.num),
    bitWidth: fa.bitWidth,
    stepsA: fa.steps,
    stepsB: fb.steps,
  };
}

// 卷积第 k 项的逐项贡献（可核对的小规模展示）
export interface Contribution {
  i: number;
  j: number;
  ai: string;
  bj: string;
  product: string;
}

export function convolutionTerm(a: bigint[], b: bigint[], k: number): { value: bigint; contributions: Contribution[] } {
  let value = 0n;
  const contributions: Contribution[] = [];
  for (let i = 0; i < a.length; i++) {
    const j = i ^ k;
    const p = a[i] * b[j];
    value += p;
    contributions.push({ i, j, ai: a[i].toString(), bj: b[j].toString(), product: p.toString() });
  }
  return { value, contributions };
}

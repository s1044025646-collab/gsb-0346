import { test } from "node:test";
import assert from "node:assert/strict";
import { fwhtForward, fwhtInverse, xorConvolve, convolutionTerm } from "../src/fwht";

// 仅用于测试的直接二重循环卷积
function naiveConvolve(a: bigint[], b: bigint[]): bigint[] {
  const n = a.length;
  const c = new Array<bigint>(n).fill(0n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      c[i ^ j] += a[i] * b[j];
  return c;
}

// 独立符号矩阵：H(1)=[1], H(2k)=[[H,H],[H,-H]]，矩阵乘法核对变换
function hadamardMatrix(n: number): bigint[][] {
  let h: bigint[][] = [[1n]];
  while (h.length < n) {
    const m = h.length;
    const next: bigint[][] = [];
    for (let i = 0; i < 2 * m; i++) {
      next.push(new Array<bigint>(2 * m));
      for (let j = 0; j < 2 * m; j++) {
        next[i][j] = i < m ? h[i % m][j % m] : (j < m ? h[i % m][j % m] : -h[i % m][j % m]);
      }
    }
    h = next;
  }
  return h;
}

function matrixApply(h: bigint[][], a: bigint[]): bigint[] {
  return h.map((row) => row.reduce((acc, v, j) => acc + v * a[j], 0n));
}

function randArr(n: number, bits: number): bigint[] {
  return Array.from({ length: n }, () => {
    let v = 0n;
    for (let i = 0; i < bits; i++) v = v * 2n + BigInt(Math.floor(Math.random() * 2));
    return Math.random() < 0.5 ? -v : v;
  });
}

test("长度 4 手算前向变换", () => {
  const r = fwhtForward([1n, 2n, 3n, 4n]);
  assert.deepEqual(r.coeffs, [10n, -2n, -4n, 0n]);
  assert.equal(r.bitWidth, 2);
  assert.equal(r.steps.length, 4); // 层0两对 + 层1两对
});

test("蝶形步骤层内不读已覆盖值（逐步重放核对）", () => {
  const a = [3n, -1n, 7n, 5n, 2n, 0n, -4n, 9n];
  const r = fwhtForward(a);
  const replay = a.slice();
  for (const s of r.steps) {
    assert.equal(replay[s.i].toString(), s.u);
    assert.equal(replay[s.j].toString(), s.v);
    replay[s.i] = BigInt(s.sum);
    replay[s.j] = BigInt(s.diff);
  }
  assert.deepEqual(replay, r.coeffs);
});

test("独立 Hadamard 矩阵核对变换（n=8 随机）", () => {
  const h = hadamardMatrix(8);
  for (let t = 0; t < 20; t++) {
    const a = randArr(8, 10);
    assert.deepEqual(fwhtForward(a).coeffs, matrixApply(h, a));
  }
});

test("两次前向变换 = 原数组乘长度", () => {
  const a = randArr(16, 12);
  const twice = fwhtForward(fwhtForward(a).coeffs).coeffs;
  assert.deepEqual(twice, a.map((v) => v * 16n));
});

test("逆变换恢复整数数组", () => {
  const a = randArr(8, 8);
  const inv = fwhtInverse(fwhtForward(a).coeffs);
  assert.ok(inv.exactIntegers);
  assert.deepEqual(inv.terms.map((t) => t.num), a);
});

test("任意外部系数的非整除逆变换返回约分有理数", () => {
  const inv = fwhtInverse([1n, 0n]); // n=2 -> [1/2, 1/2]
  assert.equal(inv.exactIntegers, false);
  assert.deepEqual(inv.nonIntegerIndices, [0, 1]);
  assert.deepEqual(inv.terms, [{ num: 1n, den: 2n }, { num: 1n, den: 2n }]);
  const inv2 = fwhtInverse([1n, 2n, 3n, 4n]); // [10/4=5/2, -2/4=-1/2, -4/4=-1, 0]
  assert.deepEqual(inv2.terms.map((t) => [t.num, t.den]), [[5n, 2n], [-1n, 2n], [-1n, 1n], [0n, 1n]]);
  assert.deepEqual(inv2.nonIntegerIndices, [0, 1]);
});

test("异或卷积与二重循环一致（随机小数组）", () => {
  for (const n of [1, 2, 4, 8, 16]) {
    for (let t = 0; t < 10; t++) {
      const a = randArr(n, 8), b = randArr(n, 8);
      assert.deepEqual(xorConvolve(a, b).coeffs, naiveConvolve(a, b));
    }
  }
});

test("卷积交换律", () => {
  const a = randArr(8, 8), b = randArr(8, 8);
  assert.deepEqual(xorConvolve(a, b).coeffs, xorConvolve(b, a).coeffs);
});

test("负数与全零", () => {
  assert.deepEqual(fwhtForward([-1n, -2n]).coeffs, [-3n, 1n]);
  assert.deepEqual(xorConvolve([0n, 0n, 0n, 0n], [1n, 2n, 3n, 4n]).coeffs, [0n, 0n, 0n, 0n]);
  assert.deepEqual(xorConvolve([-1n, 2n], [3n, -4n]).coeffs, naiveConvolve([-1n, 2n], [3n, -4n]));
});

test("长度 1 合法", () => {
  assert.deepEqual(fwhtForward([42n]).coeffs, [42n]);
  assert.deepEqual(xorConvolve([7n], [9n]).coeffs, [63n]);
});

test("超过 Number.MAX_SAFE_INTEGER 的精确值", () => {
  const big = 9007199254740993n; // 2^53 + 1
  const a = [big, big], b = [big, big];
  const c = xorConvolve(a, b);
  assert.deepEqual(c.coeffs, naiveConvolve(a, b));
  assert.equal(c.coeffs[0], 2n * big * big);
  assert.equal(c.coeffs[1], 2n * big * big);
});

test("单位脉冲：零下标保持，其他下标按异或重排", () => {
  const b = [11n, 22n, 33n, 44n];
  assert.deepEqual(xorConvolve([1n, 0n, 0n, 0n], b).coeffs, b);
  const c2 = xorConvolve([0n, 0n, 1n, 0n], b).coeffs;
  for (let k = 0; k < 4; k++) assert.equal(c2[k], b[k ^ 2]);
});

test("卷积单项贡献可核对", () => {
  const a = [1n, 2n, 3n, 4n], b = [5n, 6n, 7n, 8n];
  const { value, contributions } = convolutionTerm(a, b, 3);
  assert.equal(value, 60n); // 1*8+2*7+3*6+4*5
  assert.equal(contributions.length, 4);
  for (const c of contributions) assert.equal(c.i ^ c.j, 3);
});


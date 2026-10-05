import { Store, ALGO_VERSION, INDEX_ORDER, AnalysisRow } from "./db";
import { Limits } from "./config";
import { ApiError } from "./errors";
import { parseArray, parseOp } from "./validate";
import {
  fwhtForward, fwhtInverse, xorConvolve, convolutionTerm,
  ButterflyStep, bitWidthOf,
} from "./fwht";

export interface AnalysisResponse {
  id: number;
  op: string;
  indexOrder: string;
  algoVersion: string;
  bitWidth: number;
  scaling: string;
  status: string;
  result: unknown;
}

const SCALING_NOTE =
  "未归一化前向变换：forward(forward(a)) = n * a；inverse = 相同蝶形后除以 n。下标为自然二进制顺序（非 sequency）。";

function stepsSummary(steps: ButterflyStep[]) {
  const layers = new Map<number, number>();
  for (const s of steps) layers.set(s.layer, (layers.get(s.layer) ?? 0) + 1);
  return {
    totalSteps: steps.length,
    layers: [...layers.entries()].map(([layer, count]) => ({ layer, span: 1 << layer, pairs: count })),
  };
}

export function runAnalysis(store: Store, limits: Limits, body: any): AnalysisResponse {
  const op = parseOp(body?.op);
  // 校验失败直接抛错，不产生任何数据库行（非法参数回滚）。
  const a = parseArray(body?.a, limits, "a");
  let b: bigint[] | null = null;
  if (op === "convolve") {
    b = parseArray(body?.b, limits, "b");
    if (a.length !== b.length) {
      throw new ApiError("E_LENGTH_MISMATCH", `卷积要求等长数组: ${a.length} != ${b.length}`);
    }
  }

  let result: unknown;
  let bitWidth = bitWidthOf(a.length);
  let stepsA: ButterflyStep[] = [];
  let stepsB: ButterflyStep[] | null = null;

  if (op === "forward") {
    const r = fwhtForward(a, true);
    stepsA = r.steps;
    result = { coeffs: r.coeffs.map(String) };
  } else if (op === "inverse") {
    const r = fwhtInverse(a, true);
    stepsA = r.steps;
    result = {
      exactIntegers: r.exactIntegers,
      nonIntegerIndices: r.nonIntegerIndices,
      terms: r.terms.map((t) => ({
        rational: t.den === 1n ? t.num.toString() : `${t.num}/${t.den}`,
        num: t.num.toString(),
        den: t.den.toString(),
      })),
    };
  } else {
    const r = xorConvolve(a, b!);
    stepsA = r.stepsA;
    stepsB = r.stepsB;
    result = { coeffs: r.coeffs.map(String) };
  }

  const id = store.saveCompleted({
    op,
    index_order: INDEX_ORDER,
    algo_version: ALGO_VERSION,
    bit_width: bitWidth,
    status: "done",
    input_a: JSON.stringify(a.map(String)),
    input_b: b ? JSON.stringify(b.map(String)) : null,
    result: JSON.stringify(result),
    steps_a: JSON.stringify(stepsA),
    steps_b: stepsB ? JSON.stringify(stepsB) : null,
    error: null,
  });

  return { id, op, indexOrder: INDEX_ORDER, algoVersion: ALGO_VERSION, bitWidth, scaling: SCALING_NOTE, status: "done", result };
}

function loadRow(store: Store, id: number): AnalysisRow {
  const row = store.get(id);
  if (!row) throw new ApiError("E_NOT_FOUND", `分析 ${id} 不存在`, 404);
  return row;
}

export function getAnalysis(store: Store, id: number) {
  const row = loadRow(store, id);
  return {
    id: row.id,
    createdAt: row.created_at,
    op: row.op,
    indexOrder: row.index_order,
    algoVersion: row.algo_version,
    bitWidth: row.bit_width,
    scaling: SCALING_NOTE,
    status: row.status,
    inputA: JSON.parse(row.input_a),
    inputB: row.input_b ? JSON.parse(row.input_b) : null,
    result: row.result ? JSON.parse(row.result) : null,
    error: row.error,
  };
}

// 完整报告导出（含全部蝶形步骤，不受解释条数上限影响）
export function getReport(store: Store, id: number) {
  const base = getAnalysis(store, id);
  const row = loadRow(store, id);
  const stepsA: ButterflyStep[] = row.steps_a ? JSON.parse(row.steps_a) : [];
  const stepsB: ButterflyStep[] | null = row.steps_b ? JSON.parse(row.steps_b) : null;
  return {
    ...base,
    stepsSummaryA: stepsSummary(stepsA),
    stepsSummaryB: stepsB ? stepsSummary(stepsB) : null,
    stepsA,
    stepsB,
  };
}

// 蝶形层查看：支持按层过滤与分页（limit 不超过配置上限；仅影响展示，不影响已完成的计算）
export function getLayers(store: Store, limits: Limits, id: number, which: "a" | "b", layer: number | null, offset: number, limit: number) {
  const row = loadRow(store, id);
  const raw = which === "b" ? row.steps_b : row.steps_a;
  if (!raw) throw new ApiError("E_BAD_PARAM", `分析 ${id} 没有 ${which} 的蝶形步骤`);
  let steps: ButterflyStep[] = JSON.parse(raw);
  if (layer !== null) {
    if (!Number.isInteger(layer) || layer < 0) throw new ApiError("E_BAD_PARAM", "layer 必须是非负整数");
    steps = steps.filter((s) => s.layer === layer);
  }
  const cap = Math.min(limit, limits.maxExplainSteps);
  return {
    total: steps.length,
    offset,
    limit: cap,
    steps: steps.slice(offset, offset + cap),
  };
}

// 查询卷积单项来源：列出所有 i^j=k 的乘积贡献
export function getTerm(store: Store, limits: Limits, id: number, k: number) {
  const row = loadRow(store, id);
  if (row.op !== "convolve") throw new ApiError("E_BAD_OP", `分析 ${id} 不是卷积`);
  const a: string[] = JSON.parse(row.input_a);
  const b: string[] = JSON.parse(row.input_b!);
  const n = a.length;
  if (!Number.isInteger(k) || k < 0 || k >= n) throw new ApiError("E_BAD_PARAM", `k 需在 [0, ${n}) 内`);
  const av = a.map(BigInt), bv = b.map(BigInt);
  const { value, contributions } = convolutionTerm(av, bv, k);
  return {
    k,
    value: value.toString(),
    note: `c[${k}] = sum of a[i]*b[j] where i XOR j = ${k}`,
    contributions: contributions.slice(0, limits.maxExplainSteps),
    truncated: contributions.length > limits.maxExplainSteps,
  };
}

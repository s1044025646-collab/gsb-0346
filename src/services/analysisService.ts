import { AnalysisStore, type Operation } from '../db/store.js';
import { ValidationError } from '../core/errors.js';
import { contributionsAt, forwardTransform, inverseTransform, xorConvolve } from '../core/fwht.js';
import { DEFAULT_LIMITS, type Limits } from '../core/limits.js';
import { assertIndex, assertSameLength, parseIntegerArray } from '../core/validate.js';

export class AnalysisService {
  constructor(
    private readonly store: AnalysisStore,
    private readonly limits: Limits = DEFAULT_LIMITS
  ) {}

  importArray(values: unknown) {
    const a = parseIntegerArray(values, this.limits, 'values');
    const id = this.store.saveCompleted({
      operation: 'import',
      inputA: a,
      result: a,
      scaling: 'INPUT_ONLY'
    });
    return this.report(id);
  }

  forward(values: unknown) {
    const a = parseIntegerArray(values, this.limits, 'a');
    const transformed = forwardTransform(a);
    const id = this.store.saveCompleted({
      operation: 'forward',
      inputA: a,
      result: transformed.coefficients,
      layers: transformed.layers,
      scaling: 'UNNORMALIZED_FORWARD'
    });
    return this.report(id);
  }

  inverse(values: unknown) {
    const a = parseIntegerArray(values, this.limits, 'a');
    const transformed = inverseTransform(a);
    const id = this.store.saveCompleted({
      operation: 'inverse',
      inputA: a,
      result: transformed.coefficients,
      layers: transformed.layers,
      scaling: 'FORWARD_BUTTERFLY_DIVIDE_LENGTH'
    });
    return this.report(id);
  }

  convolution(aValues: unknown, bValues: unknown, explanationLimit = this.limits.maxExplanations) {
    if (!Number.isInteger(explanationLimit) || explanationLimit < 0 || explanationLimit > this.limits.maxExplanations) {
      throw new ValidationError('INVALID_EXPLANATION_LIMIT', '解释条数上限非法。', { explanationLimit });
    }
    const a = parseIntegerArray(aValues, this.limits, 'a');
    const b = parseIntegerArray(bValues, this.limits, 'b');
    assertSameLength(a, b);
    const result = xorConvolve(a, b);
    const explanation = {
      transformedA: result.transformedA,
      transformedB: result.transformedB,
      contributionsByIndex: {} as Record<string, unknown>
    };
    if (explanationLimit > 0) {
      explanation.contributionsByIndex['0'] = contributionsAt(a, b, 0, explanationLimit);
    }
    const id = this.store.saveCompleted({
      operation: 'convolution',
      inputA: a,
      inputB: b,
      result: result.coefficients,
      explanation,
      scaling: 'FORWARD_POINTWISE_INVERSE'
    });
    return this.report(id);
  }

  report(id: number) {
    const row = this.store.get(id);
    return {
      id: row.id,
      operation: row.operation,
      status: row.status,
      length: row.length,
      bitWidth: row.bit_width,
      coefficientOrder: row.coefficient_order,
      scaling: row.scaling,
      algorithmVersion: row.algorithm_version,
      inputs: {
        a: JSON.parse(row.input_a) as string[],
        b: row.input_b ? (JSON.parse(row.input_b) as string[]) : null
      },
      result: row.result ? (JSON.parse(row.result) as unknown[]) : null,
      layers: row.layers ? (JSON.parse(row.layers) as unknown[]) : null,
      explanation: row.explanation ? JSON.parse(row.explanation) : null,
      error:
        row.status === 'failed'
          ? { code: row.error_code, message: row.error_message }
          : null,
      createdAt: row.created_at
    };
  }

  layer(id: number, layer?: number) {
    const report = this.report(id);
    if (!Array.isArray(report.layers)) {
      throw new ValidationError('LAYERS_NOT_STORED', '该分析没有保存蝶形层。');
    }
    if (layer === undefined) {
      return { id, layers: report.layers };
    }
    if (!Number.isInteger(layer) || layer < 0 || layer >= report.bitWidth) {
      throw new ValidationError('INVALID_LAYER', '蝶形层编号超出范围。', { layer, bitWidth: report.bitWidth });
    }
    return { id, layer: report.layers[layer] };
  }

  contribution(id: number, index: unknown, limit = this.limits.maxExplanations) {
    const report = this.report(id);
    if (report.operation !== 'convolution' || !report.inputs.b) {
      throw new ValidationError('NOT_A_CONVOLUTION', '只有异或卷积分析可查询乘积贡献。');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > this.limits.maxExplanations) {
      throw new ValidationError('INVALID_EXPLANATION_LIMIT', '解释条数上限非法。', { limit });
    }
    const k = assertIndex(index, report.length);
    const a = parseIntegerArray(report.inputs.a, this.limits);
    const b = parseIntegerArray(report.inputs.b, this.limits);
    return { id, index: k, ...contributionsAt(a, b, k, limit) };
  }
}

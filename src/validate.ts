import { ApiError } from "./errors";
import { isPowerOfTwo } from "./fwht";
import { Limits } from "./config";

const INT_RE = /^-?\d+$/;

export function parseIntegerText(x: unknown, limits: Limits, where: string): bigint {
  if (typeof x !== "string" || !INT_RE.test(x)) {
    throw new ApiError("E_INVALID_INTEGER", `${where}: 非法整数文本（需为十进制字符串）: ${JSON.stringify(x)}`);
  }
  const digits = x.replace(/^-/, "").replace(/^0+(?=\d)/, "");
  if (digits.length > limits.maxIntegerDigits) {
    throw new ApiError("E_LIMIT_EXCEEDED", `${where}: 整数位数超过上限 ${limits.maxIntegerDigits}`);
  }
  return BigInt(x);
}

export function parseArray(x: unknown, limits: Limits, name: string): bigint[] {
  if (!Array.isArray(x)) {
    throw new ApiError("E_BAD_PARAM", `${name} 必须是十进制字符串数组`);
  }
  if (x.length === 0) {
    throw new ApiError("E_EMPTY_ARRAY", `${name} 不能为空数组`);
  }
  if (!isPowerOfTwo(x.length)) {
    throw new ApiError("E_LENGTH_NOT_POWER_OF_TWO", `${name} 长度 ${x.length} 不是 2 的非负整数次幂`);
  }
  if (x.length > limits.maxLength) {
    throw new ApiError("E_LIMIT_EXCEEDED", `${name} 长度超过上限 ${limits.maxLength}`);
  }
  return x.map((v, idx) => parseIntegerText(v, limits, `${name}[${idx}]`));
}

export function parseOp(x: unknown): "forward" | "inverse" | "convolve" {
  if (x === "forward" || x === "inverse" || x === "convolve") return x;
  throw new ApiError("E_BAD_OP", `未知算子: ${JSON.stringify(x)}，支持 forward | inverse | convolve`);
}

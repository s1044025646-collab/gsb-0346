export interface Limits {
  maxLength: number;      // 输入数组最大长度（元素个数）
  maxIntegerDigits: number; // 单个整数十进制文本最大位数
  maxExplainSteps: number;  // 单次返回的蝶形步骤解释条数上限
  port: number;             // 0 表示自动选择空闲端口
  dataDir: string;
}

function intFromEnv(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`invalid env ${name}: ${v}`);
  }
  return n;
}

import * as path from "path";

export function loadLimits(): Limits {
  return {
    maxLength: intFromEnv("FWHT_MAX_LENGTH", 1 << 16),
    maxIntegerDigits: intFromEnv("FWHT_MAX_INTEGER_DIGITS", 1000),
    maxExplainSteps: intFromEnv("FWHT_MAX_EXPLAIN_STEPS", 200),
    port: intFromEnv("PORT", 0),
    dataDir: process.env.FWHT_DATA_DIR || path.join(process.cwd(), "data"),
  };
}

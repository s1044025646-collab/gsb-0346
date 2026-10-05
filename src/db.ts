// SQLite 持久化（node:sqlite 内置模块，零外部依赖）。
// 冻结：原始数组、算子类型、下标顺序（natural binary）、算法版本、精确系数、结果与步骤摘要。
// 结果与完成状态在同一事务中原子写入；失败只写入 failed 状态行，不发布半个数组。
import { DatabaseSync } from "node:sqlite";
import * as path from "path";
import * as fs from "fs";

export const ALGO_VERSION = "fwht-natural-unnormalized-v1";
export const INDEX_ORDER = "natural-binary";

export interface AnalysisRow {
  id: number;
  created_at: string;
  op: string;
  index_order: string;
  algo_version: string;
  bit_width: number;
  status: string; // done | failed
  input_a: string; // JSON string[]
  input_b: string | null;
  result: string | null;   // JSON
  steps_a: string | null;  // JSON 蝶形步骤（完整保存）
  steps_b: string | null;
  error: string | null;
}

export class Store {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "fwht.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        op TEXT NOT NULL,
        index_order TEXT NOT NULL,
        algo_version TEXT NOT NULL,
        bit_width INTEGER NOT NULL,
        status TEXT NOT NULL,
        input_a TEXT NOT NULL,
        input_b TEXT,
        result TEXT,
        steps_a TEXT,
        steps_b TEXT,
        error TEXT
      );
    `);
  }

  // 原子保存：单行 INSERT 即一个事务单元，结果与状态同时落库。
  saveCompleted(entry: Omit<AnalysisRow, "id" | "created_at">): number {
    const stmt = this.db.prepare(`
      INSERT INTO analyses (created_at, op, index_order, algo_version, bit_width, status, input_a, input_b, result, steps_a, steps_b, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      new Date().toISOString(), entry.op, entry.index_order, entry.algo_version,
      entry.bit_width, entry.status, entry.input_a, entry.input_b,
      entry.result, entry.steps_a, entry.steps_b, entry.error,
    );
    return Number(info.lastInsertRowid);
  }

  get(id: number): AnalysisRow | null {
    const stmt = this.db.prepare("SELECT * FROM analyses WHERE id = ?");
    return (stmt.get(id) as AnalysisRow | undefined) ?? null;
  }

  list(limit = 50): AnalysisRow[] {
    const stmt = this.db.prepare("SELECT id, created_at, op, index_order, algo_version, bit_width, status, input_a, input_b, result, steps_a, steps_b, error FROM analyses ORDER BY id DESC LIMIT ?");
    return stmt.all(limit) as unknown as AnalysisRow[];
  }

  close(): void { this.db.close(); }
}

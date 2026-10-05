import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ButterflyLayerView, Rational } from '../core/types.js';
import { bitWidthOf } from '../core/validate.js';

export type Operation = 'import' | 'forward' | 'inverse' | 'convolution';
export type AnalysisStatus = 'completed' | 'failed';

export interface Analysis {
  id: number;
  operation: Operation;
  status: AnalysisStatus;
  input_a: string;
  input_b: string | null;
  length: number;
  bit_width: number;
  coefficient_order: 'NATURAL_BINARY';
  scaling: string;
  algorithm_version: 'fwht-natural-butterfly/v1';
  result: string | null;
  layers: string | null;
  explanation: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export interface SaveAnalysisInput {
  operation: Operation;
  inputA: bigint[];
  inputB?: bigint[];
  result?: Array<string | Rational> | bigint[];
  layers?: ButterflyLayerView[];
  explanation?: unknown;
  scaling: string;
}

function toJson(values: unknown): string {
  return JSON.stringify(values, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
}

export class AnalysisStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation TEXT NOT NULL CHECK (operation IN ('import', 'forward', 'inverse', 'convolution')),
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        input_a TEXT NOT NULL,
        input_b TEXT,
        length INTEGER NOT NULL,
        bit_width INTEGER NOT NULL,
        coefficient_order TEXT NOT NULL,
        scaling TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        result TEXT,
        layers TEXT,
        explanation TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);
  }

  saveCompleted(input: SaveAnalysisInput): number {
    const save = this.db.transaction(() => {
      const result = this.db
        .prepare(`
          INSERT INTO analyses (
            operation, status, input_a, input_b, length, bit_width,
            coefficient_order, scaling, algorithm_version, result, layers, explanation
          ) VALUES (?, 'completed', ?, ?, ?, ?, 'NATURAL_BINARY', ?, 'fwht-natural-butterfly/v1', ?, ?, ?)
        `)
        .run(
          input.operation,
          toJson(input.inputA),
          input.inputB ? toJson(input.inputB) : null,
          input.inputA.length,
          bitWidthOf(input.inputA.length),
          input.scaling,
          input.result ? toJson(input.result) : null,
          input.layers ? toJson(input.layers) : null,
          input.explanation ? toJson(input.explanation) : null
        );
      return Number(result.lastInsertRowid);
    });
    return save();
  }

  saveFailure(input: {
    operation: Operation;
    inputA?: bigint[];
    inputB?: bigint[];
    errorCode: string;
    errorMessage: string;
  }): number {
    const frozen = input.inputA ?? [];
    const length = frozen.length && (frozen.length & (frozen.length - 1)) === 0 ? frozen.length : 0;
    const save = this.db.transaction(() => {
      const result = this.db
        .prepare(`
          INSERT INTO analyses (
            operation, status, input_a, input_b, length, bit_width,
            coefficient_order, scaling, algorithm_version, error_code, error_message
          ) VALUES (?, 'failed', ?, ?, ?, ?, 'NATURAL_BINARY', 'NOT_APPLICABLE', 'fwht-natural-butterfly/v1', ?, ?)
        `)
        .run(
          input.operation,
          toJson(frozen),
          input.inputB ? toJson(input.inputB) : null,
          length,
          length ? bitWidthOf(length) : 0,
          input.errorCode,
          input.errorMessage
        );
      return Number(result.lastInsertRowid);
    });
    return save();
  }

  get(id: number): Analysis {
    const row = this.db.prepare('SELECT * FROM analyses WHERE id = ?').get(id) as Analysis | undefined;
    if (!row) {
      throw new Error(`ANALYSIS_NOT_FOUND:${id}`);
    }
    return row;
  }
}

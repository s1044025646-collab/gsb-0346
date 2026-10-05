#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AnalysisStore } from './db/store.js';
import { DEFAULT_LIMITS } from './core/limits.js';
import { AnalysisService } from './services/analysisService.js';
import { forwardTransform, directXorConvolutionForTest, xorConvolve } from './core/fwht.js';
import { maskOf, parseIntegerArray } from './core/validate.js';

const [command, ...rawArgs] = process.argv.slice(2);
const dataDir = process.env.DATA_DIR ?? resolve(process.cwd(), 'data');
mkdirSync(dataDir, { recursive: true });
const store = new AnalysisStore(resolve(dataDir, 'walsh-hadamard.sqlite'));
const service = new AnalysisService(store, DEFAULT_LIMITS);

function parseJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}
function printCoefficients(report: { bitWidth: number; result: unknown }): void {
  const values = report.result as Array<string | { numerator: string; denominator: string }>;
  values.forEach((value, index) => {
    const text = typeof value === 'string' ? value : `${value.numerator}/${value.denominator}`;
    console.log(`${index.toString().padStart(4)}  ${maskOf(index, (report as { bitWidth: number }).bitWidth)}  ${text}`);
  });
}
function finish(): void {
  store.close();
}

try {
  if (command === 'import') {
    const report = service.importArray(parseJsonFile(rawArgs[0]));
    printCoefficients(report);
    console.error(`analysis=${report.id}`);
  } else if (command === 'forward' || command === 'inverse') {
    const report = command === 'forward' ? service.forward(parseJsonFile(rawArgs[0])) : service.inverse(parseJsonFile(rawArgs[0]));
    printCoefficients(report);
    console.error(`analysis=${report.id} order=NATURAL_BINARY scaling=${report.scaling}`);
  } else if (command === 'convolve') {
    const [aPath, bPath] = rawArgs;
    const report = service.convolution(parseJsonFile(aPath), parseJsonFile(bPath));
    printCoefficients(report);
    console.error(`analysis=${report.id} order=NATURAL_BINARY scaling=${report.scaling}`);
  } else if (command === 'report') {
    console.log(JSON.stringify(service.report(Number(rawArgs[0])), null, 2));
  } else if (command === 'layer') {
    console.log(JSON.stringify(service.layer(Number(rawArgs[0]), rawArgs[1] === undefined ? undefined : Number(rawArgs[1])), null, 2));
  } else if (command === 'contribution') {
    console.log(JSON.stringify(service.contribution(Number(rawArgs[0]), Number(rawArgs[1]), Number(rawArgs[2] ?? DEFAULT_LIMITS.maxExplanations)), null, 2));
  } else if (command === 'export') {
    const report = service.report(Number(rawArgs[0]));
    const output = rawArgs[1] ?? resolve(dataDir, `analysis-${report.id}.json`);
    writeFileSync(output, JSON.stringify(report, null, 2), 'utf8');
    console.error(output);
  } else if (command === 'demo') {
    const a = parseIntegerArray(['1', '2', '3', '4'], DEFAULT_LIMITS);
    const b = parseIntegerArray(['1', '-1', '0', '2'], DEFAULT_LIMITS);
    const fa = forwardTransform(a);
    const c = xorConvolve(a, b);
    console.log('手算示例 a=[1,2,3,4], b=[1,-1,0,2]');
    console.log('FWHT(a) =', fa.coefficients.join(', '));
    console.log('a XOR* b =', c.coefficients.join(', '));
    console.log('直接二重循环核对 =', directXorConvolutionForTest(a, b).join(', '));
    const pulseAt2 = parseIntegerArray(['0', '0', '1', '0'], DEFAULT_LIMITS);
    console.log('脉冲位于下标 2 时 b 的异或重排 =', xorConvolve(b, pulseAt2).coefficients.join(', '));
  } else {
    console.error('用法: fwht <import|forward|inverse|convolve|report|layer|contribution|export|demo> ...');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
} finally {
  finish();
}

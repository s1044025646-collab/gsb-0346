import { resolve } from 'node:path';
import { AnalysisStore } from '../db/store.js';
import { DEFAULT_LIMITS } from '../core/limits.js';
import { AnalysisService } from '../services/analysisService.js';
import { createHttpServer } from './http.js';

const port = Number(process.env.PORT ?? '0');
const dataDir = process.env.DATA_DIR ?? resolve(process.cwd(), 'data');
const store = new AnalysisStore(resolve(dataDir, 'walsh-hadamard.sqlite'));
const service = new AnalysisService(store, DEFAULT_LIMITS);
const server = createHttpServer(service);

server.listen(Number.isInteger(port) ? port : 0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('无法确定监听端口。');
  }
  console.log(JSON.stringify({ url: `http://127.0.0.1:${address.port}`, dataDir }, null, 2));
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => store.close()));
}

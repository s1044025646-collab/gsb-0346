import { createServer, type IncomingMessage, type Server } from 'node:http';
import { AnalysisService } from '../services/analysisService.js';
import { ValidationError } from '../core/errors.js';
import { DEFAULT_LIMITS } from '../core/limits.js';

async function readJson(request: IncomingMessage, maxBytes = 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      const error = new ValidationError('REQUEST_TOO_LARGE', '请求体超过 1 MiB 上限。');
      (error as Error & { statusCode?: number }).statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new ValidationError('INVALID_JSON', '请求体不是合法 JSON。');
  }
}

function send(response: Parameters<Parameters<Server['on']>[1]>[1], status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  });
  response.end(payload);
}

function query(pathname: string, name: string): string | undefined {
  const value = new URL(pathname, 'http://local').searchParams.get(name);
  return value ?? undefined;
}

export function createHttpServer(service: AnalysisService): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://local');
      const path = url.pathname;
      if (request.method === 'GET' && path === '/health') {
        send(response, 200, { ok: true });
        return;
      }

      if (request.method === 'POST' && path === '/api/arrays') {
        const body = (await readJson(request)) as { values?: unknown };
        send(response, 201, service.importArray(body.values));
        return;
      }
      if (request.method === 'POST' && path === '/api/transforms/forward') {
        const body = (await readJson(request)) as { a?: unknown; values?: unknown };
        send(response, 201, service.forward(body.a ?? body.values));
        return;
      }
      if (request.method === 'POST' && path === '/api/transforms/inverse') {
        const body = (await readJson(request)) as { a?: unknown; values?: unknown };
        send(response, 201, service.inverse(body.a ?? body.values));
        return;
      }
      if (request.method === 'POST' && path === '/api/convolutions') {
        const body = (await readJson(request)) as { a?: unknown; b?: unknown; explanationLimit?: number };
        send(response, 201, service.convolution(body.a, body.b, body.explanationLimit));
        return;
      }

      const analysisMatch = /^\/api\/analyses\/(\d+)(?:\/(layer|contributions|export))?$/.exec(path);
      if (request.method === 'GET' && analysisMatch) {
        const id = Number(analysisMatch[1]);
        const subresource = analysisMatch[2];
        if (subresource === 'layer') {
          send(response, 200, service.layer(id, query(path, 'layer') === undefined ? undefined : Number(query(path, 'layer'))));
        } else if (subresource === 'contributions') {
          send(response, 200, service.contribution(id, query(path, 'index'), Number(query(path, 'limit') ?? DEFAULT_LIMITS.maxExplanations)));
        } else {
          send(response, 200, service.report(id));
        }
        return;
      }

      send(response, 404, { error: { code: 'ROUTE_NOT_FOUND', message: '接口不存在。' } });
    } catch (error) {
      if (error instanceof ValidationError) {
        send(response, error.message.includes('1 MiB') ? 413 : 400, {
          error: { code: error.code, message: error.message, details: error.details }
        });
        return;
      }
      if (error instanceof Error && error.message.startsWith('ANALYSIS_NOT_FOUND')) {
        send(response, 404, { error: { code: 'ANALYSIS_NOT_FOUND', message: '分析不存在。' } });
        return;
      }
      send(response, 500, { error: { code: 'INTERNAL_ERROR', message: '内部错误。' } });
    }
  });
}

import * as http from "http";
import { loadLimits } from "./config";
import { Store } from "./db";
import { ApiError } from "./errors";
import { runAnalysis, getAnalysis, getReport, getLayers, getTerm } from "./analysis";

function sendJson(res: http.ServerResponse, status: number, obj: unknown) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 64 * 1024 * 1024) reject(new ApiError("E_LIMIT_EXCEEDED", "请求体过大"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function createServer(store: Store, limits: ReturnType<typeof loadLimits>) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);

      if (req.method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, { ok: true, limits });
      }
      if (req.method === "POST" && url.pathname === "/api/analyses") {
        const raw = await readBody(req);
        let body: any;
        try { body = JSON.parse(raw); } catch { throw new ApiError("E_INVALID_JSON", "请求体不是合法 JSON"); }
        return sendJson(res, 201, runAnalysis(store, limits, body));
      }
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "analyses" && parts.length === 2) {
        return sendJson(res, 200, store.list().map((r) => ({
          id: r.id, createdAt: r.created_at, op: r.op, status: r.status, bitWidth: r.bit_width,
        })));
      }
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "analyses" && parts[2]) {
        const id = Number(parts[2]);
        if (!Number.isInteger(id)) throw new ApiError("E_BAD_PARAM", "id 非法");
        const sub = parts[3];
        if (!sub) return sendJson(res, 200, getAnalysis(store, id));
        if (sub === "report") return sendJson(res, 200, getReport(store, id));
        if (sub === "layers") {
          const which = (url.searchParams.get("which") ?? "a") as "a" | "b";
          if (which !== "a" && which !== "b") throw new ApiError("E_BAD_PARAM", "which 需为 a 或 b");
          const layer = url.searchParams.has("layer") ? Number(url.searchParams.get("layer")) : null;
          const offset = Number(url.searchParams.get("offset") ?? "0");
          const limit = Number(url.searchParams.get("limit") ?? String(limits.maxExplainSteps));
          return sendJson(res, 200, getLayers(store, limits, id, which, layer, offset, limit));
        }
        if (sub === "term") {
          const k = Number(url.searchParams.get("k"));
          return sendJson(res, 200, getTerm(store, limits, id, k));
        }
      }
      throw new ApiError("E_NOT_FOUND", `未知路由: ${req.method} ${url.pathname}`, 404);
    } catch (err) {
      if (err instanceof ApiError) {
        sendJson(res, err.status, { error: { code: err.code, message: err.message } });
      } else {
        sendJson(res, 500, { error: { code: "E_INTERNAL", message: String(err) } });
      }
    }
  });
}

if (require.main === module) {
  const limits = loadLimits();
  const store = new Store(limits.dataDir);
  const server = createServer(store, limits);
  server.listen(limits.port, () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : limits.port;
    console.log(`FWHT 服务已启动: http://localhost:${port}  数据目录: ${limits.dataDir}`);
  });
}

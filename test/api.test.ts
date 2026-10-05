import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Store } from "../src/db";
import { loadLimits } from "../src/config";
import { createServer } from "../src/server";
import { runAnalysis } from "../src/analysis";
import { AddressInfo } from "net";

let dir: string;
let store: Store;
let server: ReturnType<typeof createServer>;
let base: string;
const limits = { ...loadLimits(), maxExplainSteps: 3 };

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fwht-test-"));
  store = new Store(dir);
  server = createServer(store, limits);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  store.close();
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(dir, { recursive: true, force: true });
});

async function post(op: string, a: string[], b?: string[]) {
  const res = await fetch(`${base}/api/analyses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, a, b }),
  });
  return { status: res.status, body: await res.json() };
}

test("API 卷积并查询单项与蝶形层", async () => {
  const r = await post("convolve", ["1", "2", "3", "4"], ["5", "6", "7", "8"]);
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.result.coeffs, ["70", "68", "62", "60"]);
  assert.equal(r.body.bitWidth, 2);
  assert.match(r.body.scaling, /未归一化/);

  const term = await (await fetch(`${base}/api/analyses/${r.body.id}/term?k=3`)).json();
  assert.equal(term.value, "60");
  assert.equal(term.contributions.length, 3); // 受解释条数上限截断
  assert.equal(term.truncated, true);

  const layers = await (await fetch(`${base}/api/analyses/${r.body.id}/layers?which=a&layer=0`)).json();
  assert.equal(layers.total, 2);
  assert.equal(layers.steps[0].layer, 0);
  assert.ok("u" in layers.steps[0] && "sum" in layers.steps[0]);

  // 解释条数上限：最多 3 条
  const paged = await (await fetch(`${base}/api/analyses/${r.body.id}/layers?which=a&limit=100`)).json();
  assert.equal(paged.steps.length, 3);
  assert.equal(paged.total, 4);

  // 完整报告不受解释上限影响
  const report = await (await fetch(`${base}/api/analyses/${r.body.id}/report`)).json();
  assert.equal(report.stepsA.length, 4);
  assert.equal(report.stepsB.length, 4);
});

test("API 前向与逆变换（含非整除有理数）", async () => {
  const f = await post("forward", ["1", "2", "3", "4"]);
  assert.deepEqual(f.body.result.coeffs, ["10", "-2", "-4", "0"]);
  const inv = await post("inverse", ["1", "2", "3", "4"]);
  assert.equal(inv.body.result.exactIntegers, false);
  assert.deepEqual(inv.body.result.nonIntegerIndices, [0, 1]);
  assert.equal(inv.body.result.terms[0].rational, "5/2");
  assert.equal(inv.body.result.terms[2].rational, "-1");
});

test("非法参数被拒绝且不产生数据库行（回滚）", async () => {
  const before = store.list(1000).length;
  const bad1 = await post("forward", ["1", "2", "3"]); // 非 2 次幂
  assert.equal(bad1.status, 400);
  assert.equal(bad1.body.error.code, "E_LENGTH_NOT_POWER_OF_TWO");
  const bad2 = await post("forward", []);
  assert.equal(bad2.body.error.code, "E_EMPTY_ARRAY");
  const bad3 = await post("forward", ["1", "abc"]);
  assert.equal(bad3.body.error.code, "E_INVALID_INTEGER");
  const bad4 = await post("convolve", ["1", "2"], ["1", "2", "3", "4"]);
  assert.equal(bad4.body.error.code, "E_LENGTH_MISMATCH");
  const bad5 = await post("nope", ["1"]);
  assert.equal(bad5.body.error.code, "E_BAD_OP");
  assert.equal(store.list(1000).length, before);
});

test("重启后按原约定读取旧报告", async () => {
  const r = runAnalysis(store, limits, { op: "forward", a: ["1", "2", "3", "4"] });
  const store2 = new Store(dir); // 模拟重启后重新打开同一数据目录
  const row = store2.get(r.id)!;
  assert.equal(row.algo_version, "fwht-natural-unnormalized-v1");
  assert.equal(row.index_order, "natural-binary");
  assert.equal(row.status, "done");
  assert.deepEqual(JSON.parse(row.result!).coeffs, ["10", "-2", "-4", "0"]);
  store2.close();
});

test("大整数与长度 1 通过 API", async () => {
  const big = "9007199254740993";
  const r = await post("convolve", [big, big], [big, big]);
  assert.equal(r.body.result.coeffs[0], (2n * 9007199254740993n ** 2n).toString());
  assert.equal(r.body.result.coeffs[1], (2n * 9007199254740993n ** 2n).toString());
  const one = await post("forward", ["42"]);
  assert.deepEqual(one.body.result.coeffs, ["42"]);
});



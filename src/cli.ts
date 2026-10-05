// CLI：导入数组、前向/逆变换、异或卷积、查询单项来源、查看蝶形层、导出报告。
// 用法见 README.md。示例：
//   node dist/cli.js convolve --a 1,2,3,4 --b 5,6,7,8
//   node dist/cli.js layers --id 1 --which a --layer 0
//   node dist/cli.js term --id 1 --k 3
import { loadLimits } from "./config";
import { Store } from "./db";
import { runAnalysis, getAnalysis, getReport, getLayers, getTerm } from "./analysis";
import { ApiError } from "./errors";

function parseArgs(argv: string[]): { cmd: string; opts: Record<string, string> } {
  const [cmd = "help", ...rest] = argv;
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!key.startsWith("--")) throw new ApiError("E_BAD_PARAM", `非法参数: ${key}`);
    opts[key.slice(2)] = rest[i + 1] ?? "";
  }
  return { cmd, opts };
}

function toMaskTable(coeffs: string[], bitWidth: number): string {
  const lines = ["index  mask".padEnd(bitWidth + 10) + "value"];
  coeffs.forEach((v, i) => {
    const mask = i.toString(2).padStart(bitWidth, "0");
    lines.push(`${String(i).padEnd(6)} ${mask.padEnd(bitWidth + 4)}${v}`);
  });
  return lines.join("\n");
}

function printResult(r: any) {
  console.log(`分析 #${r.id}  op=${r.op}  顺序=${r.indexOrder}  版本=${r.algoVersion}  位宽=${r.bitWidth}`);
  console.log(`缩放约定: ${r.scaling}`);
  const res = r.result as any;
  if (res.coeffs) {
    console.log("系数表（按位掩码排列）:");
    console.log(toMaskTable(res.coeffs, r.bitWidth));
  } else if (res.terms) {
    console.log(`逆变换结果: exactIntegers=${res.exactIntegers} 非整除位置=[${res.nonIntegerIndices}]`);
    console.log(toMaskTable(res.terms.map((t: any) => t.rational), r.bitWidth));
  }
}

function main() {
  const limits = loadLimits();
  const store = new Store(limits.dataDir);
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  try {
    switch (cmd) {
      case "forward":
      case "inverse":
      case "convolve": {
        const body: any = { op: cmd, a: (opts.a ?? "").split(",").filter((s) => s !== "") };
        if (cmd === "convolve") body.b = (opts.b ?? "").split(",").filter((s) => s !== "");
        printResult(runAnalysis(store, limits, body));
        break;
      }
      case "list":
        for (const r of store.list()) console.log(`#${r.id}  ${r.created_at}  ${r.op}  ${r.status}  位宽=${r.bit_width}`);
        break;
      case "show":
        printResult({ ...getAnalysis(store, Number(opts.id)), scaling: "见 README" });
        break;
      case "report": {
        const rep = getReport(store, Number(opts.id));
        console.log(JSON.stringify(rep, null, 2));
        break;
      }
      case "layers": {
        const out = getLayers(store, limits, Number(opts.id),
          (opts.which ?? "a") as "a" | "b",
          opts.layer !== undefined ? Number(opts.layer) : null,
          Number(opts.offset ?? "0"), Number(opts.limit ?? String(limits.maxExplainSteps)));
        console.log(`共 ${out.total} 步，显示 ${out.steps.length} 步:`);
        for (const s of out.steps) {
          console.log(`层${s.layer} 跨度${s.span}  对(${s.i},${s.j}): 旧值 u=${s.u}, v=${s.v} -> 新值 u+v=${s.sum}, u-v=${s.diff}`);
        }
        break;
      }
      case "term": {
        const out = getTerm(store, limits, Number(opts.id), Number(opts.k));
        console.log(`${out.note} = ${out.value}`);
        for (const c of out.contributions) {
          console.log(`  i=${c.i} j=${c.j}: a[${c.i}]*b[${c.j}] = ${c.ai}*${c.bj} = ${c.product}`);
        }
        if (out.truncated) console.log(`  ...（仅显示前 ${limits.maxExplainSteps} 条）`);
        break;
      }
      default:
        console.log([
          "命令:",
          "  forward --a 1,2,3,4",
          "  inverse --a 10,-2,0,-4",
          "  convolve --a 1,2,3,4 --b 5,6,7,8",
          "  list | show --id N | report --id N",
          "  layers --id N [--which a|b] [--layer L] [--offset O] [--limit M]",
          "  term --id N --k K",
        ].join("\n"));
    }
  } finally {
    store.close();
  }
}

try {
  main();
} catch (err) {
  if (err instanceof ApiError) {
    console.error(`错误 [${err.code}] ${err.message}`);
    process.exit(2);
  }
  throw err;
}

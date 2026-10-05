# Walsh–Hadamard 变换与异或卷积解释后端

纯本地运行的后端服务（仅 API 与 CLI），使用 TypeScript + Node.js + SQLite（`node:sqlite` 内置模块，零运行时依赖）。实现整数数组的 Walsh–Hadamard 变换（FWHT）与异或卷积，并提供蝶形层解释、单项来源查询与报告导出。

## 数学约定

- **下标顺序**：自然二进制顺序（natural binary），下标即固定宽度位掩码；**不是** sequency 排序。
- **前向变换**：未归一化。矩阵满足 `H · H = n · I`，即 `forward(forward(a)) = n · a`。
- **逆变换**：相同蝶形后每项除以 `n`。对任意外部系数结果可能不是整数，此时返回**约分后的有理数**（`num`/`den`）并明确标记非整除位置 `nonIntegerIndices`，绝不直接整数除法丢余数。
- **蝶形**：每层每对旧值 `u, v` → `u+v, u-v`，配对跨度逐层 1, 2, 4, … 扩大；层内先取旧值再写回，不会读到已覆盖的项。
- **异或卷积**：`c[k] = Σ_{i XOR j = k} a[i]·b[j]`，通过两次前向变换、逐项相乘、一次逆变换得到（非二重循环）。整数输入的卷积结果必为精确整数。
- **精度**：输入/输出均为十进制字符串，内部全程 `BigInt`，不经过 `Number` 或 32 位截断。

## 环境要求

- Windows 本地，Node.js ≥ 22.5（推荐 ≥ 23，内置 `node:sqlite`；开发环境为 Node 25）。
- 不需要 Docker / WSL / 外部服务 / 网络（`npm install` 仅安装 TypeScript 开发依赖）。

## 快速开始

```powershell
npm install      # 安装 TypeScript（仅开发依赖）
npm run build    # 编译到 dist/ 与 dist-test/
npm test         # 构建并运行全部测试
npm run demo     # 长度 4 手算示例 + 单位脉冲性质演示
npm start        # 启动 HTTP 服务（默认自动选择空闲端口）
npm run cli -- convolve --a 1,2,3,4 --b 5,6,7,8
```

## 配置（环境变量）

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `PORT` | `0`（自动选空闲端口） | HTTP 监听端口 |
| `FWHT_DATA_DIR` | `./data` | SQLite 数据目录（项目内） |
| `FWHT_MAX_LENGTH` | `65536` | 输入数组最大长度 |
| `FWHT_MAX_INTEGER_DIGITS` | `1000` | 单个整数十进制位数上限 |
| `FWHT_MAX_EXPLAIN_STEPS` | `200` | 单次返回的解释条数上限（仅限制展示，蝶形计算与保存始终完整） |

## HTTP API

统一错误格式：`{ "error": { "code": "...", "message": "..." } }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查与当前限制 |
| POST | `/api/analyses` | 新建分析，body：`{"op":"forward"|"inverse"|"convolve","a":["1","2"],"b":[...]}` |
| GET | `/api/analyses` | 列出全部分析 |
| GET | `/api/analyses/:id` | 查询分析（含冻结的输入、约定、结果） |
| GET | `/api/analyses/:id/report` | 导出完整报告（含全部蝶形步骤，不受解释上限影响） |
| GET | `/api/analyses/:id/layers?which=a&layer=0&offset=0&limit=50` | 查看蝶形层（分页；每步含旧值 u/v 与新值 u+v/u−v） |
| GET | `/api/analyses/:id/term?k=3` | 查询卷积第 k 项的全部乘积贡献 `a[i]·b[j]`（i XOR j = k） |

### 错误码

`E_INVALID_INTEGER`（非法整数文本）、`E_INVALID_JSON`、`E_EMPTY_ARRAY`、`E_LENGTH_NOT_POWER_OF_TWO`、`E_LENGTH_MISMATCH`（卷积不等长）、`E_LIMIT_EXCEEDED`、`E_BAD_OP`、`E_BAD_PARAM`、`E_NOT_FOUND`、`E_INTERNAL`。长度 1 合法（2⁰）。

## CLI

```powershell
node dist/cli.js forward  --a 1,2,3,4            # 前向变换，输出按位掩码排列的系数表
node dist/cli.js inverse  --a 10,-2,-4,0         # 逆变换（非整除时显示约分有理数）
node dist/cli.js convolve --a 1,2,3,4 --b 5,6,7,8
node dist/cli.js list                           # 列出全部分析
node dist/cli.js show    --id 1                 # 查看某次分析
node dist/cli.js report  --id 1                 # 导出完整 JSON 报告
node dist/cli.js layers  --id 1 --which a --layer 0   # 查看局部蝶形
node dist/cli.js term    --id 1 --k 3           # 卷积第 3 项的贡献明细
```

## 持久化与原子性

- SQLite 表 `analyses` 冻结：原始数组、算子类型、下标顺序（`natural-binary`）、算法版本（`fwht-natural-unnormalized-v1`）、位宽、精确系数、结果与完整蝶形步骤。
- 结果与完成状态在同一行 INSERT 中原子落库；参数校验失败不产生任何行（非法参数回滚），不会发布半个数组。
- 输入修改即新建分析（新 id）；旧报告重启后仍按冻结的约定解释。
- 解释接口可分页/按层过滤，但完整结果与全部步骤始终可经 `report` 导出。

## 手算示例（长度 4）

`a = [1,2,3,4]`：

- 层 0（跨度 1）：(1,2)→(3,−1)，(3,4)→(7,−1) → `[3,−1,7,−1]`
- 层 1（跨度 2）：(3,7)→(10,−4)，(−1,−1)→(−2,0) → `W(a) = [10,−2,−4,0]`

`a=[1,2,3,4], b=[5,6,7,8]` 的异或卷积：`c = [70, 68, 62, 60]`（如 `c[3] = 1·8+2·7+3·6+4·5 = 60`）。

单位脉冲：脉冲在 0 时 `c = b`；脉冲在下标 m 时 `c[k] = b[k XOR m]`（按异或重排）。

## 测试

`npm test` 覆盖：长度 4 手算值、蝶形步骤重放核对、独立 Hadamard 符号矩阵核对、二重循环核对小卷积（仅测试用）、两次变换缩放关系、交换律、负数/全零/长度 1、超过 `Number.MAX_SAFE_INTEGER` 的大整数、非整除逆变换的有理数输出、非法参数回滚、重启后读取旧报告、解释分页上限。

## 限制

- 仅处理有限整数数组的一维异或卷积；不做音频频谱、量子线路、普通加法卷积或图像压缩。
- 步骤记录随 `n·log n` 增长，超大数组的报告体积相应增大（可用 `FWHT_MAX_LENGTH` 限制）。
- `node:sqlite` 在 Node 25 仍标记为实验特性，启动时会打印 ExperimentalWarning，不影响功能。

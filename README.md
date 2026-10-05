# Walsh–Hadamard 变换与异或卷积后端

这是一个只包含 API 与 CLI 的 Windows 本地 TypeScript/Node.js/SQLite 后端。它处理有限整数数组，不包含网页、Docker、WSL、音频、图像、量子线路或外部数学服务。

## 数学约定

- 数组长度必须是 `2^n`，长度 `1` 合法；下标解释为固定 `n` 位自然二进制掩码。
- 系数顺序固定为自然二进制下标顺序（Natural Binary Order），不是 sequency/Gray-code 顺序。
- 前向变换未归一化：蝶形每一层对旧值 `u,v` 同时计算 `u+v,u-v`。
- 同一层读取旧数组语义，配对跨度依次为 `1,2,4,...,n/2`。
- 未归一化矩阵 `H` 满足 `H(H(a)) = length * a`。
- 逆变换执行同样蝶形，然后每一项除以长度。
- 异或卷积：`inverse(forward(a) .* forward(b))`。
- 输入与整数结果都以十进制字符串传输；内部使用 `BigInt`，不经过 `Number` 或 32 位有符号整数。
- 外部任意系数的逆变换可能非整除，返回约分分数 `{numerator,denominator}`，不做丢余数的整数除法。

长度四示例：

```text
a = [1,2,3,4]
span 1: [3,-1,7,-1]
span 2: [10,-4,2,-2]
span 4: [10,-2,-4,0]
```

所以 `FWHT([1,2,3,4]) = [10,-2,-4,0]`。

取 `b=[1,-1,0,2]`，快速异或卷积结果为：

```text
a XOR* b = [7,7,3,3]
```

例如第 `0` 项是 `1*1 + 2*(-1) + 3*0 + 4*2 = 7`。单位脉冲在零下标时保持另一数组；长度四时脉冲位于下标 `2`，数组按 `i XOR 2` 重排。

## 环境与构建

要求 Node.js 22+（当前开发环境为 Node.js 25.5.0）。

```powershell
npm install
npm run build
npm test
npm start
```

默认端口传 `0`，操作系统选择本机空闲端口，监听 `127.0.0.1`。启动后控制台输出实际 URL。固定端口：

```powershell
$env:PORT="3000"; npm start
```

SQLite 数据库默认在项目内 `data/walsh-hadamard.sqlite`。可通过 `DATA_DIR` 修改：

```powershell
$env:DATA_DIR="E:\GSB\0346\B\data"; npm start
```

## HTTP API

所有请求和响应均为 JSON。

### 导入数组

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:<port>/api/arrays `
  -ContentType 'application/json' `
  -Body '{"values":["1","2","3","4"]}'
```

### 前向变换

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:<port>/api/transforms/forward `
  -ContentType 'application/json' `
  -Body '{"a":["1","2","3","4"]}'
```

### 逆变换

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:<port>/api/transforms/inverse `
  -ContentType 'application/json' `
  -Body '{"a":["1","0","0","0"]}'
```

### 异或卷积

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:<port>/api/convolutions `
  -ContentType 'application/json' `
  -Body '{"a":["1","2","3","4"],"b":["1","-1","0","2"],"explanationLimit":4}'
```

### 查询、层、贡献、导出

```text
GET /api/analyses/{id}
GET /api/analyses/{id}/layer?layer=0
GET /api/analyses/{id}/contributions?index=0&limit=4
GET /api/analyses/{id}/export
```

当前 `export` 返回完整报告 JSON。数据库中的分析不可变；修改输入会创建新分析。

## CLI

输入 JSON 文件应是十进制字符串数组，例如：

```json
["1","2","3","4"]
```

```powershell
npm run demo
npm run cli -- forward examples/a4.json
npm run cli -- inverse examples/coeff4.json
npm run cli -- convolve examples/a4.json examples/b4.json
npm run cli -- report 1
npm run cli -- layer 1 0
npm run cli -- contribution 2 0 4
npm run cli -- export 2 data\report-2.json
```

CLI 系数表按 `<十进制下标> <固定位宽掩码> <系数>` 展示。

## 校验与错误码

常见错误码：

- `INVALID_INTEGER_TEXT`：不是合法十进制整数。
- `EMPTY_ARRAY`：空数组。
- `LENGTH_NOT_POWER_OF_TWO`：长度不是二的非负整数次幂。
- `LENGTH_TOO_LARGE`：超过长度上限。
- `INTEGER_TOO_LARGE`：超过整数位数上限。
- `LENGTH_MISMATCH`：卷积数组不等长。
- `INVALID_INDEX`、`INVALID_LAYER`、`INVALID_EXPLANATION_LIMIT`：查询参数非法。
- `ANALYSIS_NOT_FOUND`：分析不存在。

默认上限：最大长度 `4096`、整数 `1000` 位、解释条数 `100`。这些上限只限制输入和解释输出，不会减少蝶形实际计算量。可在 `src/core/limits.ts` 调整。

## 持久化

SQLite 表冻结：

- 原始数组（卷积包含两个输入）；
- 算子类型、完成状态；
- 自然二进制顺序与未归一化/逆变换缩放约定；
- 算法版本 `fwht-natural-butterfly/v1`；
- 精确系数、完整结果、步骤层与解释摘要；
- 创建时间和失败信息字段。

完成分析在事务中插入；失败时不会发布结果或半个数组。

## 测试范围

`npm test` 使用 Vitest，覆盖：

- 长度四手算结果和独立符号矩阵；
- 两次变换的长度缩放关系；
- 快速异或卷积与测试专用二重循环；
- 卷积交换律、负数、全零、长度一、超大整数；
- 单位脉冲保持与异或重排；
- 任意外部系数的非整除有理逆变换；
- SQLite 重启读取、版本/顺序/缩放冻结与非法参数场景。

## 范围限制

本项目只做后端计算和报告，不提供图形页面、不做大型性能压测、不连接在线 API。当前解释层默认完整保存；超长数组的主要限制是存储和 JSON 报告体积，而不是算法少做计算。

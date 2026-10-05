// 演示：长度 4 小整数数组的手算可核对变换与卷积，以及单位脉冲的异或重排性质。
import { fwhtForward, fwhtInverse, xorConvolve } from "./fwht";

function show(name: string, a: bigint[]) {
  const f = fwhtForward(a);
  console.log(`${name}: a = [${a.join(", ")}]  ->  W(a) = [${f.coeffs.join(", ")}]`);
}

console.log("== 长度 4 前向变换（未归一化，自然二进制顺序） ==");
show("示例", [1n, 2n, 3n, 4n]); // 手算: [10, -2, -4, 0]

console.log("\n== 逆变换恢复（除以 n=4） ==");
const inv = fwhtInverse(fwhtForward([1n, 2n, 3n, 4n]).coeffs);
console.log(`inverse(forward([1,2,3,4])) = [${inv.terms.map((t) => t.num).join(", ")}] exact=${inv.exactIntegers}`);

console.log("\n== 异或卷积 a=[1,2,3,4], b=[5,6,7,8] ==");
const c = xorConvolve([1n, 2n, 3n, 4n], [5n, 6n, 7n, 8n]);
console.log(`c = [${c.coeffs.join(", ")}]`);
// 手算核对: c[k] = sum_{i^j=k} a[i]b[j]
// c[0]=1*5+2*6+3*7+4*8=70; c[1]=1*6+2*5+3*8+4*7=68;
// c[2]=1*7+2*8+3*5+4*6=62; c[3]=1*8+2*7+3*6+4*5=60

console.log("\n== 单位脉冲性质 ==");
const b = [11n, 22n, 33n, 44n];
const e0 = xorConvolve([1n, 0n, 0n, 0n], b);
console.log(`脉冲在 0: c = [${e0.coeffs.join(", ")}]  （保持 b 不变）`);
const e2 = xorConvolve([0n, 0n, 1n, 0n], b);
console.log(`脉冲在 2: c = [${e2.coeffs.join(", ")}]  （b 按下标 XOR 2 重排）`);

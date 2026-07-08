/**
 * 前端产物混淆脚本（post-build）
 * 用法：node scripts/obfuscate.js
 * 作用：对 client/dist/assets 下的业务 JS chunk 做混淆，
 *       跳过第三方 vendor（element-plus，1MB+，混淆收益低且拖慢）。
 */
const fs = require('fs');
const path = require('path');
const JsObf = require('javascript-obfuscator');

const ASSETS = path.join(__dirname, '..', 'client', 'dist', 'assets');
// 跳过的第三方大块（前缀匹配）——开源框架混淆无 IP 价值，徒增体积与风险
const SKIP_PREFIX = ['element-plus', 'vue-core'];

// 混淆配置：以「字符串数组加密」为 IP 保护主力，
// 关闭会破坏运行时的激进变换（transformObjectKeys / selfDefending /
// controlFlowFlattening / deadCodeInjection）——它们曾导致 Preview 等
// 复杂业务页在生产环境渲染时抛异常白屏（dev 不混淆无此问题）。
// 核心 Prompt IP 已由后端 bytenode 字节码保护，前端混淆为辅助层，
// 安全性与可运行性权衡下，保留字符串加密 + 标识符重命名即可。
const OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  splitStrings: true,
  splitStringsChunkLength: 10,
  identifierNamesGenerator: 'hexadecimal',
  selfDefending: false,
  disableConsoleOutput: false,
  numbersToExpressions: true,
  simplify: true,
  transformObjectKeys: false,
};

function shouldSkip(name) {
  return SKIP_PREFIX.some((p) => name.startsWith(p));
}

function main() {
  if (!fs.existsSync(ASSETS)) {
    console.error('[obfuscate] 找不到 assets 目录，请先 npm run build:', ASSETS);
    process.exit(1);
  }
  const files = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.js'));
  let done = 0, skipped = 0;
  for (const f of files) {
    if (shouldSkip(f)) { skipped++; console.log(`  SKIP  ${f}`); continue; }
    const fp = path.join(ASSETS, f);
    const code = fs.readFileSync(fp, 'utf-8');
    const before = code.length;
    const result = JsObf.obfuscate(code, OPTIONS).getObfuscatedCode();
    fs.writeFileSync(fp, result, 'utf-8');
    done++;
    console.log(`  OBF   ${f}  ${before} -> ${result.length} bytes`);
  }
  console.log(`[obfuscate] 完成：混淆 ${done} 个，跳过 ${skipped} 个第三方块`);
}

main();

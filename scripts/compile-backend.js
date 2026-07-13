/**
 * 后端字节码编译脚本（打包专用，不改动 server/ 源码目录）
 * 用法（必须用目标 Electron 内置 Node 执行，jsc 版本与运行时绑定）：
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/compile-backend.js
 *
 * 产物：dist-server-jsc/  —— server 的字节码版本，供 electron-builder 打包
 * 策略：
 *   1. 复制 server/ -> dist-server-jsc/（排除备份/test/sqlite/uploads/logs）
 *   2. 业务 .js 全部编译成 .jsc 并删除源 .js（无扩展名 require 自动解析到 .jsc）
 *   3. 入口 app.js 特殊处理：编成 app.jsc + 生成明文 app.js bootstrap
 *      （顶部 require('bytenode') 注册加载器，再 require('./app.jsc')）
 *   4. 依赖原样复制到 vendor/（避免打包器对额外资源中 node_modules 的默认排除）
 */
const fs = require('fs');
const path = require('path');
// bytenode 装在 server/node_modules（后端自包含），从那里加载
const bytenode = require(path.join(__dirname, '..', 'server', 'node_modules', 'bytenode'));

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'server');
const OUT = path.join(ROOT, 'dist-server-jsc');

// 不编译/不复制的目录与文件（相对 server/）
const EXCLUDE_DIRS = new Set(['node_modules', 'test', 'uploads', 'logs']);
const EXCLUDE_NAME_RE = /(_backup_|\.sqlite$|\.sqlite\.tmp$|settings\.json$|\.jsc$)/;
// 编译为 jsc 但保留明文 bootstrap 的入口文件
const ENTRY = 'app.js';

// 递归复制目录（跳过排除项）
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.isDirectory() && EXCLUDE_DIRS.has(e.name)) continue;
    if (EXCLUDE_NAME_RE.test(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// 递归收集所有 .js 文件（OUT 内，含 node_modules 之外）
function collectJs(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && (e.name === 'node_modules' || e.name === 'vendor')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectJs(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

function main() {
  // 1. 清理 + 复制
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
  copyDir(SRC, OUT);
  // 依赖必须带上（依赖不编译）。electron-builder 会默认过滤
  // extraResources 中名为 node_modules 的目录，因此改用 vendor/ 并由桌面主进程注入 NODE_PATH。
  const nmSrc = path.join(SRC, 'node_modules');
  if (fs.existsSync(nmSrc)) {
    console.log('[compile] 复制后端运行时依赖到 vendor/...');
    copyDirRaw(nmSrc, path.join(OUT, 'vendor'));
  }

  // 2. 编译所有业务 .js -> .jsc，删除源 .js
  const jsFiles = collectJs(OUT, []);
  let compiled = 0, entryHandled = false;
  for (const fp of jsFiles) {
    const rel = path.relative(OUT, fp);
    const out = fp.slice(0, -3) + '.jsc';
    try {
      bytenode.compileFile({ filename: fp, output: out });
      fs.unlinkSync(fp);
      compiled++;
      // 入口：生成明文 bootstrap
      if (rel === ENTRY) {
        fs.writeFileSync(fp,
          "require('./vendor/bytenode');\nmodule.exports = require('./app.jsc');\n", 'utf-8');
        entryHandled = true;
      }
    } catch (e) {
      console.error(`[compile] 编译失败 ${rel}: ${e.message}`);
      process.exit(1);
    }
  }
  // bytenode 必须在产物 vendor 里可被入口 bootstrap 直接加载。
  const hasBytenode = fs.existsSync(path.join(OUT, 'vendor', 'bytenode'));
  console.log(`[compile] 完成：编译 ${compiled} 个 .js -> .jsc`);
  console.log(`[compile] 入口 bootstrap 已生成: ${entryHandled}`);
  console.log(`[compile] bytenode 依赖就位: ${hasBytenode}`);
  console.log(`[compile] 产物目录: ${OUT}`);
}

// 原样递归复制（用于 node_modules，不跳过任何东西）
function copyDirRaw(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDirRaw(s, d);
    else if (e.isSymbolicLink()) {
      try { fs.symlinkSync(fs.readlinkSync(s), d); } catch (_) { fs.copyFileSync(s, d); }
    } else fs.copyFileSync(s, d);
  }
}

main();

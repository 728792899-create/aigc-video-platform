import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const listed = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8' });
const ignoredSourceTrees = new Set([
  '.git',
  'node_modules',
  'client/node_modules',
  'server/node_modules',
  'client/dist',
  'dist-electron',
  'dist-server-jsc',
  'coverage',
]);

function listSourceFiles(directory = ROOT, relativeDirectory = '') {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (ignoredSourceTrees.has(relativePath) || ignoredSourceTrees.has(entry.name)) continue;
      result.push(...listSourceFiles(path.join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      result.push(relativePath);
    }
  }
  return result;
}

const files = listed.status === 0
  ? listed.stdout.split('\0').filter(Boolean)
  : listSourceFiles().sort();
if (listed.status !== 0) {
  console.warn('[security] 未检测到 Git 清单，已改用受限文件系统扫描。');
}
const forbiddenFiles = files.filter((name) =>
  /(^|\/)(uploads|logs)(\/|$)/.test(name) ||
  /\.(sqlite|sqlite3|db|pfx|pem|key|dmg|exe|msi|log)$/i.test(name) ||
  /(^|\/)settings\.json$/i.test(name)
);
const findings = forbiddenFiles.map((name) => `禁止跟踪运行时/密钥文件：${name}`);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-(?!test-|smoke-|fake-)[A-Za-z0-9_-]{16,}\b/,
  /(?:apiKey|secretKey|accessKey|token|password)\s*[:=]\s*['"][^'"]{12,}['"]/i,
];
for (const name of files) {
  if (/^(?:package-lock\.json|client\/package-lock\.json|server\/package-lock\.json|CHANGELOG_)/.test(name)) continue;
  if (/^(?:server\/test|docs\/screenshots)\//.test(name)) continue;
  const full = path.join(ROOT, name);
  let text;
  try {
    const bytes = fs.readFileSync(full);
    if (bytes.includes(0)) continue;
    text = bytes.toString('utf8');
  } catch { continue; }
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) findings.push(`疑似密钥：${name} (${pattern})`);
  }
}
if (findings.length) {
  findings.forEach((item) => console.error(`✗ ${item}`));
  process.exitCode = 1;
} else {
  console.log(`Security source scan passed: ${files.length} tracked and untracked source files`);
}

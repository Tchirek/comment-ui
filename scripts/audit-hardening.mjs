import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', '.vitepress', 'coverage']);
const checks = [
  { pattern: /\bas unknown as\b/, label: 'unsafe double assertion' },
  { pattern: /\bgetHighEntropyValues\s*\(/, label: 'high entropy UA fingerprinting' },
  { pattern: /\boperatingSystem\b/, label: 'comment OS tracking field' },
  { pattern: /\buser-agent-data-types\b/, label: 'high entropy UA type dependency' }
];
const findings = [];

function relative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

function shouldSkipFile(filePath) {
  const rel = relative(filePath);
  return rel === 'scripts/audit-hardening.mjs';
}

async function checkContent(filePath) {
  if (shouldSkipFile(filePath)) return;
  const info = await stat(filePath);
  if (info.size === 0 || info.size > 2 * 1024 * 1024) return;
  const buffer = await readFile(filePath);
  if (buffer.includes(0)) return;
  const text = buffer.toString('utf8');
  for (const check of checks) {
    if (check.pattern.test(text)) findings.push(`${relative(filePath)}: ${check.label}`);
  }
}

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) await walk(fullPath);
      continue;
    }
    if (entry.isFile()) await checkContent(fullPath);
  }
}

await walk(root);

if (findings.length > 0) {
  console.error(`Hardening audit failed for ${root}`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Hardening audit passed for ${root}`);
}

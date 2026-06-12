import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const self = path.resolve(fileURLToPath(import.meta.url));

const ignoredDirs = new Set([
  ".git",
  ".vitepress",
  "node_modules",
  "dist",
  "dev-dist",
  "coverage",
]);

const deniedNames = [
  /^\.env(?:\.(?!example$).*)?$/i,
  /^\.dev\.vars(?:\.(?!example$).*)?$/i,
  /^NUL$/i,
  /^DEVELOPER-HANDOFF/i,
  /\.log$/i,
];

const deniedPathParts = [
  /(^|[\\/])\.wrangler([\\/]|$)/i,
  /(^|[\\/])private([\\/]|$)/i,
];

const secretPatterns = [
  /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /\bCFPAT-[A-Za-z0-9_-]{20,}\b/i,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /\b(?:api|access|secret|token|password|passwd|private)[A-Z0-9_\-]*\s*[:=]\s*["'][A-Za-z0-9_./+=-]{20,}["']/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/,
];

const findings = [];

function relative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function checkPath(filePath) {
  const rel = relative(filePath);
  const name = path.basename(filePath);
  if (!isAllowedExampleName(name) && deniedNames.some((pattern) => pattern.test(name))) findings.push(`${rel}: denied file name`);
  if (deniedPathParts.some((pattern) => pattern.test(rel))) findings.push(`${rel}: denied path`);
}

function isAllowedExampleName(name) {
  return /^\.env(?:\..*)?\.example$/i.test(name)
    || /^\.dev\.vars(?:\..*)?\.example$/i.test(name);
}

async function checkContent(filePath) {
  if (path.resolve(filePath) === self) return;
  const info = await stat(filePath);
  if (info.size === 0 || info.size > 2 * 1024 * 1024) return;
  const buffer = await readFile(filePath);
  if (buffer.includes(0)) return;
  const text = buffer.toString("utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) findings.push(`${relative(filePath)}: possible secret`);
  }
}

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) await walk(fullPath);
      continue;
    }
    if (!entry.isFile()) continue;
    checkPath(fullPath);
    await checkContent(fullPath);
  }
}

await walk(root);

if (findings.length > 0) {
  console.error(`Public safety audit failed for ${root}`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Public safety audit passed for ${root}`);
}

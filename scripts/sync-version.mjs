import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const rawVersion = process.argv[2];

if (!rawVersion) {
  console.error("Usage: node scripts/sync-version.mjs <version>");
  process.exit(1);
}

const nextVersion = rawVersion.startsWith("v") ? rawVersion.slice(1) : rawVersion;
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!semverPattern.test(nextVersion)) {
  console.error(`Invalid version: ${rawVersion}`);
  process.exit(1);
}

const packageJsonPath = resolveFromRoot("package.json");
const packageJson = readJson(packageJsonPath);
const currentVersion = packageJson.version;

if (typeof currentVersion !== "string" || !currentVersion) {
  console.error("Could not read current version from package.json");
  process.exit(1);
}

updateJson("package.json", (json) => {
  json.version = nextVersion;
});

updateJson("package-lock.json", (json) => {
  json.version = nextVersion;
  if (json.packages?.[""]) {
    json.packages[""].version = nextVersion;
  }
});

updateText(
  "src-tauri/Cargo.toml",
  /(\[package\][\s\S]*?^version = ")([^"]+)(")/m,
  (_, before, _current, after) => `${before}${nextVersion}${after}`
);

updateText(
  "src-tauri/Cargo.lock",
  /(\[\[package\]\]\r?\nname = "tokenflow"\r?\nversion = ")([^"]+)(")/,
  (_, before, _current, after) => `${before}${nextVersion}${after}`
);

updateJson("src-tauri/tauri.conf.json", (json) => {
  json.version = nextVersion;
});

updateText(
  "src/components/Dashboard.tsx",
  /(const APP_VERSION = ")([^"]+)(";)/,
  (_, before, _current, after) => `${before}${nextVersion}${after}`
);

updateText(
  "src/i18n/en.ts",
  /("sidebar\.version": "TokenFlow v)([^"]+)(")/,
  (_, before, _current, after) => `${before}${nextVersion}${after}`
);

updateText(
  "src/i18n/zh.ts",
  /("sidebar\.version": "TokenFlow v)([^"]+)(")/,
  (_, before, _current, after) => `${before}${nextVersion}${after}`
);

updateText(
  "src-tauri/src/commands/copilot.rs",
  /(TokenFlow\/)([^"]+)/g,
  (_, before) => `${before}${nextVersion}`
);

console.log(`[TokenFlow] Version synced: ${currentVersion} -> ${nextVersion}`);

function resolveFromRoot(relativePath) {
  return path.join(repoRoot, relativePath);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function updateJson(relativePath, updater) {
  const filePath = resolveFromRoot(relativePath);
  const source = readFileSync(filePath, "utf8");
  const json = JSON.parse(source);
  updater(json);
  const next = `${JSON.stringify(json, null, 2)}\n`;

  if (next !== source) {
    writeFileSync(filePath, next, "utf8");
  }
}

function updateText(relativePath, pattern, replacement) {
  const filePath = resolveFromRoot(relativePath);
  const source = readFileSync(filePath, "utf8");
  if (!pattern.test(source)) {
    throw new Error(`Pattern not found for ${relativePath}`);
  }

  pattern.lastIndex = 0;
  const next = source.replace(pattern, replacement);

  if (next !== source) {
    writeFileSync(filePath, next, "utf8");
  }
}

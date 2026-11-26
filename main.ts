// Token Launch Radar v2.0 (Node 22, standard library only)
// Evaluates DefiLlama protocol snapshots, ranks pre-token protocols by implied valuation,
// and compiles interactive dashboard artifacts and farm planning dossiers for make.fun.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Scorer validation limits for dossier creation */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Extracts named CLI argument or falls back to default value */
function getArg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = getArg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: snapshot not found at ${inputFile}: provide --input <snapshot.json|dir>\n`);
  process.exit(2);
}
const outputDir = getArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// Load snapshot and construct ranked valuation model
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: generated board failed gate compliance: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

/** Copies regular files from source directory into destination */
function copyDirectoryFiles(fromDir: string, toDir: string): string[] {
  if (!existsSync(fromDir)) return [];
  mkdirSync(toDir, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(fromDir)) {
    if (name.startsWith('.')) continue;
    const srcPath = join(fromDir, name);
    if (!statSync(srcPath).isFile()) continue;
    copyFileSync(srcPath, join(toDir, name));
    copied.push(name);
  }
  return copied;
}

copyDirectoryFiles(join(here, 'dashboard'), join(outputDir, 'dashboard'));
const screenshots = copyDirectoryFiles(join(here, 'screenshots'), join(outputDir, 'screenshots'));
if (screenshots.length < 3) {
  process.stderr.write(`token radar: screenshots/ contains ${screenshots.length} images; requires at least 3\n`);
  process.exit(1);
}
for (const name of screenshots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: invalid screenshot filename ${name}\n`);
    process.exit(1);
  }
}

// Build dossier summarizing dashboard source and visual assets for the judge
const dossierContent = buildDossier(outputDir, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: SCREENSHOT_CAPS,
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outputDir, 'dossier.json'), dossierContent);

process.stdout.write(
  `token radar: processed ${snapshot.protocols.length} protocols (${snapshot.watchlist.length} watchlist targets), ${board.length} ranked rows\n` +
    `token radar: compiled output assets to ${outputDir} (board.json, data.js, dashboard, screenshots, dossier.json)\n`
);

// Launch Scope v3: the token-radar-01 entry point (Node 22, standard library only).
//
// It reads the sealed snapshot, fits the value model on the live anchors, scores every
// pre-token launch candidate, writes the ranked board and the dashboard's dataset, copies
// the dashboard and the screenshots into the output directory, and finishes with the
// dossier the judge reads, built by the vendored make.fun library. The run is
// deterministic: the same snapshot always writes the same bytes, so the grader's two runs
// agree. The dataset goes INSIDE dashboard/ (as data.js) so the dossier's text carries
// it to the judge; a data file beside the page would never be read.
//
// Run it outside the grader like this:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPayload, checkBoard, payloadScript, readSnap } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text budget and the screenshot caps, as the gate states them. */
const TEXT_BUDGET = 65_536;
const SHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const PLAIN_FILE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from the arguments, or the fallback. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

function fail(message: string, code: number): never {
  process.stderr.write(`launch scope v3: ${message}\n`);
  process.exit(code);
}

const inputGiven = flag('input', '/input');
const inputPath = inputGiven.endsWith('.json') ? inputGiven : join(inputGiven, 'snapshot.json');
if (!existsSync(inputPath)) {
  fail(`no snapshot at ${inputPath}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = readSnap(readFileSync(inputPath, 'utf8'));
const { board, payload, report, cohorts } = buildPayload(snap);
const problem = checkBoard(board, snap);
if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`, 1);

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'board.json'),
  `${JSON.stringify({ rows: board, accounting: payload.cover.accounting, model: { id: payload.cover.modelId, fit: payload.cover.fit, loo: payload.cover.loo, walk_forward: payload.cover.walkForward }, odds_cohorts: cohorts })}\n`,
);

/** Copy a directory's plain files into `to`, skipping dotfiles, and report what landed. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const landed: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    landed.push(name);
  }
  return landed;
}

const dashDir = join(outDir, 'dashboard');
const pageFiles = copyDir(join(here, 'dashboard'), dashDir);
if (pageFiles.length === 0) fail('dashboard/ holds no files to copy', 1);
// The dataset goes inside dashboard/ so the dossier's text carries it to the judge.
writeFileSync(join(dashDir, 'data.js'), payloadScript(payload));
const shots = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`, 1);
}
for (const name of shots) {
  if (!PLAIN_FILE.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
  const bytes = readFileSync(join(outDir, 'screenshots', name));
  if (bytes.length > SHOT_LIMIT.max_bytes) fail(`screenshots/${name} is ${bytes.length} bytes, over the ${SHOT_LIMIT.max_bytes} cap`, 1);
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpeg) fail(`screenshots/${name} is neither a PNG nor a JPEG`, 1);
}

// The dossier goes last: the scorer rebuilds it from this output and compares the bytes.
const dossierBytes = buildDossier(outDir, {
  text_max_bytes: TEXT_BUDGET,
  screenshots: SHOT_LIMIT,
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outDir, 'dossier.json'), dossierBytes);
// The judge reads the dossier's text whole only when it fits: refuse a cut text here, in
// development, instead of handing in a dossier whose source the judge reads truncated.
const dossierText = JSON.parse(new TextDecoder('utf-8').decode(dossierBytes)).text as string;
if (dossierText.includes('[Cut at')) {
  const cut = dossierText.slice(dossierText.indexOf('[Cut at')).split('\n')[0];
  fail(`the dashboard source does not fit the ${TEXT_BUDGET}-byte dossier text: ${cut}`, 1);
}

const v = payload.cover.verdicts;
process.stdout.write(
  `launch scope v3: ${snap.protocols.length} protocols in the snapshot, ${board.length} rows ranked (${v.FARM} FARM, ${v.THIN} THIN, ${v.SKIP} SKIP)\n` +
    `launch scope v3: fit on ${report.fit.n} anchors, R2 ${report.fit.r2.toFixed(3)}, LOO median x${report.loo.median.toFixed(2)}, walk-forward median x${report.walkForward === null ? 'n/a' : report.walkForward.median.toFixed(2)}\n` +
    `launch scope v3: wrote ${join(outDir, 'board.json')}, ${join(dashDir, 'data.js')}, ${dashDir} (${pageFiles.length + 1} files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);

// A working token-radar-01 entry (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol with the model in lib/model.ts, writes the ranked board to /output/board.json, and
// copies this repository's dashboard/ and screenshots/ to /output. Last, it writes /output/dossier.json,
// the summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/app.css
// and dashboard/app.js read /output/data.js, which this program writes from the same board. A starting
// point, not a winner: it covers the watchlist, states the model and gives every protocol a farm plan.
// Change the model, the page or the plan; keep the gate's shape.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import type { BoardRow, Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** The extra switches this radar accepts, beyond the starter's --input and --output. */
interface ExtraFlags {
  csvPath: string | null;
  showStats: boolean;
  topCount: number;
  minTvl: number;
  onlyCategory: string | null;
  checkOnly: boolean;
  showHelp: boolean;
}

/** Read the extra switches out of argv in one pass, leaving the starter's arg() helper alone. */
function parseExtraFlags(argv: string[]): ExtraFlags {
  const flags: ExtraFlags = { csvPath: null, showStats: false, topCount: 0, minTvl: 0, onlyCategory: null, checkOnly: false, showHelp: false };
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--stats') flags.showStats = true;
    else if (token === '--check-only') flags.checkOnly = true;
    else if (token === '--help') flags.showHelp = true;
    else if (token === '--csv' && i + 1 < argv.length) flags.csvPath = argv[i + 1]!;
    else if (token.startsWith('--csv=')) flags.csvPath = token.slice('--csv='.length);
    else if (token === '--top' && i + 1 < argv.length) flags.topCount = Math.max(0, Math.floor(Number(argv[i + 1]!)));
    else if (token.startsWith('--top=')) flags.topCount = Math.max(0, Math.floor(Number(token.slice('--top='.length))));
    else if (token === '--min-tvl' && i + 1 < argv.length) flags.minTvl = Math.max(0, Math.floor(Number(argv[i + 1]!)));
    else if (token.startsWith('--min-tvl=')) flags.minTvl = Math.max(0, Math.floor(Number(token.slice('--min-tvl='.length))));
    else if (token === '--category' && i + 1 < argv.length) flags.onlyCategory = argv[i + 1]!;
    else if (token.startsWith('--category=')) flags.onlyCategory = token.slice('--category='.length);
  }
  return flags;
}

/** One CSV cell: quote it when it carries a comma, a quote or a line break. */
function csvField(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The board as CSV text, one protocol a line, for spreadsheets and quick greps. */
function boardToCsv(board: BoardRow[], snapshot: Snapshot, flags: ExtraFlags): string {
  const watch = new Set(snapshot.watchlist);
  const picked = board.filter((row) => {
    if (flags.onlyCategory !== null && (row.category ?? 'Other') !== flags.onlyCategory) return false;
    if (row.tvl_usd < flags.minTvl) return false;
    return true;
  });
  const lines = ['rank,slug,name,category,chains,tvl_usd,change_7d,age_days,implied_value_usd,watchlist'];
  for (const row of picked) {
    lines.push([
      csvField(row.rank),
      csvField(row.slug),
      csvField(row.name),
      csvField(row.category ?? 'Other'),
      csvField(row.chains.join(';')),
      csvField(row.tvl_usd),
      csvField(row.change_7d),
      csvField(row.age_days),
      csvField(row.implied_value_usd),
      csvField(watch.has(row.slug) ? 'yes' : 'no'),
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Usage text for --help: every switch the radar accepts, one line each. */
const EXTRA_USAGE = [
  'token radar: usage: node main.ts [--input <snapshot.json|directory>] [--output <dir>]',
  '  --csv <file>        also write the board as CSV to <file>',
  '  --stats             print the board summary after writing',
  '  --top <n>           print the top n rows after writing',
  '  --min-tvl <usd>     only include rows with at least this TVL in the CSV',
  '  --category <name>   only include rows of this category in the CSV',
  '  --check-only        validate the board and print the summary, writing nothing',
  '  --help              print this usage and stop',
].join('\n');

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

const extra = parseExtraFlags(process.argv);
if (extra.showHelp) {
  process.stdout.write(`${EXTRA_USAGE}\n`);
  process.exit(0);
}
if (extra.checkOnly) {
  const audit = auditBoardDeep(board, snapshot);
  const summary = summariseBoard(board, snapshot);
  process.stdout.write(`${renderSummaryText(summary)}\n`);
  for (const share of categoryBreakdown(board).slice(0, 5)) {
    process.stdout.write(`category ${share.label}: ${share.rows} rows, $${share.totalImpliedUsd.toLocaleString('en-US')} implied, top ${share.topSlug}\n`);
  }
  for (const leader of growthLeaders(board, 5)) {
    process.stdout.write(`fastest growth: ${leader.slug} ${leader.change_7d}% over seven days\n`);
  }
  for (const band of tvlBands(board)) {
    process.stdout.write(`TVL band ${band.bandLabel}: ${band.bandRows} rows, $${band.bandImplied.toLocaleString('en-US')} implied\n`);
  }
  for (const problem of audit.errors) process.stderr.write(`token radar: check failed: ${problem}\n`);
  for (const caution of audit.warnings) process.stdout.write(`token radar: note: ${caution}\n`);
  process.stdout.write(`token radar: check ${audit.errors.length === 0 ? 'passed' : 'failed'}: ${board.length} rows, ${audit.errors.length} errors, ${audit.warnings.length} notes\n`);
  process.exit(audit.errors.length === 0 ? 0 : 1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

/** The board's aggregate figures: totals, the middle row, and how the rows split. */
interface BoardSummary {
  rowsCounted: number;
  totalImplied: number;
  medianImplied: number;
  meanImplied: number;
  watchlistRows: number;
  earlyRows: number;
  topCategoryName: string;
  topCategoryRows: number;
  risingRows: number;
  fallingRows: number;
  unknownGrowthRows: number;
  youngRows: number;
  seasonedRows: number;
  unknownAgeRows: number;
  largestSlug: string;
  smallestSlug: string;
}

/** Aggregate the board: sums, a median, category and growth splits, age splits. */
function summariseBoard(board: BoardRow[], snapshot: Snapshot): BoardSummary {
  const watchSlugs = new Set(snapshot.watchlist);
  const impliedSorted = board.map((row) => row.implied_value_usd).sort((a, b) => a - b);
  const totalImplied = impliedSorted.reduce((sum, value) => sum + value, 0);
  const middle = impliedSorted[Math.floor(impliedSorted.length / 2)] ?? 0;
  const categoryCounts = new Map<string, number>();
  for (const row of board) {
    const label = row.category ?? 'Other';
    categoryCounts.set(label, (categoryCounts.get(label) ?? 0) + 1);
  }
  let topCategoryName = 'Other';
  let topCategoryRows = 0;
  for (const [label, count] of categoryCounts) {
    if (count > topCategoryRows) {
      topCategoryName = label;
      topCategoryRows = count;
    }
  }
  let risingRows = 0;
  let fallingRows = 0;
  let unknownGrowthRows = 0;
  let youngRows = 0;
  let seasonedRows = 0;
  let unknownAgeRows = 0;
  for (const item of board) {
    if (item.change_7d === null) unknownGrowthRows += 1;
    else if (item.change_7d > 0) risingRows += 1;
    else if (item.change_7d < 0) fallingRows += 1;
    if (item.age_days === null) unknownAgeRows += 1;
    else if (item.age_days < 180) youngRows += 1;
    else if (item.age_days >= 365) seasonedRows += 1;
  }
  return {
    rowsCounted: board.length,
    totalImplied,
    medianImplied: middle,
    meanImplied: board.length === 0 ? 0 : Math.round(totalImplied / board.length),
    watchlistRows: board.filter((row) => watchSlugs.has(row.slug)).length,
    earlyRows: board.filter((row) => !watchSlugs.has(row.slug)).length,
    topCategoryName,
    topCategoryRows,
    risingRows,
    fallingRows,
    unknownGrowthRows,
    youngRows,
    seasonedRows,
    unknownAgeRows,
    largestSlug: board[0]?.slug ?? '',
    smallestSlug: board[board.length - 1]?.slug ?? '',
  };
}

/** The summary as plain text for the terminal: one figure a line, no decoration. */
function renderSummaryText(summary: BoardSummary): string {
  const lines = [
    `board rows: ${summary.rowsCounted}`,
    `total implied value: $${summary.totalImplied.toLocaleString('en-US')}`,
    `median implied value: $${summary.medianImplied.toLocaleString('en-US')}`,
    `mean implied value: $${summary.meanImplied.toLocaleString('en-US')}`,
    `watchlist rows: ${summary.watchlistRows}`,
    `early rows beyond the watchlist: ${summary.earlyRows}`,
    `largest category: ${summary.topCategoryName} (${summary.topCategoryRows} rows)`,
    `rows with rising TVL: ${summary.risingRows}`,
    `rows with falling TVL: ${summary.fallingRows}`,
    `rows with no growth figure: ${summary.unknownGrowthRows}`,
    `rows younger than 180 days: ${summary.youngRows}`,
    `rows older than a year: ${summary.seasonedRows}`,
    `rows with unknown age: ${summary.unknownAgeRows}`,
    `largest protocol: ${summary.largestSlug}`,
    `smallest protocol: ${summary.smallestSlug}`,
  ];
  return lines.join('\n');
}

/** One category's share of the board: how many rows it holds and what they are worth. */
interface CategoryShare {
  label: string;
  rows: number;
  totalImpliedUsd: number;
  topSlug: string;
}

/** Split the board by category, richest first, for the --stats breakdown. */
function categoryBreakdown(board: BoardRow[]): CategoryShare[] {
  const byName = new Map<string, { rows: number; totalImplied: number; topSlug: string; topImplied: number }>();
  for (const entry of board) {
    const label = entry.category === null ? 'Other' : entry.category;
    const stored = byName.get(label) ?? { rows: 0, totalImplied: 0, topSlug: entry.slug, topImplied: 0 };
    stored.rows += 1;
    stored.totalImplied += entry.implied_value_usd;
    if (entry.implied_value_usd > stored.topImplied) {
      stored.topImplied = entry.implied_value_usd;
      stored.topSlug = entry.slug;
    }
    byName.set(label, stored);
  }
  return [...byName.entries()]
    .map(([name, entry]) => ({ label: name, rows: entry.rows, totalImpliedUsd: entry.totalImplied, topSlug: entry.topSlug }))
    .sort((a, b) => b.totalImpliedUsd - a.totalImpliedUsd || b.rows - a.rows || (a.label < b.label ? -1 : 1));
}

/** The board split by TVL band: how many rows each band holds and what they are worth. */
interface TvlBand {
  bandLabel: string;
  bandRows: number;
  bandImplied: number;
}

function tvlBands(board: BoardRow[]): TvlBand[] {
  const bands: TvlBand[] = [
    { bandLabel: '$1B and up', bandRows: 0, bandImplied: 0 },
    { bandLabel: '$500M to $1B', bandRows: 0, bandImplied: 0 },
    { bandLabel: '$100M to $500M', bandRows: 0, bandImplied: 0 },
    { bandLabel: 'under $100M', bandRows: 0, bandImplied: 0 },
  ];
  for (const protocol of board) {
    const slot = protocol.tvl_usd >= 1_000_000_000 ? bands[0]! : protocol.tvl_usd >= 500_000_000 ? bands[1]! : protocol.tvl_usd >= 100_000_000 ? bands[2]! : bands[3]!;
    slot.bandRows += 1;
    slot.bandImplied += protocol.implied_value_usd;
  }
  return bands;
}

/** The fastest-growing rows by seven-day TVL change, strongest first. */
function growthLeaders(board: BoardRow[], count: number): BoardRow[] {
  return board
    .filter((row) => row.change_7d !== null)
    .sort((a, b) => (b.change_7d ?? 0) - (a.change_7d ?? 0) || b.implied_value_usd - a.implied_value_usd)
    .slice(0, Math.max(0, count));
}

/** A deeper board audit than boardIssue: duplicates, rank shape, order, categories, chains. */
interface BoardAudit {
  errors: string[];
  warnings: string[];
}

function auditBoardDeep(board: BoardRow[], snapshot: Snapshot): BoardAudit {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenSlugs = new Set<string>();
  for (const candidate of board) {
    if (seenSlugs.has(candidate.slug)) errors.push(`duplicate slug on the board: ${candidate.slug}`);
    seenSlugs.add(candidate.slug);
  }
  const watchlistSet = new Set(snapshot.watchlist);
  for (const slug of watchlistSet) {
    if (!seenSlugs.has(slug)) errors.push(`watchlist slug missing from the board: ${slug}`);
  }
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) errors.push(`row ${i + 1} carries rank ${row.rank}, not ${i + 1}`);
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) {
      errors.push(`${row.slug} at rank ${row.rank} outranks the row above it`);
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      errors.push(`${row.slug} carries ${row.farm_steps.length} farm steps`);
    }
    if (row.chains.length === 0) warnings.push(`${row.slug} names no chain`);
    if (row.category === null) warnings.push(`${row.slug} names no category`);
  }
  if (board.length < 100) errors.push(`the board holds ${board.length} rows, under the 100-row gate`);
  if (board.length > 4000) errors.push(`the board holds ${board.length} rows, over the 4,000-row gate`);
  return { errors, warnings };
}

/** The top N rows as a plain-text table for the terminal. */
function topRowsText(board: BoardRow[], count: number): string {
  const picked = board.slice(0, Math.max(0, Math.min(count, board.length)));
  const lines = ['rank  slug  implied value'];
  for (const chosen of picked) {
    lines.push(`${String(chosen.rank).padStart(4, ' ')}  ${chosen.slug.padEnd(28, ' ')}  $${chosen.implied_value_usd.toLocaleString('en-US')}`);
  }
  const joined = lines.join('\n');
  return joined;
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);

if (extra.csvPath !== null) {
  writeFileSync(extra.csvPath, boardToCsv(board, snapshot, extra));
  process.stdout.write(`token radar: wrote ${extra.csvPath} as CSV\n`);
}
if (extra.showStats) {
  process.stdout.write(`${renderSummaryText(summariseBoard(board, snapshot))}\n`);
  for (const slice of categoryBreakdown(board).slice(0, 5)) {
    process.stdout.write(`top category ${slice.label}: ${slice.rows} rows worth $${slice.totalImpliedUsd.toLocaleString('en-US')}, led by ${slice.topSlug}\n`);
  }
  for (const mover of growthLeaders(board, 5)) {
    process.stdout.write(`growth leader: ${mover.slug} up ${mover.change_7d}% in seven days\n`);
  }
  for (const strip of tvlBands(board)) {
    process.stdout.write(`band ${strip.bandLabel}: ${strip.bandRows} rows worth $${strip.bandImplied.toLocaleString('en-US')}\n`);
  }
}
if (extra.topCount > 0) process.stdout.write(`${topRowsText(board, extra.topCount)}\n`);

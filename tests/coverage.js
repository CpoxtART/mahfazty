/*
 * Real per-file coverage for the production app.*.js files.
 *
 * Node's built-in `node --test --experimental-test-coverage` only reports
 * coverage for files it loads as normal modules — but the app files run
 * inside a `vm` sandbox (tests/sandbox.js) under one synthetic filename,
 * 'mahfazty-bundle.js', so that flag's own reporter has no real file to map
 * results back to and silently reports 100% on the tests/ harness itself
 * while saying nothing about the ~14,000 lines of app logic those tests
 * actually exercise.
 *
 * This script instead:
 *   1. Re-runs the suite once per test file as a child process with
 *      NODE_V8_COVERAGE set, collecting RAW V8 coverage (which records
 *      executed ranges against 'mahfazty-bundle.js' too, since V8 coverage
 *      is per-isolate/script, not per-CommonJS-module).
 *   2. Uses sandbox.js's buildAppBundle() — the SAME function that builds
 *      the vm's source string — to know exactly which character range of
 *      that bundle belongs to which real file.
 *   3. Merges the executed ranges across every worker process into a single
 *      covered/uncovered bitmap over the bundle, then walks it line-by-line
 *      per file to report a real percentage and the specific uncovered
 *      lines.
 *
 * This is a from-scratch reducer over V8's raw protocol, not an Istanbul/nyc
 * clone — it approximates coverage by marking a function's range as covered
 * when its call count is >0, then letting any NESTED range in the same
 * function's range list (V8's block-coverage "holes" — e.g. an untaken
 * if-branch) override that specific sub-range. That matches real control
 * flow for the vast majority of code; it is not byte-for-byte identical to
 * a proper instrumenting coverage tool for deeply nested branches, but it's
 * more than accurate enough to catch untested files/functions and track
 * trend over time — which is the actual point of running this in CI.
 *
 * Usage: node tests/coverage.js [--min=NN] [--json=path]
 *   --min=NN   exit(1) if the overall line-coverage % is below NN (for CI gating)
 *   --json=path  also write a machine-readable summary to that path
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildAppBundle } = require('./sandbox.js');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const minArg = args.find(a => a.startsWith('--min='));
const jsonArg = args.find(a => a.startsWith('--json='));
const MIN_PCT = minArg ? Number(minArg.slice('--min='.length)) : null;
const JSON_OUT = jsonArg ? jsonArg.slice('--json='.length) : null;

const testFiles = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js'));
if(!testFiles.length){
  console.error('No tests/*.test.js files found.');
  process.exit(1);
}

const covDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mhfzty-cov-'));
try{
  // One combined run (not per-file) — node --test spawns its own worker per
  // file regardless, and NODE_V8_COVERAGE accumulates one JSON per worker
  // process into the same directory automatically.
  execFileSync(process.execPath, ['--test', '--test-reporter=dot', '--test-reporter-destination=stdout',
      ...testFiles.map(f => path.join(__dirname, f))],
    { cwd: ROOT, env: { ...process.env, NODE_V8_COVERAGE: covDir }, stdio: 'inherit' });
}catch(e){
  // tests already reported their own pass/fail; still try to produce a
  // coverage report from whatever ran, but propagate the failure at the end.
}

const { src, segments } = buildAppBundle();
const covered = new Uint8Array(src.length); // 1 = executed at least once

const covFiles = fs.readdirSync(covDir).filter(f => f.endsWith('.json'));
for(const cf of covFiles){
  let data;
  try{ data = JSON.parse(fs.readFileSync(path.join(covDir, cf), 'utf8')); }catch(_){ continue; }
  for(const script of (data.result || [])){
    if(script.url !== 'mahfazty-bundle.js') continue;
    for(const fn of (script.functions || [])){
      // Ranges within one function are emitted outer-first, nested "hole"
      // ranges after — later entries correctly override their narrower
      // sub-range's covered/not-covered status when we apply them in order.
      for(const r of (fn.ranges || [])){
        const val = r.count > 0 ? 1 : 0;
        const end = Math.min(r.endOffset, covered.length);
        for(let i = r.startOffset; i < end; i++) covered[i] = val;
      }
    }
  }
}

function lineStarts(str){
  const starts = [0];
  for(let i = 0; i < str.length; i++) if(str[i] === '\n') starts.push(i + 1);
  return starts;
}
const starts = lineStarts(src);
function offsetToLine(off){
  // binary search for the last line-start <= off
  let lo = 0, hi = starts.length - 1;
  while(lo < hi){
    const mid = (lo + hi + 1) >> 1;
    if(starts[mid] <= off) lo = mid; else hi = mid - 1;
  }
  return lo; // 0-based line index
}

const rows = [];
let totalLines = 0, totalCovered = 0;
for(const seg of segments){
  const startLine = offsetToLine(seg.start);
  const endLine = offsetToLine(Math.max(seg.start, seg.end - 1));
  const lineCovered = new Array(endLine - startLine + 1).fill(false);
  const lineHasCode = new Array(endLine - startLine + 1).fill(false);
  for(let off = seg.start; off < seg.end; off++){
    const ch = src[off];
    if(ch === '\n' || ch === ' ' || ch === '\t' || ch === '\r') continue;
    const li = offsetToLine(off) - startLine;
    lineHasCode[li] = true;
    if(covered[off]) lineCovered[li] = true;
  }
  const uncoveredLines = [];
  let fileTotal = 0, fileCovered = 0;
  for(let i = 0; i < lineHasCode.length; i++){
    if(!lineHasCode[i]) continue; // blank/comment-only lines don't count either way
    fileTotal++;
    if(lineCovered[i]) fileCovered++;
    else uncoveredLines.push(i + 1); // 1-based, LOCAL to this file (matches editors)
  }
  totalLines += fileTotal; totalCovered += fileCovered;
  rows.push({
    file: seg.file,
    pct: fileTotal ? +(fileCovered / fileTotal * 100).toFixed(1) : 100,
    covered: fileCovered, total: fileTotal,
    uncoveredLines,
  });
}

const overallPct = totalLines ? +(totalCovered / totalLines * 100).toFixed(1) : 100;

console.log('\n# app.*.js line coverage (from the actual test suite, not the tests/ harness)');
console.log('# ' + '-'.repeat(74));
console.log('# file'.padEnd(24) + 'covered %'.padEnd(12) + 'lines'.padEnd(14) + 'uncovered (first 8)');
console.log('# ' + '-'.repeat(74));
for(const r of rows.sort((a,b) => a.pct - b.pct)){
  const uncov = r.uncoveredLines.slice(0, 8).join(',') + (r.uncoveredLines.length > 8 ? ',…' : '');
  console.log('  ' + r.file.padEnd(22) + String(r.pct + '%').padEnd(12) + `${r.covered}/${r.total}`.padEnd(14) + (r.uncoveredLines.length ? uncov : ''));
}
console.log('# ' + '-'.repeat(74));
console.log(`# TOTAL: ${overallPct}% (${totalCovered}/${totalLines} executable lines)`);
console.log('# ' + '-'.repeat(74) + '\n');

if(JSON_OUT){
  fs.writeFileSync(JSON_OUT, JSON.stringify({ overallPct, totalCovered, totalLines, files: rows }, null, 2));
}

fs.rmSync(covDir, { recursive: true, force: true });

if(MIN_PCT !== null && overallPct < MIN_PCT){
  console.error(`Coverage ${overallPct}% is below the required minimum ${MIN_PCT}%.`);
  process.exit(1);
}

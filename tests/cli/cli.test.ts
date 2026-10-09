import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const exec = promisify(execFile);

const real = 'data/fixtures/candles/sol-5m-1790869255065-1791474055065.json';

const synthetic = 'tests/fixtures/synthetic-rsi.json';

const baseline = 'strategies/rsi-v1.ts';

const candidate = 'strategies/rsi-v2.ts';

const compare = (data = synthetic, other = candidate) => [
  'compare',
  '--data',
  data,
  '--baseline',
  baseline,
  '--candidate',
  other,
];

async function cli(args: string[]) {
  try {
    const result = await exec(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
      cwd: resolve('.'),
      maxBuffer: 2 * 1024 * 1024,
    });

    return { code: 0, ...result };
  } catch (error) {
    const result = error as {
      code: number;
      stdout: string;
      stderr: string;
    };

    return {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

let temp: string;
beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'phoenix-cli-'));
});
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});
describe('real CLI subprocesses (offline)', () => {
  it('supports help, command help and version', async () => {
    for (const args of [['--help'], ['compare', '--help']]) {
      const result = await cli(args);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('max-changed-decisions');
    }
    expect((await cli(['--version'])).stdout.trim()).toBe('1.0.0');
  });

  it('inspects the real fixture with accurate coverage warnings', async () => {
    const result = await cli(['inspect', '--data', real]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Finalized bars: 1,883');
    expect(result.stdout).toContain('WARNING: 132 trailing candles missing.');
    const json = await cli(['inspect', '--data', real, '--format', 'json']);
    expect(JSON.parse(json.stdout).metadata.integrity.coverage.trailingMissingBars).toBe(132);
  });

  it('imports a local TypeScript factory for replay', async () => {
    const result = await cli([
      'replay',
      '--data',
      synthetic,
      '--strategy',
      baseline,
      '--format',
      'json',
    ]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.schemaVersion).toBe(1);
    expect(report.strategyName).toBe('rsi-v1');
    expect(report.totalEvents).toBe(17);
    expect(report.counts.BUY).toBe(1);
  });

  it('compares two modules and returns deliberate synthetic differences without failing', async () => {
    const result = await cli(compare());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Changed decisions: 2');
    expect(result.stdout).toContain('HOLD');
    expect(result.stdout).toContain('BUY');
  });

  it('uses distinct regression and argument-error exit codes', async () => {
    const pass = await cli([...compare(synthetic, baseline), '--max-changed-decisions', '0']);
    expect(pass.code).toBe(0);
    expect(pass.stdout).toContain('Regression assertion: PASS');
    expect(pass.stdout).toContain('No behavioral changes.');
    const fail = await cli([...compare(), '--max-changed-decisions', '0']);
    expect(fail.code).toBe(1);
    expect(fail.stdout).toContain('Regression assertion: FAIL');
    const accepted = await cli([...compare(), '--max-changed-decisions', '2']);
    expect(accepted.code).toBe(0);
    expect((await cli([...compare(), '--max-changed-decisions', '-1'])).code).toBe(2);
  });

  it('keeps JSON deterministic, complete and free from warning prose', async () => {
    const args = [...compare(real), '--format', 'json', '--max-rows', '0'];
    const result = await cli(args);
    const report = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(report).toMatchObject({
      schemaVersion: 1,
      inputEvents: 1883,
      changedDecisions: 24,
      comparableDecisions: 1883,
      unchangedDecisions: 1859,
    });
    expect(report.diffs).toHaveLength(24);
    expect(report.dataset.meta.integrity.coverage.trailingMissingBars).toBe(132);
    expect(report.warnings).toHaveLength(1);
    expect((await cli(args)).stdout).toBe(result.stdout);
  });

  it('exports JSON and refuses to overwrite it', async () => {
    const out = join(temp, 'reports', 'comparison.json');
    const result = await cli([...compare(), '--format', 'json', '--out', out]);
    expect(result.code).toBe(0);
    const saved = await readFile(out, 'utf8');
    expect(saved).toBe(result.stdout);
    expect(JSON.parse(saved).diffs).toHaveLength(2);
    const again = await cli([...compare(), '--format', 'json', '--out', out]);
    expect(again.code).toBe(2);
    expect(await readFile(out, 'utf8')).toBe(saved);
  });

  it('limits text rows and supports show-all', async () => {
    const limited = await cli([...compare(), '--max-rows', '1']);
    expect(limited.stdout).toContain('Showing 1 of 2 changes');
    const all = await cli([...compare(), '--show-all']);
    expect(all.stdout).not.toContain('Showing');
    expect(all.stdout).toContain('2026-10-01 11:20:00');
    expect(all.stdout).toContain('2026-10-01 11:25:00');
  });

  it('reports missing files, malformed JSON and invalid module exports', async () => {
    expect((await cli(['inspect', '--data', join(temp, 'missing.json')])).code).toBe(2);
    const broken = join(temp, 'broken.json');
    await writeFile(broken, '{');
    expect((await cli(['inspect', '--data', broken])).stderr).toContain(
      'Cannot load candle fixture',
    );
    const bad = join(temp, 'bad.ts');
    await writeFile(bad, 'export default 123;');
    const invalid = await cli(['replay', '--data', synthetic, '--strategy', bad]);
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain('default-export');
    const missing = await cli([
      'replay',
      '--data',
      synthetic,
      '--strategy',
      join(temp, 'missing.ts'),
    ]);
    expect(missing.stderr).toContain('Cannot load strategy');
  });

  it('rejects invalid flags and options', async () => {
    for (const args of [
      [...compare(), '--format', 'yaml'],
      [...compare(), '--bogus'],
      [...compare(), '--max-rows', '1.5'],
      [...compare(), '--max-rows', '1', '--show-all'],
      ['compare', '--data', synthetic],
      [...compare(), '--data', synthetic],
      ['inspect', '--data', synthetic, '--strategy', baseline],
    ]) {
      expect((await cli(args)).code).toBe(2);
    }
  });

  it('shows a warm-up-only zero-difference result and validates factory shape', async () => {
    const warmup = join(temp, 'warmup.json');
    const fixture = JSON.parse(await readFile(synthetic, 'utf8'));
    fixture.bars = fixture.bars.slice(0, 1);
    fixture.meta.barCount = 1;
    const coverage = fixture.meta.integrity.coverage;
    coverage.trailingMissingBars = 16;
    coverage.missingBars = 16;
    coverage.complete = false;
    await writeFile(warmup, JSON.stringify(fixture));
    const result = await cli(compare(warmup));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('No behavioral changes.');
    const badFactory = join(temp, 'factory.ts');
    await writeFile(badFactory, 'export default () => ({ name: "broken" });');
    const error = await cli(['replay', '--data', synthetic, '--strategy', badFactory]);
    expect(error.code).toBe(2);
    expect(error.stderr).toContain('must return { name, onEvent }');
  });
});

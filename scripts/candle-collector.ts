import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateCandleFixture } from '../src/data/candle-loader.js';
import type { CandleFixture } from '../src/data/types.js';

export { API_URL, collectCandles, type CandleFetcher } from '../src/data/collect-candles.js';

export async function saveCandleFixture(
  path: string,
  fixture: CandleFixture,
  force = false,
): Promise<void> {
  const content = JSON.stringify(validateCandleFixture(fixture), null, 2) + '\n';
  await mkdir(dirname(path), { recursive: true });

  if (!force) {
    await writeFile(path, content, { flag: 'wx' });
    return;
  }

  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { flag: 'wx' });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

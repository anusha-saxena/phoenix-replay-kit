import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const source = new URL(
  "../../../data/fixtures/candles/sol-5m-1790869255065-1791474055065.json",
  import.meta.url,
);
const target = new URL("../lib/demo-fixture.json", import.meta.url);
const bytes = await readFile(source);
await mkdir(new URL("../lib/", import.meta.url), { recursive: true });
await writeFile(target, bytes);
const hash = (value) => createHash("sha256").update(value).digest("hex");
if (hash(bytes) !== hash(await readFile(target)))
  throw new Error("Demo fixture copy differs from canonical data");
console.log(`Bundled canonical demo fixture: ${hash(bytes)}`);

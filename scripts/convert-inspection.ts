import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createFundingFixture, createOrderbookFixture } from '../src/index.js';

// parse cli options
const parsedArgs = parseArgs({
  options: {
    kind: { type: 'string' },
    input: { type: 'string' },
    out: { type: 'string' },
    symbol: { type: 'string', default: 'SOL' },
    'lag-ms': { type: 'string' },
  },
});
const values = parsedArgs.values;

// basic input validation checks
let kindVal = values.kind;
if (kindVal === undefined) {
  kindVal = '';
}

if (!values.input || !values.out || !['funding', 'orderbook'].includes(kindVal)) {
  throw new Error('Use --kind funding|orderbook --input PATH --out PATH; funding requires --lag-ms');
}

if (values.kind === 'funding' && values['lag-ms'] === undefined) {
  throw new Error('Funding requires an explicit --lag-ms assumption');
}

// read file and parse json
const fileData = await readFile(values.input, 'utf8');
const input: unknown = JSON.parse(fileData);

let fixture;
if (values.kind === 'funding') {
  const lagNum = Number(values['lag-ms']);
  fixture = createFundingFixture(input, lagNum);
} else {
  const sym = values.symbol!;
  fixture = createOrderbookFixture(input, sym);
}

// ensure directory exists and write out
const dir = dirname(values.out);
await mkdir(dir, { recursive: true });

const jsonContent = JSON.stringify(fixture, null, 2) + '\n';
await writeFile(values.out, jsonContent, { flag: 'wx' });

console.log(`Saved ${values.kind} fixture to ${values.out}`);
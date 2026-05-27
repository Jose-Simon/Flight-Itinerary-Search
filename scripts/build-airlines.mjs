/**
 * OpenFlights airlines.dat → src/data/airlinesByIata.json + airlinesMeta.json
 * Fields: ID, Name, Alias, IATA, ICAO, Callsign, Country, Active
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'src', 'data');
const URL = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat';

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

const text = await fetch(URL).then((r) => {
  if (!r.ok) throw new Error(`Fetch airlines: ${r.status}`);
  return r.text();
});

/** @type {Record<string, string>} */
const byIata = {};
/** @type {Record<string, { name: string; country: string }>} */
const meta = {};
for (const line of text.split('\n')) {
  if (!line.trim()) continue;
  const p = parseCsvLine(line);
  const name = (p[1] ?? '').trim();
  const iata = (p[3] ?? '').trim();
  const country = (p[6] ?? '').trim() || 'Unknown';
  if (!iata || iata === '\\N' || iata.length !== 2) continue;
  const code = iata.toUpperCase();
  if (!name) continue;
  if (!byIata[code]) {
    byIata[code] = name;
    meta[code] = { name, country };
  }
}

fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'airlinesByIata.json'), JSON.stringify(byIata));
fs.writeFileSync(path.join(dataDir, 'airlinesMeta.json'), JSON.stringify(meta));
console.log(`Wrote ${Object.keys(byIata).length} airline IATA codes + meta.`);

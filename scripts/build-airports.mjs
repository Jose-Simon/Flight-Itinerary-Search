/**
 * Fetches OpenFlights airports.dat + countries.dat, writes:
 * - src/data/airports.json
 * - src/data/countryToAirports.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'src', 'data');

const AIRPORTS_URL =
  'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat';
const COUNTRIES_URL =
  'https://raw.githubusercontent.com/jpatokal/openflights/master/data/countries.dat';

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

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch ${url}: ${r.status}`);
  return r.text();
}

function main() {
  fs.mkdirSync(dataDir, { recursive: true });
}

main();

const [airportsRaw, countriesRaw] = await Promise.all([
  fetchText(AIRPORTS_URL),
  fetchText(COUNTRIES_URL),
]);

/** @type {Map<string, string>} countryName -> ISO2 */
const countryNameToIso = new Map();
for (const line of countriesRaw.split('\n')) {
  if (!line.trim()) continue;
  const parts = parseCsvLine(line);
  const name = (parts[0] ?? '').trim();
  const iso = (parts[1] ?? '').trim();
  if (!name || !iso || iso === '\\N') continue;
  countryNameToIso.set(name, iso);
}

/** @type {{ iata: string; name: string; city: string; country: string; countryIso: string; tz: string; lat: number | null; lon: number | null }[]} */
const airports = [];
/** @type {Record<string, string[]>} */
const countryToAirports = {};

for (const line of airportsRaw.split('\n')) {
  if (!line.trim()) continue;
  const p = parseCsvLine(line);
  // Airport ID, Name, City, Country, IATA, ICAO, Lat, Lon, Alt, Timezone, DST, Tz, type, source
  const name = p[1] ?? '';
  const city = p[2] ?? '';
  const countryName = p[3] ?? '';
  const iata = (p[4] ?? '').trim();
  if (!iata || iata === '\\N') continue;
  const countryIso = countryNameToIso.get(countryName) ?? '';
  let tz = (p[11] ?? '').trim();
  if (!tz || tz === '\\N') tz = '';
  const latRaw = (p[6] ?? '').trim();
  const lonRaw = (p[7] ?? '').trim();
  const lat = latRaw && latRaw !== '\\N' ? Number(latRaw) : null;
  const lon = lonRaw && lonRaw !== '\\N' ? Number(lonRaw) : null;
  airports.push({
    iata,
    name,
    city,
    country: countryName,
    countryIso: countryIso || 'ZZ',
    tz,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
  });
  const key = countryIso || 'ZZ';
  if (!countryToAirports[key]) countryToAirports[key] = [];
  if (!countryToAirports[key].includes(iata)) countryToAirports[key].push(iata);
}

airports.sort((a, b) => a.iata.localeCompare(b.iata));

fs.writeFileSync(path.join(dataDir, 'airports.json'), JSON.stringify(airports));
fs.writeFileSync(
  path.join(dataDir, 'countryToAirports.json'),
  JSON.stringify(countryToAirports),
);
console.log(`Wrote ${airports.length} airports and ${Object.keys(countryToAirports).length} country keys.`);

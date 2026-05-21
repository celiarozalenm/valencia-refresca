/**
 * Descarga snapshots GeoJSON de los datasets del Portal de Datos Abiertos de
 * València. La API CKAN responde rápido desde cualquier sitio, pero el
 * geoportal (geoportal.valencia.es) requiere conexión desde Europa o VPN —
 * desde Taiwán el TCP conecta pero el servidor nunca responde.
 *
 * Uso:
 *   npx tsx src/data/scripts/fetch-datasets.ts
 *   npx tsx src/data/scripts/fetch-datasets.ts urinaris-urinarios   # uno solo
 *
 * Output: src/data/snapshots/<dataset-id>.geojson + manifest.json
 */

import { mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = resolve(__dirname, "../snapshots");
const CKAN_BASE = "https://opendata.vlci.valencia.es/api/3/action";

// Los datasets principales del proyecto (ver docs/03-datasets.md)
const DATASETS = [
  // Capa principal: servicios de alivio térmico
  "urinaris-urinarios",
  "fonts-daigua-publica-fuentes-de-agua-publica",
  "arbratge-arbolado",
  "espais-verds-espacios-verdes",
  "dutxes-platja-duchas-playa",
  "llavapeus-platges-lavapies-playas",
  // Capa contexto urbano
  "barris-barrios",
  "districtes-distritos",
] as const;

const FETCH_TIMEOUT_MS = 90_000;
const PAGE_SIZE = 2000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 4_000;

type CkanResource = {
  id: string;
  format: string;
  url: string;
  name?: string;
};

type CkanPackage = {
  name: string;
  title: string;
  last_updated?: string;
  resources: CkanResource[];
};

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(url, timeoutMs);
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * attempt));
    }
  }
  throw lastError;
}

function arcgisQueryUrl(base: string, offset: number, limit: number): string {
  // The CKAN-published URL is an ArcGIS query — we rewrite it with pagination params.
  const url = new URL(base);
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(limit));
  url.searchParams.set("orderByFields", url.searchParams.get("orderByFields") ?? "OBJECTID");
  return url.toString();
}

async function fetchPaginated(baseUrl: string): Promise<{ type: "FeatureCollection"; features: unknown[] }> {
  const features: unknown[] = [];
  let offset = 0;
  while (true) {
    const url = arcgisQueryUrl(baseUrl, offset, PAGE_SIZE);
    const res = await fetchWithRetry(url);
    const json = (await res.json()) as { type?: string; features?: unknown[]; exceededTransferLimit?: boolean };
    if (json.type !== "FeatureCollection" || !Array.isArray(json.features)) {
      throw new Error(`Page at offset ${offset} not a FeatureCollection`);
    }
    features.push(...json.features);
    process.stdout.write(`+${json.features.length} `);
    const more = json.exceededTransferLimit === true || json.features.length >= PAGE_SIZE;
    if (!more) break;
    offset += json.features.length;
  }
  return { type: "FeatureCollection", features };
}

async function fileExistsAndValid(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    if (s.size < 50) return null;
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text);
    if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) return null;
    return parsed.features.length;
  } catch {
    return null;
  }
}

async function getPackage(id: string): Promise<CkanPackage> {
  const res = await fetchWithTimeout(`${CKAN_BASE}/package_show?id=${id}`, 30_000);
  if (!res.ok) throw new Error(`CKAN ${res.status} for ${id}`);
  const json = (await res.json()) as { success: boolean; result: CkanPackage };
  if (!json.success) throw new Error(`CKAN package_show failed for ${id}`);
  return json.result;
}

function pickGeoJsonResource(pkg: CkanPackage): CkanResource {
  const geojson = pkg.resources.find((r) => r.format?.toLowerCase() === "geojson");
  if (!geojson) throw new Error(`No GeoJSON resource in ${pkg.name}`);
  return geojson;
}

async function downloadDataset(id: string, opts: { force?: boolean } = {}) {
  const start = Date.now();
  const outPath = resolve(SNAPSHOTS_DIR, `${id}.geojson`);

  if (!opts.force) {
    const existing = await fileExistsAndValid(outPath);
    if (existing !== null) {
      console.log(`→ ${id} ... skipped (${existing} features cached)`);
      return null;
    }
  }

  process.stdout.write(`→ ${id} ... `);

  const pkg = await getPackage(id);
  const resource = pickGeoJsonResource(pkg);

  const collection = await fetchPaginated(resource.url);
  const text = JSON.stringify(collection);

  await writeFile(outPath, text);

  const ms = Date.now() - start;
  console.log(`= ${collection.features.length} features · ${(text.length / 1024).toFixed(1)}KB · ${ms}ms`);

  return {
    id,
    title: pkg.title,
    last_updated: pkg.last_updated,
    feature_count: collection.features.length,
    bytes: text.length,
    source_url: resource.url,
    fetched_at: new Date().toISOString(),
  };
}

async function main() {
  await mkdir(SNAPSHOTS_DIR, { recursive: true });

  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const requested = args.filter((a) => !a.startsWith("--"));
  const targets = requested.length > 0 ? requested : [...DATASETS];

  console.log(`Fetching ${targets.length} datasets to ${SNAPSHOTS_DIR}${force ? " (force)" : ""}\n`);

  const manifest: NonNullable<Awaited<ReturnType<typeof downloadDataset>>>[] = [];
  const failures: { id: string; error: string }[] = [];

  for (const id of targets) {
    try {
      const result = await downloadDataset(id, { force });
      if (result) manifest.push(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`FAILED — ${message}`);
      failures.push({ id, error: message });
    }
  }

  const manifestPath = resolve(SNAPSHOTS_DIR, "manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify({ generated_at: new Date().toISOString(), datasets: manifest, failures }, null, 2),
  );

  console.log(`\n✓ ${manifest.length} ok · ${failures.length} failed`);
  console.log(`Manifest: ${manifestPath}`);

  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

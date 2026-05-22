/**
 * Pide metadata de un ArcGIS MapServer layer y lista todos sus fields.
 * Útil para descubrir qué columnas tiene un dataset sin descargar todos los
 * features.
 *
 * Uso (vía workflow):
 *   npx tsx src/data/scripts/probe-layer.ts <layerUrl>
 */

const url = process.argv[2];
if (!url) {
  console.error("Pass an ArcGIS MapServer layer URL (ending in /MapServer/<n>)");
  process.exit(1);
}

const metaUrl = `${url.split("/query")[0]}?f=json`;
const res = await fetch(metaUrl);
const meta = (await res.json()) as {
  name?: string;
  fields?: { name: string; type: string; alias?: string }[];
  layers?: { id: number; name: string }[];
};

if (meta.layers) {
  console.log(`MapServer with ${meta.layers.length} layers:`);
  for (const l of meta.layers) {
    console.log(`  [${l.id}] ${l.name}`);
  }
} else {
  console.log(`Layer: ${meta.name}`);
  console.log(`Fields (${meta.fields?.length ?? 0}):`);
  for (const f of meta.fields ?? []) {
    console.log(`  · ${f.name} (${f.type}) ${f.alias ? `— ${f.alias}` : ""}`);
  }
}

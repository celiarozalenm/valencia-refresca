"""
Genera una capa enriquecida de barrios con densidad de arbolado.
Output: public/data/barrios-sombra.geojson — barrios con propiedad árboles/km²
para usar en el mapa como choropleth de sombra.
"""

from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parents[3]
SNAP = ROOT / "src" / "data" / "snapshots"
PUBLIC = ROOT / "public" / "data"

PROJECTED_CRS = "EPSG:25830"
WGS84 = "EPSG:4326"


def main() -> None:
    barrios = gpd.read_file(SNAP / "barris-barrios.geojson")
    arbolado = gpd.read_file(SNAP / "arbratge-arbolado.geojson")

    if barrios.crs is None:
        barrios = barrios.set_crs(WGS84)
    if arbolado.crs is None:
        arbolado = arbolado.set_crs(WGS84)

    barrios_m = barrios.to_crs(PROJECTED_CRS)
    arbolado_m = arbolado.to_crs(PROJECTED_CRS)

    # área en km²
    barrios_m["area_km2"] = barrios_m.geometry.area / 1e6

    # conteo de árboles por barrio
    joined = gpd.sjoin(
        arbolado_m[["geometry"]],
        barrios_m[["nombre", "geometry"]],
        how="inner",
        predicate="within",
    )
    tree_counts = joined.groupby("nombre").size().rename("arboles")

    barrios_m["arboles"] = barrios_m["nombre"].map(tree_counts).fillna(0).astype(int)
    barrios_m["arboles_per_km2"] = (
        barrios_m["arboles"] / barrios_m["area_km2"].replace({0: 1})
    ).round(1)

    # Buckets para coloreado (jenks-like manual basado en distribución observada)
    def bucket(v: float) -> str:
        if v >= 8000: return "muy_alta"
        if v >= 5000: return "alta"
        if v >= 2000: return "media"
        if v >= 500: return "baja"
        return "muy_baja"

    barrios_m["sombra_bucket"] = barrios_m["arboles_per_km2"].apply(bucket)

    # Volvemos a WGS84 para el mapa
    out = barrios_m.to_crs(WGS84)
    keep = ["nombre", "area_km2", "arboles", "arboles_per_km2", "sombra_bucket", "geometry"]
    out = out[keep]

    PUBLIC.mkdir(parents=True, exist_ok=True)
    out_path = PUBLIC / "barrios-sombra.geojson"
    out.to_file(out_path, driver="GeoJSON")

    # Resumen
    print(f"✓ {out_path} ({len(out)} barrios)")
    print(out[["nombre", "arboles", "arboles_per_km2", "sombra_bucket"]].sort_values("arboles_per_km2", ascending=False).head(5).to_string())
    print("...")
    print(out[["nombre", "arboles", "arboles_per_km2", "sombra_bucket"]].sort_values("arboles_per_km2").head(5).to_string())


if __name__ == "__main__":
    main()

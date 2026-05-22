"""
Análisis exploratorio de los datasets de València Refresca.

Cruza fuentes, urinarios, sombra (arbolado + espacios verdes) con los barrios
y los indicadores de vulnerabilidad. Output: estadísticas a consola + JSON
guardado en src/data/derived/exploration.json para usar luego en la web.

Uso:
    python3 src/data/scripts/explore.py
"""

from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parents[1]
SNAP = ROOT / "snapshots"
DERIVED = ROOT / "derived"
DERIVED.mkdir(exist_ok=True)

# CRS para distancias en metros (UTM 30N, válido para València)
PROJECTED_CRS = "EPSG:25830"
WGS84 = "EPSG:4326"


def load(name: str) -> gpd.GeoDataFrame:
    path = SNAP / f"{name}.geojson"
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs(WGS84)
    return gdf


def to_metric(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return gdf.to_crs(PROJECTED_CRS)


def count_in_polygons(points: gpd.GeoDataFrame, polys: gpd.GeoDataFrame, key: str) -> pd.Series:
    """Devuelve serie {poly_key: count} de puntos contenidos en cada polígono."""
    joined = gpd.sjoin(points, polys[[key, "geometry"]], how="inner", predicate="within")
    return joined.groupby(key).size()


def nearest_distance_m(points: gpd.GeoDataFrame, targets: gpd.GeoDataFrame) -> pd.Series:
    """Distancia (metros) de cada punto al target más cercano."""
    joined = gpd.sjoin_nearest(points, targets[["geometry"]], distance_col="dist_m")
    return joined.groupby(joined.index)["dist_m"].min()


def main() -> None:
    print("Cargando snapshots…")
    fuentes = load("fonts-daigua-publica-fuentes-de-agua-publica")
    urinarios = load("urinaris-urinarios")
    duchas = load("dutxes-platja-duchas-playa")
    arbolado = load("arbratge-arbolado")
    verdes = load("espais-verds-espacios-verdes")
    barrios = load("barris-barrios")
    distritos = load("districtes-distritos")
    vuln = load("vulnerabilidad-por-barrios")

    print(
        f"  fuentes={len(fuentes)} urinarios={len(urinarios)} duchas={len(duchas)} "
        f"arbolado={len(arbolado)} verdes={len(verdes)} "
        f"barrios={len(barrios)} distritos={len(distritos)} vuln={len(vuln)}"
    )

    # Normalizar nombre del barrio
    barrios = barrios.rename(columns={c: c.lower() for c in barrios.columns})
    barrios["barrio_key"] = barrios["nombre"] if "nombre" in barrios.columns else barrios.iloc[:, 0]

    print(f"\nColumnas de barrios: {list(barrios.columns)[:10]}…")

    # === 1. Cobertura: cuántos servicios hay por barrio ===
    print("\n=== Servicios por barrio ===")
    counts = pd.DataFrame(index=barrios["barrio_key"])
    counts["fuentes"] = count_in_polygons(fuentes, barrios, "barrio_key").reindex(counts.index, fill_value=0)
    counts["urinarios"] = count_in_polygons(urinarios, barrios, "barrio_key").reindex(counts.index, fill_value=0)
    counts["espais_verds"] = count_in_polygons(verdes.set_geometry(verdes.geometry.centroid), barrios, "barrio_key").reindex(
        counts.index, fill_value=0
    )
    counts = counts.sort_values("fuentes")
    print(counts.head(15))
    print(f"\nBarrios sin fuente: {(counts['fuentes']==0).sum()} / {len(counts)}")
    print(f"Barrios sin urinario: {(counts['urinarios']==0).sum()} / {len(counts)}")

    # === 2. Cruce con vulnerabilidad ===
    print("\n=== Vulnerabilidad vs cobertura ===")
    vuln = vuln.rename(columns={c: c.lower() for c in vuln.columns})
    vuln_metric = to_metric(vuln)
    fuentes_m = to_metric(fuentes)
    urinarios_m = to_metric(urinarios)

    fuentes_in_vuln = count_in_polygons(fuentes, vuln, "nombre").reindex(vuln["nombre"], fill_value=0)
    urinarios_in_vuln = count_in_polygons(urinarios, vuln, "nombre").reindex(vuln["nombre"], fill_value=0)

    vuln_df = vuln[["nombre", "vul_global", "ind_global", "ind_dem", "vul_dem", "shape_area"]].copy()
    vuln_df["fuentes"] = fuentes_in_vuln.values
    vuln_df["urinarios"] = urinarios_in_vuln.values
    vuln_df["area_km2"] = vuln_df["shape_area"] / 1e6
    vuln_df["fuentes_per_km2"] = vuln_df["fuentes"] / vuln_df["area_km2"]

    by_vul = vuln_df.groupby("vul_global").agg(
        n_barrios=("nombre", "count"),
        fuentes_mean=("fuentes", "mean"),
        urinarios_mean=("urinarios", "mean"),
        fuentes_per_km2_mean=("fuentes_per_km2", "mean"),
        sin_fuente=("fuentes", lambda s: (s == 0).sum()),
        sin_urinario=("urinarios", lambda s: (s == 0).sum()),
    )
    print(by_vul)

    # === 3. Cobertura demográfica: barrios con vulnerabilidad alta sin fuente ===
    print("\n=== Top barrios vulnerables SIN fuente ===")
    sin_fuente_vuln = vuln_df[
        (vuln_df["fuentes"] == 0) & (vuln_df["vul_global"].isin(["Vulnerabilidad Alta", "Vulnerabilidad Muy Alta"]))
    ].sort_values("ind_global", ascending=False)
    print(sin_fuente_vuln[["nombre", "vul_global", "ind_global", "fuentes", "urinarios"]].head(15))

    # === 4. Distancia media a la fuente más cercana, por barrio ===
    print("\n=== Distancia centroide-a-fuente más cercana por vulnerabilidad ===")
    centroids = vuln_metric.copy()
    centroids["geometry"] = centroids.geometry.centroid
    dist_to_fuente = gpd.sjoin_nearest(centroids[["nombre", "vul_global", "geometry"]], fuentes_m[["geometry"]], distance_col="dist_m")
    dist_summary = dist_to_fuente.groupby("vul_global")["dist_m"].agg(["mean", "median", "max"])
    print(dist_summary.round(1))

    # === 5. Cifra estrella candidata ===
    print("\n=== Posibles cifras estrella ===")
    total_vulnerables = vuln_df[vuln_df["vul_global"].isin(["Vulnerabilidad Alta", "Vulnerabilidad Muy Alta"])]
    sin_fuente_alta = total_vulnerables[total_vulnerables["fuentes"] == 0]
    pct_sin_fuente_alta = len(sin_fuente_alta) / max(len(total_vulnerables), 1) * 100
    print(f"· {len(sin_fuente_alta)}/{len(total_vulnerables)} barrios de vulnerabilidad alta o muy alta no tienen ninguna fuente pública ({pct_sin_fuente_alta:.0f}%)")
    print(f"· {(counts['urinarios']==0).sum()} de los {len(counts)} barrios de València no tienen ningún urinario público")
    print(f"· La distancia media al baño público desde el centroide del barrio es de {dist_to_fuente['dist_m'].mean():.0f} m")

    # === Persistir resultados ===
    out = {
        "totals": {
            "fuentes": int(len(fuentes)),
            "urinarios": int(len(urinarios)),
            "duchas": int(len(duchas)),
            "arbolado": int(len(arbolado)),
            "espais_verds": int(len(verdes)),
            "barrios": int(len(barrios)),
            "distritos": int(len(distritos)),
            "vuln_polygons": int(len(vuln)),
        },
        "barrios_sin_fuente": int((counts["fuentes"] == 0).sum()),
        "barrios_sin_urinario": int((counts["urinarios"] == 0).sum()),
        "by_vulnerability": by_vul.round(2).reset_index().to_dict(orient="records"),
        "top_underserved": sin_fuente_vuln[["nombre", "vul_global", "ind_global", "fuentes", "urinarios"]]
        .head(20)
        .to_dict(orient="records"),
        "distance_to_nearest_fuente_m": dist_summary.round(1).reset_index().to_dict(orient="records"),
        "headline_candidates": [
            f"{len(sin_fuente_alta)} de {len(total_vulnerables)} barrios con vulnerabilidad alta o muy alta no tienen ninguna fuente pública.",
            f"{int((counts['urinarios']==0).sum())} de los {len(counts)} barrios de València no tienen ningún urinario público.",
        ],
    }
    (DERIVED / "exploration.json").write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"\n✓ Guardado en {DERIVED / 'exploration.json'}")


if __name__ == "__main__":
    main()

"""
Análisis Día 2: distancias por manzana, densidad de arbolado y service deserts.

A diferencia de explore.py (Día 1), este script:
- Calcula distancia desde cada manzana (4.923) al servicio más cercano,
  no desde el centroide del barrio (mucho más fiel).
- Procesa el arbolado (186k árboles) en árboles/km² por barrio.
- Cruza vulnerabilidad demográfica × servicios × sombra para identificar
  barrios "service desert" (peor combinación de los tres).

Output: src/data/derived/exploration_v2.json
"""

from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SNAP = ROOT / "snapshots"
DERIVED = ROOT / "derived"
DERIVED.mkdir(exist_ok=True)

PROJECTED_CRS = "EPSG:25830"  # UTM 30N · metros
WGS84 = "EPSG:4326"


def load(name: str) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(SNAP / f"{name}.geojson")
    if gdf.crs is None:
        gdf = gdf.set_crs(WGS84)
    return gdf


def to_metric(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return gdf.to_crs(PROJECTED_CRS)


def main() -> None:
    print("Cargando datasets…")
    fuentes = to_metric(load("fonts-daigua-publica-fuentes-de-agua-publica"))
    urinarios = to_metric(load("urinaris-urinarios"))
    arbolado = to_metric(load("arbratge-arbolado"))
    espais = to_metric(load("espais-verds-espacios-verdes"))
    manzanas = to_metric(load("illes-amb-dades-de-poblacio-manzanas-con-datos-de-poblacion"))
    barrios = to_metric(load("barris-barrios"))
    vuln = to_metric(load("vulnerabilidad-por-barrios"))

    # Normalizar nombres
    barrios = barrios.rename(columns={c: c.lower() for c in barrios.columns})
    vuln = vuln.rename(columns={c: c.lower() for c in vuln.columns})

    print(
        f"manzanas={len(manzanas)} fuentes={len(fuentes)} urinarios={len(urinarios)} "
        f"arbolado={len(arbolado)} verdes={len(espais)} barrios={len(barrios)} vuln={len(vuln)}"
    )

    # === 1. Distancia desde cada manzana al servicio más cercano ===
    print("\n=== Distancias por manzana ===")
    manzanas["centroid"] = manzanas.geometry.centroid
    manzanas_pts = manzanas.set_geometry("centroid")

    d_fuente = gpd.sjoin_nearest(manzanas_pts[["refman", "centroid"]], fuentes[["geometry"]], distance_col="dist_m")
    d_fuente = d_fuente.groupby("refman")["dist_m"].min().rename("dist_fuente_m")

    d_urinario = gpd.sjoin_nearest(manzanas_pts[["refman", "centroid"]], urinarios[["geometry"]], distance_col="dist_m")
    d_urinario = d_urinario.groupby("refman")["dist_m"].min().rename("dist_urinario_m")

    d_verde = gpd.sjoin_nearest(manzanas_pts[["refman", "centroid"]], espais[["geometry"]], distance_col="dist_m")
    d_verde = d_verde.groupby("refman")["dist_m"].min().rename("dist_verde_m")

    dist_df = pd.concat([d_fuente, d_urinario, d_verde], axis=1)
    print(dist_df.describe().round(0))

    # 5 minutos caminando ≈ 400 m
    THRESHOLD_5MIN_M = 400
    pct_lejos_fuente = (dist_df["dist_fuente_m"] > THRESHOLD_5MIN_M).mean() * 100
    pct_lejos_urinario = (dist_df["dist_urinario_m"] > THRESHOLD_5MIN_M).mean() * 100
    pct_lejos_verde = (dist_df["dist_verde_m"] > THRESHOLD_5MIN_M).mean() * 100
    print(f"\nManzanas con servicio > 5 min caminando (400m):")
    print(f"  fuente:   {pct_lejos_fuente:5.1f}%")
    print(f"  urinario: {pct_lejos_urinario:5.1f}%")
    print(f"  parque:   {pct_lejos_verde:5.1f}%")

    # === 2. Arbolado por barrio (densidad) ===
    print("\n=== Sombra: árboles por barrio ===")
    arbolado_in_barrio = gpd.sjoin(
        arbolado[["geometry"]], barrios[["nombre", "geometry"]], how="inner", predicate="within"
    )
    arboles_per_barrio = arbolado_in_barrio.groupby("nombre").size().rename("arboles")
    barrios["area_km2"] = barrios.geometry.area / 1e6
    arb_df = pd.DataFrame({"nombre": barrios["nombre"], "area_km2": barrios["area_km2"]}).set_index("nombre")
    arb_df["arboles"] = arboles_per_barrio.reindex(arb_df.index, fill_value=0)
    arb_df["arboles_per_km2"] = arb_df["arboles"] / arb_df["area_km2"].replace({0: pd.NA})
    print("Top 10 más sombreados (árboles/km²):")
    print(arb_df.sort_values("arboles_per_km2", ascending=False).head(10).round(0))
    print("\nBottom 10 menos sombreados:")
    print(arb_df.sort_values("arboles_per_km2").head(10).round(0))

    # === 3. Service desert score por barrio ===
    print("\n=== Service deserts ===")
    # Manzanas → barrio (la manzana queda en el barrio donde está su centroide)
    manzana_barrio = gpd.sjoin(
        manzanas_pts[["refman", "centroid"]].set_geometry("centroid"),
        barrios[["nombre", "geometry"]],
        how="inner",
        predicate="within",
    )[["refman", "nombre"]]

    merged = manzana_barrio.merge(dist_df, on="refman")
    barrio_stats = merged.groupby("nombre").agg(
        manzanas=("refman", "count"),
        d_fuente_p50=("dist_fuente_m", "median"),
        d_urinario_p50=("dist_urinario_m", "median"),
        d_verde_p50=("dist_verde_m", "median"),
        pct_lejos_urinario=("dist_urinario_m", lambda s: (s > THRESHOLD_5MIN_M).mean() * 100),
        pct_lejos_fuente=("dist_fuente_m", lambda s: (s > THRESHOLD_5MIN_M).mean() * 100),
    )
    barrio_stats = barrio_stats.join(arb_df[["arboles_per_km2"]])
    barrio_stats = barrio_stats.round(0)

    # Cruzar con vulnerabilidad (vuln tiene 70 barrios — los 18 que faltan son rurales)
    vuln_lookup = vuln.set_index("nombre")[["vul_global", "ind_global", "ind_dem", "vul_dem"]]
    barrio_stats = barrio_stats.join(vuln_lookup, how="left")

    # Top peores barrios para personas mayores: lejos de urinario + poca sombra
    print("Top 10 barrios MÁS lejos del urinario (mediana de manzanas):")
    print(
        barrio_stats.sort_values("d_urinario_p50", ascending=False)
        .head(10)[["d_urinario_p50", "pct_lejos_urinario", "arboles_per_km2", "vul_dem"]]
    )

    print("\nTop 10 barrios con menos arbolado:")
    print(
        barrio_stats.sort_values("arboles_per_km2")
        .head(10)[["arboles_per_km2", "d_urinario_p50", "d_fuente_p50", "vul_dem"]]
    )

    # === 4. Cifras estrella ===
    print("\n=== Cifras estrella candidatas ===")
    total_barrios = len(barrio_stats)
    barrios_sin_urinario = (barrio_stats["d_urinario_p50"] > THRESHOLD_5MIN_M).sum()
    barrios_sin_fuente = (barrio_stats["d_fuente_p50"] > THRESHOLD_5MIN_M).sum()

    # Vulnerable demográficamente + lejos del urinario
    vuln_dem_alta = barrio_stats[barrio_stats["vul_dem"].isin(["Vulnerabilidad Alta", "Vulnerabilidad Muy Alta"])]
    vuln_lejos_urinario = vuln_dem_alta[vuln_dem_alta["d_urinario_p50"] > THRESHOLD_5MIN_M]

    print(f"· {barrios_sin_urinario} de {total_barrios} barrios tienen su manzana mediana a >5 min de un urinario público")
    print(f"· {barrios_sin_fuente} de {total_barrios} barrios tienen su manzana mediana a >5 min de una fuente")
    print(f"· {pct_lejos_urinario:.0f}% de las 4.923 manzanas de València están a >5 min caminando del urinario más cercano")
    print(f"· {pct_lejos_fuente:.0f}% de las manzanas están a >5 min de una fuente")
    print(f"· {len(vuln_lejos_urinario)}/{len(vuln_dem_alta)} barrios con vulnerabilidad demográfica alta están lejos del urinario")
    extreme_dist = dist_df["dist_urinario_m"].max()
    extreme_block = dist_df["dist_urinario_m"].idxmax()
    print(f"· La manzana más lejana del urinario (refman={extreme_block}) está a {extreme_dist:.0f} m")

    # === Persistir ===
    out = {
        "manzanas_analizadas": int(len(dist_df)),
        "umbral_5min_m": THRESHOLD_5MIN_M,
        "global": {
            "pct_manzanas_lejos_urinario": round(pct_lejos_urinario, 2),
            "pct_manzanas_lejos_fuente": round(pct_lejos_fuente, 2),
            "pct_manzanas_lejos_parque": round(pct_lejos_verde, 2),
            "max_dist_urinario_m": float(extreme_dist),
            "manzana_mas_lejana_refman": str(extreme_block),
        },
        "barrios_sin_urinario_5min": int(barrios_sin_urinario),
        "barrios_sin_fuente_5min": int(barrios_sin_fuente),
        "total_barrios": int(total_barrios),
        "barrio_stats": barrio_stats.reset_index().to_dict(orient="records"),
        "top_underserved_urinario": barrio_stats.sort_values("d_urinario_p50", ascending=False).head(10)
        .reset_index().to_dict(orient="records"),
        "top_sin_arbolado": arb_df.sort_values("arboles_per_km2").head(10).reset_index().to_dict(orient="records"),
    }
    (DERIVED / "exploration_v2.json").write_text(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    print(f"\n✓ {DERIVED / 'exploration_v2.json'}")


if __name__ == "__main__":
    main()

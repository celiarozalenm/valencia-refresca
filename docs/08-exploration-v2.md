# Día 2 — análisis fino por manzana

Output completo en [`src/data/derived/exploration_v2.json`](../src/data/derived/exploration_v2.json). Script en [`src/data/scripts/explore_v2.py`](../src/data/scripts/explore_v2.py).

## Qué cambia respecto a Día 1

- Se calcula la distancia desde cada **manzana catastral** (4.923 polígonos), no desde el centroide del barrio. Mucho más fiel a la experiencia real del peatón.
- Se procesan los **186.820 árboles** y se calcula densidad por barrio.
- Se identifican "service deserts" cruzando: distancia + arbolado + vulnerabilidad.

## El dataset de población que no existe

CKAN anuncia que `illa-de-cases-cadastrals-amb-dades-de-poblacio` incluye `Pob_0_14`, `Pob_15_65`, `Pob_66_mas`, `Pob_total`. Pero los GeoJSON/CSV publicados **solo contienen** `refman, hoja, coorx, coory`. Confirmado en los dos endpoints (REST 215 y 262) + CSV estático. El catálogo miente.

**Pivote:** usar `vulnerabilidad-por-barrios` (con `ind_dem`, `vul_dem`) como proxy demográfico.

## Cifra estrella elegida

> **1 de cada 4 manzanas de València está a más de 5 minutos del urinario público más cercano.**

Cifra base: 25,8% de las 4.923 manzanas (≈ 1.198 manzanas) tiene el urinario más cercano a >400 m (estándar urbanístico de 5 min caminando). Se eligió esta sobre las otras dos candidatas porque:
- Comprensión instantánea ("1 de cada 4")
- Funciona como titular sin necesidad de comparar dos números
- Empuja directo al mapa interactivo

Las otras dos candidatas se usan como refuerzo:
- #2 (asimetría 96% vs 74%) → primera sección del scroll, explica que el problema es específico de urinarios, no de fuentes
- #3 (cinturón pedáneo) → apertura del mapa, contextualiza geográficamente

## Cifras estrella candidatas — ranking actualizado

### 🥇 #1 — La asimetría del urinario
> **El 96% de las manzanas de València tiene una fuente de agua a menos de 5 minutos caminando. Solo el 74% tiene un urinario público.**

Por qué funciona:
- Mismo denominador (manzanas), comparación directa
- Es un dato sobre la **misma necesidad humana** (refrescarte ↔ poder ir al baño después)
- 4× más fácil que falle el urinario que la fuente, en una ciudad con calor extremo

### 🥈 #2 — El cuarto que está lejos
> **1 de cada 4 manzanas de València está a más de 5 minutos del urinario público más cercano.**

Por qué funciona:
- Cifra redonda (25,8% real)
- "5 minutos" es el estándar urbanístico clásico
- Pide mapa inmediato — fácil visualización

### 🥉 #3 — Cinturón pedáneo
> **Las 10 manzanas más lejanas del urinario público están todas en pedanías. La peor, en Mahuella, a 3.935 m.**

Por qué funciona:
- Geografía evocadora
- Apunta a un problema **estructural** (cinturón rural)
- Pinta un mapa muy claro: ciudad servida + cinturón olvidado

## Plot twist (importante para la narrativa)

**La pobreza urbana NO se correlaciona con la falta de servicios.**
- 0 de los 10 barrios con vulnerabilidad demográfica alta están lejos del urinario
- Los barrios "vulnerables" céntricos (Cabanyal, Velluters, Russafa) están bien servidos
- Los **service deserts** son las pedanías rurales: Mahuella-Tauladella, El Saler, El Palmar, Borboto, Benifaraig, Poble Nou

Esto rompe la narrativa fácil "el Ayuntamiento abandona a los vulnerables". La historia real es más matizada y más interesante: **València se diseñó como ciudad densa + cinturón rural disperso, y el cinturón quedó fuera del estándar urbano de servicios.**

## Sombra: brecha brutal

| Barrio | Árboles/km² | Tipo |
|---|---|---|
| TRINITAT | 11.273 | Centro denso |
| CIUTAT JARDI | 10.712 | Centro denso |
| MARXALENES | 8.766 | Ensanche |
| ... | ... | ... |
| RAFALELL-VISTABELLA | 0 | Pedanía |
| EL PALMAR | 5 | Pedanía |
| MAHUELLA-TAULADELLA | 23 | Pedanía |
| EL SALER | 32 | Pedanía/turística |

> Diferencia de **2.000×** entre el barrio más arbolado y el menos arbolado.

(Nota: las pedanías incluyen mucho suelo no urbano — campo, marjal — que tira el ratio por km² muy abajo. Hay que matizar la cifra usando "suelo urbano" no área total. Pendiente Día 3.)

## Limitaciones aún vigentes

- **Sin población real por manzana**, no podemos decir "X habitantes están afectados". Solo "X manzanas".
- **Distancia geométrica (línea recta), no caminando.** En una ciudad con barranco, río, vías de tren, la distancia real al servicio es mayor. Habría que rutear por la red peatonal (overpass turbo + OSRM) — overkill para 19 días.
- **Pedanías agrandan el área por km²** — para la cifra de sombra hay que filtrar por suelo urbano consolidado.

## Decisión pendiente

Cifra estrella ganadora a elegir entre:
- **#1 (asimetría fuente vs urinario)** — la que mejor cuenta UNA historia
- **#2 (1 de cada 4)** — la más viral
- **#3 (pedanías)** — la más geográfica

**Recomendación:** combinarlas en el hero del microsite (#1 como titular, #2 como subtítulo, #3 como apertura del scroll).

## Siguiente (Día 3)

- [ ] Cerrar nombre y dominio (provisional: `valencia-refresca`)
- [ ] Diseñar el guion narrativo: hero → mapa interactivo → secciones de hallazgos → metodología → llamada
- [ ] Filtrar sombra por suelo urbano (excluir marjal de El Saler, etc.)
- [ ] Validar las cifras con un par de fuentes secundarias (artículos, OMS sobre `urinarios por habitante`)

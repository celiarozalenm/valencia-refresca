# Análisis exploratorio — Día 1 (21 mayo 2026)

Output completo de números en [`src/data/derived/exploration.json`](../src/data/derived/exploration.json). Script en [`src/data/scripts/explore.py`](../src/data/scripts/explore.py).

## Totales descargados

| Dataset | Features |
|---|---|
| Fuentes de agua | 832 |
| Urinarios | 230 |
| Duchas de playa | 71 |
| Lavapiés de playa | 55 |
| Arbolado | 186.820 |
| Espacios verdes | 807 |
| Barrios | 88 |
| Distritos | 22 |
| Vulnerabilidad por barrios (2021) | 70 polígonos |

> Nota: el dataset de vulnerabilidad solo cubre **70 barrios** de los 88 oficiales. Falta cruzar para entender qué barrios quedan fuera (probablemente rurales periféricos como Rafalell-Vistabella, El Calvari).

## Hallazgos clave

### 1. El problema NO son las fuentes — son los urinarios

- **3 barrios sin ninguna fuente** (Rafalell-Vistabella, El Calvari, Jaume Roig). Todos rurales/periféricos.
- **25 de 88 barrios (28%) sin ningún urinario público**. Aquí está el déficit estructural.
- València tiene **3,6 veces más fuentes que urinarios** (832 vs 230).

### 2. La cobertura NO se correlaciona con vulnerabilidad (sorpresa)

Distancia media del centroide del barrio al servicio más cercano:

| Vulnerabilidad | Distancia media a fuente | Distancia media a urinario |
|---|---|---|
| Alta | 128 m | (calcular) |
| Media | 99 m | (calcular) |
| Baja | 188 m | (calcular) |

Los barrios de **vulnerabilidad baja** son los que están MÁS lejos del servicio más cercano (no los vulnerables). Tiene lógica urbana: los barrios "ricos" suelen ser periféricos y de baja densidad. Esto rompe la narrativa fácil de "el ayuntamiento abandona a los vulnerables".

### 3. Distribución muy desigual entre barrios

Ejemplos extremos de urinarios:
- **LA GRAN VIA: 19 urinarios** (8% de los 230 totales en un solo barrio)
- **LA ROQUETA: 8 urinarios**
- **EL PILAR: 6 urinarios**
- 25 barrios con 0

Los 230 urinarios se concentran en barrios céntricos turísticos. Los barrios residenciales periféricos quedan fuera.

## Posibles cifras estrella (a validar)

Ordenadas por potencia narrativa:

1. **"1 de cada 4 barrios de València no tiene ni un solo urinario público"** — equity angle, fácil de visualizar en mapa, números redondos.
2. **"Hay 19 urinarios en La Gran Vía y 0 en 25 barrios"** — desigualdad cruda, contraste visual brutal.
3. **"Tres barrios de València se quedan sin ninguna fuente de agua potable: Rafalell-Vistabella, El Calvari y Jaume Roig"** — específico, geográficamente evocador.

## Limitaciones del análisis actual

- Las distancias se miden desde el **centroide del barrio**, no desde la población real. En barrios rurales con población dispersa la cifra puede mentir (centroide en campo, casas a 1 km del centroide).
- **No se ha cruzado con población mayor** por barrio — la demografía vulnerable al calor (>65 años) no está mapeada todavía.
- El **arbolado (186k puntos)** no se ha procesado aún. Posible cifra: "X barrios con menos de Y árboles per cápita" o "el barrio más sombreado tiene 50× más árboles que el menos sombreado".
- No se incluye el factor **uso real**: una fuente puede existir pero estar averiada (no hay dataset de mantenimiento).

## Siguientes pasos (Día 2)

1. Bajar dataset de **población por sección censal** (incluir mayores >65 años)
2. Calcular **distancia mínima desde cada manzana habitada** (no centroide) al servicio más cercano
3. Procesar arbolado: densidad por barrio + cifra estrella de sombra
4. Decidir cifra estrella final entre los candidatos
5. Si ninguna candidata es lo bastante fuerte → pivotar (siguiendo plan original)

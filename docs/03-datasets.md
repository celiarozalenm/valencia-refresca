# Datasets del Portal de Datos Abiertos del Ajuntament de València

API base CKAN: https://opendata.vlci.valencia.es/api/3/action/

## Datasets a usar en este proyecto

### Capa principal: servicios de alivio térmico

| Dataset | ID | Fuente |
|---|---|---|
| Urinarios públicos | `urinaris-urinarios` | Geoportal MapServer/217 |
| Fuentes de agua pública | `fonts-daigua-publica-fuentes-de-agua-publica` | Geoportal |
| Arbolado urbano (sombra) | `arbratge-arbolado` | Geoportal |
| Arbolado protegido municipal | `arbratge-protegit-municipal-arbolado-protegido-municipal` | Geoportal |
| Espacios verdes | `espais-verds-espacios-verdes` | Geoportal |
| Duchas de playa | `dutxes-platja-duchas-playa` | Geoportal |
| Lavapiés de playa | `llavapeus-platges-lavapies-playas` | Geoportal |

### Capa accesibilidad

| Dataset | ID |
|---|---|
| Aparcamientos personas movilidad reducida | `aparcaments-persones-mobilitat-reduida-aparcamientos-personas-movilidad-reducida` |
| Bancos en vía pública | `bancs-en-via-publica-bancos-en-via-publica` |
| Zonas de movilidad reducida | `zones-mobilitat-reduida-zonas-mobilidad-reducida` |
| Rutas accesibles jardín Turia | `rutas-accesibles-jardin-turia` |

### Capa contexto urbano

| Dataset | ID |
|---|---|
| Barrios | `barris-barrios` |
| Distritos | `districtes-distritos` |
| Vulnerabilidad por barrios | `vulnerabilidad-por-barrios` |
| Secciones censales | `seccions-censals-secciones-censales` |
| Manzanas con datos de población | `illes-amb-dades-de-poblacio-manzanas-con-datos-de-poblacion` |

### Datos demográficos (para cruzar)

A explorar al inicio del análisis. Probablemente desde `seccions-censals` o `illes-amb-dades-de-poblacio` para densidad de mayores por barrio/manzana.

### Otros relevantes (a explorar)

- `papereres-papeleras` (papeleras)
- `bancs-en-via-publica` (bancos)
- `pipicans-zona-socialitzacio-canina-pipicanes-zona-socializacion-canina` (perros — Celia descartó este tema, ya hizo Madrid)
- `mapa-soroll-24h-mapa-ruido-24h` (ruido — alternativa si pivotamos)

## Cómo descargar un dataset

### Vía CKAN API (metadata)
```sh
curl "https://opendata.vlci.valencia.es/api/3/action/package_show?id=urinaris-urinarios"
```

### Vía Geoportal (datos reales en GeoJSON)
```sh
curl "https://geoportal.valencia.es/server/rest/services/OPENDATA/Turismo/MapServer/217/query?where=1=1&outFields=*&f=geojson" -o data/urinarios.geojson
```

⚠️ El Geoportal puede dar timeout desde fuera de España. Conviene descargar los snapshots durante la sesión inicial y cachearlos en `src/data/snapshots/`.

## Estructura local sugerida

```
src/data/
├── snapshots/        # GeoJSONs descargados
│   ├── urinarios.geojson
│   ├── fuentes.geojson
│   └── ...
├── scripts/          # scripts de descarga/transformación
│   └── fetch-datasets.ts
└── derived/          # datos procesados (ej. distancia mínima por barrio)
```

## Licencia de los datos

Atribución requerida: "Ajuntament de València – Portal de Datos Abiertos"

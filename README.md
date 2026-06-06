# València Refresca

> **Agua. Sombra. Respiramos.**
> Dónde refrescarte cuando València arde.

🌐 **[valencia-refresca.vercel.app](https://valencia-refresca.vercel.app)**

Mapa interactivo que cruza los servicios públicos de alivio térmico de València · fuentes de agua, urinarios, sombra de arbolado, espacios verdes, duchas de playa · con la **vulnerabilidad demográfica de cada barrio**.

Pieza candidata a los [Premios Datos Abiertos València 2026](https://www.valencia.es/cas/campa%C3%B1as-municipales/-/content/premios-proyectos-datos-abiertos-periodismo-datos-2025) (categoría Datos Abiertos).

---

## La cifra estrella

> **1 de cada 4 manzanas de València está a más de 5 minutos caminando del urinario público más cercano.**

Y un dato anti-intuitivo que apareció al cruzar los datos:

> **Los barrios oficialmente vulnerables NO son los peor servidos.** El verdadero déficit está en el cinturón de pedanías rurales · Mahuella, El Saler, El Palmar, Borboto, Benifaraig.

Detalles en [`docs/08-exploration-v2.md`](./docs/08-exploration-v2.md).

## Por qué importa

Las olas de calor son la primera causa climática de muerte en España. València vive su décimo verano consecutivo con temperaturas por encima de los 40 °C. Mientras los hospitales aprenden a actuar, falta una herramienta ciudadana que muestre, calle por calle, los **servicios de alivio térmico** disponibles y los **desiertos** donde no hay.

València Refresca es esa herramienta. Útil para vecinas, mayores, familias con niños, embarazadas, personas que trabajan en la calle, sanitarias, urbanistas y periodistas.

## Datos utilizados

Todos del [Portal de Datos Abiertos del Ajuntament de València](https://opendata.vlci.valencia.es) · 12 datasets:

| Dataset | Features |
|---|---|
| Urinarios públicos | 230 |
| Fuentes de agua pública | 832 |
| Arbolado urbano | 186.820 |
| Espacios verdes | 807 |
| Duchas de playa | 71 |
| Lavapiés de playa | 55 |
| Barrios | 88 |
| Distritos | 22 |
| Vulnerabilidad por barrios 2021 | 70 |
| Manzanas catastrales × 2 | 4.913 + 4.923 |
| Secciones censales | 593 |

Los snapshots se refrescan **automáticamente cada lunes** vía GitHub Actions (ver [`.github/workflows/fetch-datasets.yml`](./.github/workflows/fetch-datasets.yml)).

## Stack

- **[Astro](https://astro.build)** · framework
- **[React](https://react.dev) 19** · islas interactivas (mapa)
- **[Tailwind CSS](https://tailwindcss.com) v4** · estilos
- **[MapLibre GL JS](https://maplibre.org)** · mapa (open source, sin API key)
- **[CartoDB Positron](https://carto.com/basemaps)** · tiles base
- **Python + geopandas + shapely** · análisis geoespacial
- **Vercel** · hosting

Toda la cadena es **open source y sin coste operativo** (0 €/año).

## Cómo está organizado

```
.
├── .github/workflows/      # GitHub Action: refresco semanal de snapshots
├── public/
│   └── data/               # GeoJSONs servidos al cliente
├── src/
│   ├── components/         # Astro + React
│   ├── data/
│   │   ├── derived/        # análisis ya procesado
│   │   ├── scripts/        # fetch y exploración
│   │   └── snapshots/      # GeoJSON crudos del Portal
│   ├── layouts/
│   ├── pages/
│   └── styles/
└── astro.config.mjs
```

## Cómo correrlo en local

```sh
npm install
npm run dev
```

Servidor en `http://localhost:4321`.

### Refrescar los datos

```sh
npm run fetch-data            # baja los snapshots desde el Portal
python3 src/data/scripts/explore_v2.py   # re-corre el análisis
```

> Nota: el geoportal del Ajuntament puede dar timeout desde fuera de la UE. En ese caso, dispara el workflow de GitHub Actions desde la pestaña Actions del repo · corre en infraestructura europea y commitea los snapshots al repo.

## Hallazgos clave

- **832 fuentes** vs **230 urinarios** · asimetría 3,6× en una infraestructura igual de necesaria con calor extremo.
- **El 96% de las manzanas** tiene una fuente a menos de 5 min. **Solo el 74%** tiene un urinario.
- **Brecha 2.000×** entre el barrio más arbolado (Trinitat, 11.273 árboles/km²) y el menos (El Palmar, 5/km²).
- La cobertura de servicios **NO se correlaciona con vulnerabilidad demográfica**. Los servicios están concentrados en el centro histórico-turístico; el cinturón rural queda fuera.

Detalles, datos y metodología en [`docs/08-exploration-v2.md`](./docs/08-exploration-v2.md).

## Roadmap

- App móvil nativa (Q3 2026 si hay tracción)
- Modo "ruta refrescante": el usuario indica origen y destino y el mapa propone la ruta con más sombra y servicios en el camino
- Plantilla reutilizable para otras ciudades mediterráneas (Sevilla, Murcia, Málaga, Alicante)

## Licencia

- **Código:** [MIT](./LICENSE)
- **Datos:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.es) · Atribución a *Ajuntament de València – Portal de Datos Abiertos*

## Autora

[Celia Rozalén](https://celiarozalenm.com) · `hello@celiarozalenm.com`

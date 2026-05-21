# València Refresca

> Dónde refrescarte cuando València arde.

Mapa interactivo que cruza la red de servicios públicos de alivio térmico (fuentes de agua, urinarios, sombra de arbolado, duchas de playa, accesibilidad) con la vulnerabilidad de cada barrio, para responder a una pregunta sencilla: **¿la València más vulnerable tiene la misma infraestructura para sobrevivir al calor que la València privilegiada?**

Construido con datos abiertos del Ajuntament de València.

## Por qué existe

Las olas de calor son la primera causa climática de muerte en España. Mientras los hospitales aprenden a actuar, falta una herramienta ciudadana sencilla que muestre, calle por calle, los **servicios de alivio térmico** disponibles y los **desiertos** donde no hay.

València Refresca quiere ser esa herramienta. Útil para vecinos, mayores, familias con niños, trabajadores de calle, profesionales sanitarios, urbanistas y periodistas.

## Datos

Todas las capas provienen del [Portal de Datos Abiertos del Ajuntament de València](https://opendata.vlci.valencia.es):

- `urinaris-urinarios` — urinarios públicos
- `fonts-daigua-publica` — fuentes de agua pública
- `arbratge-arbolado` — arbolado urbano (sombra)
- `dutxes-platja-duchas-playa` — duchas de playa
- `llavapeus-platges-lavapies-playas` — lavapiés
- `aparcaments-persones-mobilitat-reduida` — accesibilidad
- `barris-barrios` — divisiones administrativas
- `vulnerabilidad-por-barrios` — índice de vulnerabilidad
- `bancs-en-via-publica` — bancos públicos
- `papereres-papeleras` — papeleras

## Stack

- [Astro](https://astro.build) — framework principal
- [Tailwind CSS](https://tailwindcss.com) — estilos
- [React](https://react.dev) — islas interactivas
- [MapLibre GL JS](https://maplibre.org) — mapa interactivo (open source, sin API key)

## Desarrollo local

```sh
npm install
npm run dev
```

Servidor en `http://localhost:4321`.

## Estructura

```
src/
├── pages/        # rutas
├── components/   # componentes Astro + React
├── data/         # snapshots de datasets + scripts de descarga
├── styles/       # estilos globales
└── content/      # textos / narrativa
```

## Licencia

- **Código:** MIT
- **Datos:** atribución al Ajuntament de València según licencia del portal abierto

## Sobre el proyecto

Pieza para los [Premios para proyectos de datos abiertos y periodismo de datos 2026](https://www.valencia.es/cas/campa%C3%B1as-municipales/-/content/premios-proyectos-datos-abiertos-periodismo-datos-2025) (categoría Datos Abiertos).

Autora: [Celia Rozalén](https://celiarozalenm.com)

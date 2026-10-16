// MapLibre GL JS 6 ships as an ES module only (no window global). Pages load this
// module and the rest of the site reads window.maplibregl, as before.
import * as maplibregl from 'https://unpkg.com/maplibre-gl@6.14.0/dist/maplibre-gl.mjs';
window.maplibregl = maplibregl;

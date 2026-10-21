// MapLibre GL JS 6 ships as an ES module only (no window global). Pages load this module
// and the rest of the site reads window.maplibregl, as before. The library is served from
// this site (vendor/, copied from the npm 6.14.0 tarball) so its worker is same-origin.
import * as maplibregl from './vendor/maplibre-gl-6.14.0/maplibre-gl.mjs';
window.maplibregl = maplibregl;

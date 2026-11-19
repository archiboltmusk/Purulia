const svgNamespace = 'http://www.w3.org/2000/svg';
const india = [65, 5, 100, 39];

function element(name, attributes) {
  const node = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

export function createFallback(container, boundaries) {
  const svg = element('svg', { role: 'img', 'aria-label': 'India and regional observations', preserveAspectRatio: 'xMidYMid meet' });
  const outlines = element('g', { fill: '#243c4d', stroke: '#7593a4', 'stroke-width': '.08' });
  svg.append(outlines);
  const notice = document.createElement('p');
  notice.className = 'fallback-notice';
  notice.textContent = '2D map · OpenStreetMap tiles require WebGL2. Use district search to zoom.';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset map view';
  const caption = document.createElement('div');
  caption.className = 'fallback-caption';
  caption.append(notice, reset);
  container.append(svg, caption);
  const groups = new globalThis.Map();
  const sources = new globalThis.Map();
  function fitBounds([west, south, east, north]) {
    const padding = Math.max(east - west, north - south) * 0.1;
    svg.setAttribute('viewBox', [west - padding, -north - padding, east - west + padding * 2, north - south + padding * 2].join(' '));
    svg.style.setProperty('--marker-size', Math.max(east - west, north - south) * 0.008 + 'px');
  }
  reset.addEventListener('click', () => fitBounds(india));
  fitBounds(india);
  boundaries.then(({ features }) => {
    for (const feature of features) {
      const { type, coordinates } = feature.geometry;
      const polygons = type === 'MultiPolygon' ? coordinates : [coordinates];
      const path = polygons.flat().map((ring) =>
        ring.map(([lng, lat], i) => (i === 0 ? 'M' : 'L') + lng + ',' + -lat).join('') + 'Z').join('');
      outlines.append(element('path', { d: path, 'fill-rule': 'evenodd' }));
    }
    notice.textContent = '2D map · LGD state outlines via india-geodata (CC0). Use district search to zoom.';
  }).catch(() => { notice.textContent = '2D map · State outlines unavailable.'; });
  return {
    fitBounds,
    addSource(id) {
      sources.set(id, { setData(data) {
        const markers = data.features.map((feature) => {
          const [lng, lat] = feature.geometry.coordinates;
          const marker = element('circle', { cx: lng, cy: -lat, class: 'fallback-marker' });
          const title = element('title', {});
          const { label, mag, observed, note } = feature.properties;
          title.textContent = [label, Number.isFinite(mag) ? 'Magnitude ' + mag : '', observed, note].filter(Boolean).join(' · ');
          marker.append(title);
          return marker;
        });
        groups.get(id).replaceChildren(...markers);
      } });
    },
    getSource(id) { return sources.get(id); },
    addLayer({ id, paint }) {
      const group = element('g', { fill: paint['circle-color'] });
      groups.set(id, group);
      svg.append(group);
    },
    setLayoutProperty(id, property, value) {
      if (property === 'visibility') groups.get(id).setAttribute('visibility', value);
    }
  };
}

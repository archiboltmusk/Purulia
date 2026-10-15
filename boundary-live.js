/* Live border changes. A moderator-approved fix to a Purulia ward replaces that ward's outline from
   purulia_wards.geojson. kasa_boundary_live(fix_of) lists the newest live outline per ward; kasa_boundary_history
   lists what changed, when and from which source. window.BoundaryLive.rows(fixOf, client) · .apply(geo, rows) ·
   .note(history, ward) returns a line for the public page. */
(function(){
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.BoundaryLive = {
    async rows(fixOf, client){
      try { const { data } = await client.rpc('kasa_boundary_live', { p_fix_of: fixOf }); return Array.isArray(data) ? data : []; }
      catch (e) { return []; }
    },
    async history(fixOf, client){
      try { const { data } = await client.rpc('kasa_boundary_history', { p_fix_of: fixOf }); return Array.isArray(data) ? data : []; }
      catch (e) { return []; }
    },
    apply(geo, rows){
      if (!geo || !Array.isArray(geo.features)) return geo;
      for (const r of rows || []) {
        const f = geo.features.find(x => Number(x.properties?.ward) === Number(r.ward));
        if (f) f.geometry = { type: 'MultiPolygon', coordinates: r.polygons };
        else geo.features.push({ type: 'Feature', properties: { ward: r.ward }, geometry: { type: 'MultiPolygon', coordinates: r.polygons } });
      }
      return geo;
    },
    note(history, ward){
      const mine = (history || []).filter(h => ward == null || Number(h.ward) === Number(ward));
      if (!mine.length) return '';
      return mine.map(h => `Ward ${esc(h.ward)} border changed on ${esc(h.applied_on)} from ${esc(h.source)}`
        + (h.rolled_back_on ? `, rolled back on ${esc(h.rolled_back_on)}` : '') + '.').join(' ');
    }
  };
})();

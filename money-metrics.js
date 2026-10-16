/* Tax and spending figures shared by money.html (table) and the report map's money layers
 * (map-layers.js). Same definitions everywhere: a state or seat with no figure is null. */
(() => {
  const LAYERS = {
    selfPaid: { label: 'Own taxes as % of spending', unit: '%', note: 'RBI, 2022-23 accounts: the state’s own tax revenue ÷ (revenue + capital expenditure).' },
    unspent: { label: 'Budget left unspent', unit: '%', note: 'CAG State Finances Audit Report: savings as a share of the budget provision.' },
    ucs: { label: 'Grants with no proof of use', unit: 'cr', note: 'CAG State Finances Audit Report: utilisation certificates not received, ₹ crore, as of the date in the report.' },
    mplads: { label: 'MP fund spent (Lok Sabha)', unit: '%', note: 'MPLADS, sitting Lok Sabha MPs: amount spent ÷ amount allocated so far this term.' },
    seats: { label: 'MP fund spent by seat (West Bengal)', unit: '%', note: 'MPLADS per Lok Sabha seat, drawn on its assembly segments: spent ÷ allocated so far.' },
  };

  const fig = (D, s, k) => ((D.audit[s] || {}).figures || []).find(f => f.k === k);

  function metric(D, s, k) {
    const r = D.rbi.states[s];
    if (k === 'selfPaid') return r && r.ownTax != null && r.revExp && r.capExp != null ? 100 * r.ownTax / (r.revExp + r.capExp) : null;
    if (k === 'unspent') { const f = fig(D, s, 'budget_unspent'); return f ? f.pct : null; }
    if (k === 'ucs') { const f = fig(D, s, 'ucs_pending'); return f ? f.crore : null; }
    if (k === 'mplads') { const m = (D.mplads.states[s] || {}).ls; return m && m.allocated ? 100 * m.spent / m.allocated : null; }
    return null;
  }

  // Seat share of its MP fund spent (MP = places/wb_mplads.json, keyed by pc number).
  function seatPct(MP, pc) { const r = MP.pc[pc]; return r && r.allocated ? 100 * r.spent / r.allocated : null; }

  // Five steps of one hue: darker = more. For "own taxes" more is better, for the rest less is.
  const RAMP = ['#f3dcae', '#e8b665', '#DD3333', '#a35f12', '#6b3a05'];
  function color(v, vals) {
    if (v == null) return null;
    const s = vals.filter(x => x != null).sort((a, b) => a - b);
    const i = s.length < 2 ? 4 : Math.min(4, Math.floor(5 * s.indexOf(v) / s.length));
    return RAMP[i];
  }

  window.MoneyMetrics = { LAYERS, fig, metric, seatPct, RAMP, color };
})();

const upstream = 'https://adiram.me/api/v1/';
const routes = new Map(Object.entries({
  works: 'q purpose year state offset limit',
  'map/assets': 'bbox q kind mode offset cells',
  'map/works': 'bbox q purpose year state mode offset',
  areas: 'state parent',
  'areas/search': 'q',
  funding: 'year measure purpose basis estimate offset programme',
  development: 'year measure purpose origin estimate basis',
  aggregates: 'measure',
  coverage: '',
  geography: '',
  ingestion: '',
  spending: '',
  'evidence-progress': '',
  'jurisdiction-evidence': '',
  'funding/coverage': '',
}));
const detailRoute = /^(?:assets\/[a-f0-9]{20}:\d+(?:\/projects)?|works\/[a-zA-Z0-9_-]{1,100}(?:\/timeline)?|(?:funding\/(?:states|programmes)|development\/(?:areas|programmes)|parties)\/[a-zA-Z0-9_:-]{1,100})$/;

export default {
  async fetch(request) {
    const headers = new Headers({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    if (request.headers.get('Origin') === 'https://archiboltmusk.github.io') {
      headers.set('Access-Control-Allow-Origin', 'https://archiboltmusk.github.io');
    }
    headers.set('Vary', 'Origin');
    const error = (message, status) => Response.json({ error: message }, { status, headers });
    if (request.method !== 'GET') return error('Use GET for public records.', 405);

    const { searchParams } = new URL(request.url);
    const route = searchParams.get('feed') || '';
    if (!routes.has(route) && !detailRoute.test(route)) return error('Unknown public feed.', 400);

    const target = new URL(route, upstream);
    const keys = (routes.get(route) ?? 'year measure purpose basis estimate origin offset programme').split(' ');
    for (const [key, value] of searchParams) {
      if (key === 'feed') continue;
      if (!key || !keys.includes(key) || value.length > 200 || target.searchParams.has(key)) {
        return error('Invalid feed parameters.', 400);
      }
      if (value) target.searchParams.set(key, value);
    }

    try {
      const source = await fetch(target, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
      });
      if (!source.ok) return error('Hisaab could not provide this record.', source.status);
      if (!source.headers.get('Content-Type')?.startsWith('application/json')) {
        return error('Unexpected Hisaab response.', 502);
      }
      headers.set('Content-Type', 'application/json; charset=utf-8');
      return new Response(source.body, { headers });
    } catch {
      return error('The Hisaab feed is temporarily unavailable.', 502);
    }
  },
};

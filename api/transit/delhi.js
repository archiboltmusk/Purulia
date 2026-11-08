// Vercel Node function. No API key or upstream errors are sent to the browser.
let handler;
module.exports = async function delhi(req, res) {
  try {
    handler ||= import('../../server/delhi-otd.mjs').then(m => m.createDelhiHandler());
    const handle = await handler;
    const response = await handle(new Request('https://parishkar.invalid' + req.url, { method: req.method }), process.env);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await response.text());
  } catch (_) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ schema_version: 1, status: 'adapter_unavailable', positions: [] }));
  }
};

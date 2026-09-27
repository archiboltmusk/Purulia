// Supabase Edge Function: daily news links for promises.html
//
// Once a day (pg_cron job 'kasa-promise-news', see 20260927130000_kasa_promises.sql) this reads
// free Google News RSS searches about Purulia and about everyone with a published promise, and
// stores the headlines with their links. It only collects links: it never publishes a promise or
// changes a promise's status. Moderators can hide a headline from admin.html.
//
// Deploy:  supabase functions deploy kasa-promise-news
// Secrets: none (uses the built-in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY). No paid API.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Fixed searches; every promise-maker's name is added at run time.
const TOPICS: [string, string][] = [
  ['Purulia municipality', 'en'],
  ['Purulia district development', 'en'],
  ['Purulia MLA', 'en'],
  ['Purulia MP', 'en'],
  ['Purulia project inaugurated', 'en'],
  ['পুরুলিয়া পুরসভা', 'bn'],
  ['পুরুলিয়া উন্নয়ন', 'bn'],
  ['पुरुलिया', 'hi'],
];

// A headline is kept only if it names Purulia or a promise-maker; search engines match loosely.
const PLACE = ['purulia', 'পুরুলিয়া', 'पुरुलिया', 'raghunathpur', 'jhalda', 'manbazar'];

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&')
  .trim();

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : '';
};

interface Item { url: string; title: string; source: string; published_at: string | null; topic: string }

async function search(query: string, lang: string): Promise<Item[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + ' when:30d')}` +
    (lang === 'bn' ? '&hl=bn&gl=IN&ceid=IN:bn' : lang === 'hi' ? '&hl=hi&gl=IN&ceid=IN:hi' : '&hl=en-IN&gl=IN&ceid=IN:en');
  const res = await fetch(url, { headers: { 'User-Agent': 'ParishkarPurulia/1.0 (+https://archiboltmusk.github.io/Purulia/promises.html)' } });
  if (!res.ok) throw new Error(`${query}: HTTP ${res.status}`);
  const xml = await res.text();
  const items: Item[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const source = tag(block, 'source');
    let title = tag(block, 'title');
    // Google appends " - Source name" to every title.
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const link = tag(block, 'link');
    const pub = tag(block, 'pubDate');
    const d = pub ? new Date(pub) : null;
    if (!link.startsWith('http') || !title) continue;
    items.push({ url: link, title, source, published_at: d && !isNaN(+d) ? d.toISOString() : null, topic: query });
    if (items.length >= 20) break;
  }
  return items;
}

Deno.serve(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: people } = await admin.rpc('kasa_promise_people');
  const topics = [...TOPICS];
  for (const who of (people as string[] | null) ?? []) topics.push([`"${who}" Purulia`, 'en']);

  const all: Item[] = [];
  const errors: string[] = [];
  for (const [q, lang] of topics.slice(0, 40)) {
    try { all.push(...await search(q, lang)); }
    catch (e) { errors.push(String(e instanceof Error ? e.message : e)); }
    await new Promise(r => setTimeout(r, 400)); // be polite to the feed
  }

  const names = ((people as string[] | null) ?? []).map(n => n.toLowerCase());
  const relevant = (t: string) => { const l = t.toLowerCase(); return PLACE.some(k => l.includes(k)) || names.some(n => l.includes(n)); };
  const seen = new Set<string>();
  const items = all.filter(i => relevant(i.title) && !seen.has(i.url) && seen.add(i.url));
  const { data: added, error } = await admin.rpc('kasa_promise_news_ingest', { p_items: items });
  if (error) return reply(500, { error: error.message, errors });
  return reply(200, { searched: topics.length, found: items.length, added, errors });
});

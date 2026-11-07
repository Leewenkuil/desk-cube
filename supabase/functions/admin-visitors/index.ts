// Desk Cube: visitor numbers from Cloudflare Web Analytics for the Admin panel.
// The read-only Cloudflare token stays here on the server as a secret, and only people in the private
// admins list get an answer. Secrets to set in Supabase: CF_API_TOKEN and CF_ACCOUNT_ID.

const SITE = 'deskcube.app';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Asks the database, as the person calling, whether they're an admin.
async function isAdmin(req) {
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: { Authorization: auth, apikey: req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '', 'Content-Type': 'application/json' },
    body: '{}',
  });
  return res.ok && (await res.json()) === true;
}

const dayText = d => d.toISOString().slice(0, 10);

// One Cloudflare query for one stretch of days, split up by day, where people came from, country and device.
async function fetchWindow(token, account, from, to) {
  const filter = `{ AND: [{ datetime_geq: "${from}", datetime_leq: "${to}" }, { requestHost: "${SITE}" }] }`;
  const group = (name, dimension, limit) => `${name}: rumPageloadEventsAdaptiveGroups(filter: ${filter}, limit: ${limit}, orderBy: [count_DESC]) { count sum { visits } dimensions { metric: ${dimension} } }`;
  const query = `{ viewer { accounts(filter: { accountTag: "${account}" }) {
    byDay: rumPageloadEventsAdaptiveGroups(filter: ${filter}, limit: 100, orderBy: [date_ASC]) { count sum { visits } dimensions { metric: date } }
    ${group('referers', 'refererHost', 25)}
    ${group('countries', 'countryName', 25)}
    ${group('devices', 'deviceType', 10)}
  } } }`;
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || (json.errors && json.errors.length)) throw new Error((json && json.errors && json.errors[0] && json.errors[0].message) || `Cloudflare answered ${res.status}`);
  const row = json.data && json.data.viewer && json.data.viewer.accounts && json.data.viewer.accounts[0];
  if (!row) throw new Error('Cloudflare returned no account: check CF_ACCOUNT_ID');
  return row;
}

function addUp(map, rows) {
  for (const r of rows || []) {
    const name = r.dimensions.metric || '';
    const had = map.get(name) || { name, visits: 0, views: 0 };
    had.visits += r.sum.visits; had.views += r.count;
    map.set(name, had);
  }
}
const top = (map, n) => [...map.values()].sort((a, b) => b.visits - a.visits || b.views - a.views).slice(0, n);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!(await isAdmin(req))) return reply({ error: 'not_admin' }, 403);
    const token = Deno.env.get('CF_API_TOKEN'), account = Deno.env.get('CF_ACCOUNT_ID');
    if (!token || !account) return reply({ error: 'not_configured' });
    if (!/^[0-9a-f]{32}$/i.test(account)) return reply({ error: 'cloudflare', detail: 'CF_ACCOUNT_ID should be the 32-character account ID' });

    const body = await req.json().catch(() => ({}));
    const count = [7, 30, 90].includes(body.days) ? body.days : 30;
    const now = new Date(), start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - count + 1));

    // Cloudflare may limit how long one query can span, so ask in stretches of up to 30 days.
    const windows = [];
    for (let i = 0; i < count; i += 30) {
      const from = new Date(start.getTime() + i * 864e5);
      const end = new Date(Math.min(start.getTime() + (i + 30) * 864e5 - 1000, now.getTime()));
      windows.push([from.toISOString().replace(/\.\d+Z$/, 'Z'), end.toISOString().replace(/\.\d+Z$/, 'Z')]);
    }
    const results = await Promise.allSettled(windows.map(([a, b]) => fetchWindow(token, account, a, b)));
    const good = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (!good.length) return reply({ error: 'cloudflare', detail: String(results[0].reason && results[0].reason.message || results[0].reason) });

    const byDay = new Map(), referers = new Map(), countries = new Map(), devices = new Map();
    for (const g of good) { addUp(byDay, g.byDay); addUp(referers, g.referers); addUp(countries, g.countries); addUp(devices, g.devices); }
    // Every day gets a row, so quiet days still show on the chart.
    const days = [];
    for (let i = 0; i < count; i++) {
      const day = dayText(new Date(start.getTime() + i * 864e5)), r = byDay.get(day);
      days.push({ day, visits: r ? r.visits : 0, views: r ? r.views : 0 });
    }
    // Moving around the site itself isn't somewhere people came from.
    referers.delete(SITE);
    return reply({
      days,
      visits: days.reduce((a, d) => a + d.visits, 0),
      views: days.reduce((a, d) => a + d.views, 0),
      referers: top(referers, 8), countries: top(countries, 8), devices: top(devices, 5),
      partial: good.length < results.length,
    });
  } catch (err) {
    return reply({ error: 'cloudflare', detail: String(err && err.message || err) });
  }
});

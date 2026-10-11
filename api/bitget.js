// Server-side proxy to Bitget PUBLIC market data (no API key, read-only).
const BASE = 'https://api.bitget.com/api/v2/spot';
async function get(path) {
  const r = await fetch(BASE + path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('Bitget HTTP ' + r.status);
  const j = await r.json();
  if (j.code !== '00000') throw new Error('Bitget: ' + (j.msg || j.code));
  return j.data;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');
  res.setHeader('Content-Type', 'application/json');
  try {
    const q = req.query || {};
    if (q.action === 'ticker') {
      const symbol = String(q.symbol || '').toUpperCase();
      if (!/^[A-Z0-9]{3,24}$/.test(symbol)) return res.status(400).json({ error: 'bad symbol' });
      const d = await get('/market/tickers?symbol=' + symbol);
      const t = Array.isArray(d) ? d[0] : d;
      if (!t || t.symbol !== symbol) return res.status(404).json({ error: 'symbol not found on Bitget spot' });
      return res.status(200).json({ symbol, price: t.lastPr, bid: t.bidPr, ask: t.askPr, change24h: t.change24h, ts: Number(t.ts), source: 'Bitget spot (public API)' });
    }
    if (q.action === 'search') {
      const term = String(q.q || '').trim().toUpperCase();
      if (!/^[A-Z0-9.\-]{1,12}$/.test(term)) return res.status(400).json({ error: 'bad search' });
      const [syms, ticks] = await Promise.all([get('/public/symbols'), get('/market/tickers')]);
      const px = new Map(ticks.map(t => [t.symbol, t]));
      const out = syms.filter(s => s.status === 'online' && s.quoteCoin === 'USDT' && (s.baseCoin.toUpperCase().includes(term) || s.symbol.toUpperCase().includes(term)))
        .slice(0, 15).map(s => { const t = px.get(s.symbol) || {}; return { symbol: s.symbol, base: s.baseCoin, price: t.lastPr || null, ts: t.ts ? Number(t.ts) : null }; });
      return res.status(200).json({ results: out, source: 'Bitget spot (public API)' });
    }
    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e).slice(0, 200) });
  }
}


/* ---------- helpers ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const now = () => Date.now();
const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : NaN; };
function fp(n, min) {
  if (!isFinite(n)) return '—';
  const a = Math.abs(n);
  const d = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8;
  return n.toLocaleString('en-US', { minimumFractionDigits: min == null ? 0 : min, maximumFractionDigits: d });
}
const f2 = n => isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '') + f2(Math.abs(n));
function ago(t) {
  const s = Math.max(1, Math.round((now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}
function when(t) { try { return new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
let toastT;
function toast(msg, kind) {
  const t = $('#toast');
  t.innerHTML = '<div class="' + (kind || '') + '">' + esc(msg) + '</div>';
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.innerHTML = ''; }, 3600);
}
const HORIZONS = ['Intraday (hours)', 'Swing (days)', 'Position (weeks)', 'Long term (months+)'];

/* ---------- risk maths (pure; runs on user-supplied levels only) ---------- */
function riskCalc(p) {
  const dir = p.dir, e = num(p.entry), s = num(p.stop), t = num(p.target);
  const size = p.size === '' || p.size == null ? NaN : num(p.size);
  const r = { flags: [], valid: false, dir, e, s, t };
  const add = (level, text) => r.flags.push({ level, text });
  if (dir !== 'long' && dir !== 'short') add('bad', 'Direction is missing. Choose Long/Buy or Short/Sell.');
  if (!(e > 0)) add('bad', 'Entry price is missing or not a positive number.');
  if (!(s > 0)) add('bad', 'Stop-loss is missing or not a positive number.');
  if (!(t > 0)) add('bad', 'Take-profit is missing or not a positive number.');
  if (r.flags.some(f => f.level === 'bad')) return r;
  if (dir === 'long') {
    if (s >= e) add('bad', 'For a long, the stop-loss must be below the entry. A stop at or above entry would trigger immediately or never protect the trade.');
    if (t <= e) add('bad', 'For a long, the take-profit must be above the entry.');
  } else {
    if (s <= e) add('bad', 'For a short, the stop-loss must be above the entry. A stop at or below entry would trigger immediately or never protect the trade.');
    if (t >= e) add('bad', 'For a short, the take-profit must be below the entry.');
  }
  r.riskU = Math.abs(e - s); r.rewU = Math.abs(t - e);
  r.lossPct = r.riskU / e * 100; r.gainPct = r.rewU / e * 100;
  r.rr = r.riskU > 0 ? r.rewU / r.riskU : NaN;
  r.be = isFinite(r.rr) ? 1 / (1 + r.rr) * 100 : NaN;
  if (size > 0) { r.size = size; r.qty = size / e; r.loss = r.qty * r.riskU; r.gain = r.qty * r.rewU; }
  if (!r.flags.some(f => f.level === 'bad')) {
    r.valid = true;
    if (r.rr < 1) add('warn', 'Risk/reward is ' + r.rr.toFixed(2) + ': you risk more than you stand to gain. You would need to win more than ' + r.be.toFixed(0) + '% of trades like this to break even.');
    else if (r.rr < 1.5) add('info', 'Risk/reward is ' + r.rr.toFixed(2) + '. That is thin; commissions and spreads reduce it further.');
    if (r.lossPct > 25) add('warn', 'The stop is ' + r.lossPct.toFixed(1) + '% from entry. Check that this is intentional.');
    if (r.lossPct < 0.1) add('warn', 'The stop is only ' + r.lossPct.toFixed(3) + '% from entry. Normal price noise may trigger it.');
  }
  if (!(size > 0)) add('info', 'No position size supplied. Loss and gain are shown as percentages only.');
  add('info', 'A stop-loss does not guarantee that price. Stocks can gap past it overnight or on earnings, and orders only fill while the market is open.');
  return r;
}
/* simulated outcome for a demo execution; ref is a price the member typed in */
function simPnl(x, ref) {
  const e = x.fill, q = x.qty, d = x.dir === 'long' ? 1 : -1;
  const pnl = (ref - e) * q * d, riskU = Math.abs(e - x.stop);
  return { pnl, pct: (ref - e) / e * 100 * d, r: riskU > 0 ? (ref - e) * d / riskU : NaN,
    hitStop: d > 0 ? ref <= x.stop : ref >= x.stop, hitTarget: d > 0 ? ref >= x.target : ref <= x.target };
}

/* ---------- rule-based review (used when Claude sampling is unavailable) ---------- */
function ruleReview(p) {
  const rk = riskCalc(p), th = (p.thesis || ''), ev = (p.evidence || []);
  const out = { kind: 'rules', summary: '', supporting: [], counter: [], missing: [], assumptions: [], invalidation: [], risks: [] };
  out.summary = (p.dir === 'long' ? 'Long/buy' : 'Short/sell') + ' ' + p.pair + ' over a ' + (p.horizon || 'unspecified').toLowerCase() + ' horizon. The proposer\'s case: ' + th.slice(0, 220) + (th.length > 220 ? '…' : '');
  ev.forEach(x => out.supporting.push({ point: x, basis: 'user-claim' }));
  if (!ev.length) out.missing.push('No supporting evidence was listed. Add at least one concrete data point, level or catalyst.');
  if (!/\d/.test(th + ev.join(' '))) out.missing.push('The thesis contains no numbers (levels, dates, percentages). Specific data makes it testable.');
  if (!/(because|since|due to|catalyst|breakout|support|resistance|trend|earnings|guidance|revenue|margin|valuation|volume)/i.test(th)) out.missing.push('The thesis does not name a clear reason or catalyst for the move.');
  if (!ev.some(x => /https?:\/\//i.test(x))) out.missing.push('No evidence includes a source link, so nothing can be checked independently.');
  out.counter.push('The opposite trade may be equally supported by the same chart or news. State why the market is wrong now.');
  out.counter.push('Crowded or late entries are at risk of reversals; check whether the move already happened.');
  out.assumptions.push('That the stated entry can actually be filled at or near ' + fp(rk.e) + '.');
  out.assumptions.push('That the stop-loss will execute at the stated level; stocks can gap through stops overnight and on news.');
  out.invalidation.push('Price closes beyond the stop-loss (' + fp(rk.s) + ').');
  out.invalidation.push('The catalyst or evidence cited in the thesis stops being true or is disproven.');
  out.risks.push('Commissions, spreads, slippage and overnight gaps are not included in the figures above.');
  out.risks.push('Earnings, guidance and macro releases can move a stock past your stop. Check whether one falls inside your time horizon.');
  if (rk.valid && rk.rr < 1.5) out.risks.push('Risk/reward is ' + rk.rr.toFixed(2) + ', which leaves little room for error.');
  return out;
}

export { $, esc, num, fp, f2, sgn, ago, when, toast, HORIZONS, riskCalc, ruleReview };

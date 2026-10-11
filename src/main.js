import './style.min.css';
import { createPublicClient, createWalletClient, custom, http, defineChain, keccak256, toHex, getAddress, isAddress } from 'viem';
import artifact from './artifact.json';
import { $, esc, num, fp, f2, when, toast, HORIZONS, riskCalc, ruleReview } from './lib.js';

/* ================= chain config (Robinhood Chain TESTNET) ================= */
const CHAIN = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } },
});
const FAUCET = 'https://faucet.testnet.chain.robinhood.com/';
const ABI = artifact.abi;
const EVENTS = ABI.filter(x => x.type === 'event');
const pub = createPublicClient({ chain: CHAIN, transport: http() });

/* ================= registry address (shareable via link) ================= */
function ls(k, v) {
  try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ }
  return null;
}
(function readParams() {
  const q = new URLSearchParams(location.search);
  const r = q.get('reg'), f = q.get('from');
  if (r && isAddress(r)) { ls('tc_reg', getAddress(r)); ls('tc_from', /^\d+$/.test(f || '') ? f : '0'); }
  if (r) history.replaceState(null, '', location.pathname + location.hash);
})();
const ENV_REG = import.meta.env.VITE_REGISTRY || '';
const ENV_FROM = import.meta.env.VITE_FROM_BLOCK || '0';

const S = {
  acct: null, chainOk: false, wc: null,
  reg: (ls('tc_reg') && isAddress(ls('tc_reg'))) ? ls('tc_reg') : (isAddress(ENV_REG) ? ENV_REG : ''),
  from: ls('tc_from') || ENV_FROM,
  rooms: new Map(), props: new Map(), loaded: false, loading: false, err: '', busy: false,
  draft: null, bg: { results: null, loading: false, err: '', picked: null }, live: {},
};

/* ================= wallet ================= */
const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
const txUrl = h => CHAIN.blockExplorers.default.url + '/tx/' + h;
const addrUrl = a => CHAIN.blockExplorers.default.url + '/address/' + a;

async function connect() {
  const eth = window.ethereum;
  S.walletMsg = '';
  if (!eth) { S.walletMsg = 'No wallet detected in this browser. Open this page from inside your wallet app\'s built-in browser.'; render(); return; }
  S.walletMsg = 'Waiting for your wallet… check for a popup.'; render();
  try {
    const accts = await eth.request({ method: 'eth_requestAccounts' });
    if (!accts || !accts[0]) throw new Error('Wallet returned no account.');
    S.wc = createWalletClient({ chain: CHAIN, transport: custom(eth) });
    S.acct = accts[0];
    S.walletMsg = '';
    wire(eth);
    render();
    await ensureChain();
  } catch (e) { S.walletMsg = 'Connect failed: ' + friendly(e) + (e && e.code ? ' (code ' + e.code + ')' : ''); }
  render();
}
let wired = false;
function wire(eth) {
  if (wired || !eth.on) return; wired = true;
  eth.on('accountsChanged', a => { S.acct = a && a[0] ? a[0] : null; render(); });
  eth.on('chainChanged', () => { checkChain().then(render); });
}
async function checkChain() {
  try { const id = await window.ethereum.request({ method: 'eth_chainId' }); S.chainOk = parseInt(id, 16) === CHAIN.id; } catch (e) { S.chainOk = false; }
}
async function ensureChain() {
  await checkChain();
  if (S.chainOk) return;
  try { await S.wc.switchChain({ id: CHAIN.id }); }
  catch (e) {
    try { await S.wc.addChain({ chain: CHAIN }); await S.wc.switchChain({ id: CHAIN.id }); }
    catch (e2) { S.walletMsg = 'Could not add or switch to Robinhood Chain Testnet: ' + friendly(e2) + (e2 && e2.code ? ' (code ' + e2.code + ')' : ''); }
  }
  await checkChain();
}
const ERR_TEXT = {
  AlreadyVoted: 'This wallet has already voted on this proposal. One vote per wallet.',
  NotMember: 'Join the room first with this wallet.',
  Closed: 'Voting on this proposal is closed.',
  Unauthorized: 'Only the proposal author (or room creator, for closing) can do that.',
  BadChoice: 'Invalid vote choice.', Missing: 'That room or proposal does not exist on this registry.',
  Empty: 'A required field is empty.', TooLong: 'Text is too long for the contract limit.',
};
function friendly(e) {
  const name = (e && (e.cause && (e.cause.data && e.cause.data.errorName || e.cause.errorName))) || (e && e.data && e.data.errorName);
  if (name && ERR_TEXT[name]) return ERR_TEXT[name];
  const m = (e && (e.shortMessage || e.message)) || String(e);
  if (/user rejected|denied|rejected the request/i.test(m)) return 'You cancelled the request in your wallet.';
  if (/insufficient funds/i.test(m)) return 'Not enough testnet ETH for gas. Use the faucet link on the Connect card.';
  for (const k in ERR_TEXT) if (m.includes(k)) return ERR_TEXT[k];
  return m.length > 220 ? m.slice(0, 220) + '…' : m;
}

/* send a registry transaction and wait for it */
async function send(functionName, args, label) {
  if (!S.acct) { await connect(); if (!S.acct) return null; }
  await ensureChain();
  if (!S.chainOk) return null;
  if (!S.reg) { toast('No registry set.', 'bad'); return null; }
  S.busy = true; render();
  try {
    // simulate first so reverts (e.g. already voted) show a clear reason before any gas is spent
    await pub.simulateContract({ address: S.reg, abi: ABI, functionName, args, account: S.acct });
    const hash = await S.wc.writeContract({ address: S.reg, abi: ABI, functionName, args, account: S.acct, chain: CHAIN });
    toast((label || 'Sent') + ' — waiting for confirmation…');
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== 'success') throw new Error('Transaction reverted on-chain.');
    toast((label || 'Done') + ' ✓ confirmed', 'ok');
    S.lastTx = hash;
    await load();
    return hash;
  } catch (e) { toast(friendly(e), 'bad'); return null; }
  finally { S.busy = false; render(); }
}

async function deployRegistry() {
  if (!S.acct) { await connect(); if (!S.acct) return; }
  await ensureChain();
  if (!S.chainOk) return;
  S.busy = true; render();
  try {
    toast('Confirm the deployment in your wallet…');
    const hash = await S.wc.deployContract({ abi: ABI, bytecode: artifact.bytecode, account: S.acct, chain: CHAIN });
    toast('Deploying — waiting for confirmation…');
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== 'success' || !rc.contractAddress) throw new Error('Deployment failed.');
    S.reg = rc.contractAddress; S.from = String(rc.blockNumber);
    ls('tc_reg', S.reg); ls('tc_from', S.from);
    toast('Registry deployed ✓', 'ok');
    await load();
  } catch (e) { toast(friendly(e), 'bad'); }
  finally { S.busy = false; render(); }
}

/* ================= reading the chain (events are the database) ================= */
async function getAllLogs() {
  const latest = await pub.getBlockNumber();
  let from = BigInt(S.from || '0');
  const STEP = 90000n; const out = [];
  while (from <= latest) {
    const to = from + STEP - 1n > latest ? latest : from + STEP - 1n;
    const logs = await pub.getLogs({ address: S.reg, events: EVENTS, fromBlock: from, toBlock: to });
    out.push(...logs);
    from = to + 1n;
  }
  return out;
}
function parseThesis(data) {
  try {
    const o = JSON.parse(data);
    if (!o || typeof o !== 'object') return null;
    const s = v => (typeof v === 'string' ? v.slice(0, 1500) : '');
    return {
      pair: s(o.pair).toUpperCase().slice(0, 12), dir: o.dir === 'short' ? 'short' : 'long',
      entry: s(String(o.entry == null ? '' : o.entry)), stop: s(String(o.stop == null ? '' : o.stop)), target: s(String(o.target == null ? '' : o.target)),
      size: s(String(o.size == null ? '' : o.size)), horizon: s(o.horizon), thesis: s(o.thesis),
      bitget: (o.bitget && typeof o.bitget.symbol === 'string' && /^[A-Z0-9]{3,24}$/.test(o.bitget.symbol)) ? { symbol: o.bitget.symbol, price: String(o.bitget.price || '').slice(0, 24), ts: Number(o.bitget.ts) || 0 } : null,
      evidence: Array.isArray(o.evidence) ? o.evidence.filter(x => typeof x === 'string').slice(0, 8).map(x => x.slice(0, 300)) : [],
    };
  } catch (e) { return null; }
}
async function load() {
  if (!S.reg) { S.loaded = true; return; }
  S.loading = true; S.err = ''; render();
  try {
    const logs = await getAllLogs();
    const rooms = new Map(), props = new Map();
    for (const l of logs) {
      const a = l.args;
      switch (l.eventName) {
        case 'RoomCreated': rooms.set(String(a.roomId), { id: String(a.roomId), creator: a.creator, name: a.name, members: new Set() }); break;
        case 'Joined': { const r = rooms.get(String(a.roomId)); if (r) r.members.add(a.member.toLowerCase()); break; }
        case 'ProposalSubmitted': {
          const hashOk = keccak256(toHex(a.data)) === a.thesisHash;
          props.set(String(a.proposalId), { id: String(a.proposalId), roomId: String(a.roomId), author: a.author, hash: a.thesisHash, hashOk, data: parseThesis(a.data), votes: new Map(), closed: false, outcome: null, block: l.blockNumber });
          break;
        }
        case 'Voted': { const p = props.get(String(a.proposalId)); if (p && !p.votes.has(a.voter.toLowerCase())) p.votes.set(a.voter.toLowerCase(), Number(a.choice)); break; }
        case 'ProposalClosed': { const p = props.get(String(a.proposalId)); if (p) p.closed = true; break; }
        case 'OutcomeRecorded': { const p = props.get(String(a.proposalId)); if (p) p.outcome = { text: String(a.data).slice(0, 2000), tx: l.transactionHash }; break; }
      }
    }
    S.rooms = rooms; S.props = props; S.loaded = true;
  } catch (e) { S.err = 'Could not read the chain: ' + friendly(e); }
  S.loading = false; render();
}

/* ================= helpers over state ================= */
const tally = p => { let y = 0, n = 0, ab = 0; p.votes.forEach(v => { if (v === 1) y++; else if (v === 2) n++; else ab++; }); return { y, n, ab, total: y + n + ab }; };
const isMember = r => !!(S.acct && r && r.members.has(S.acct.toLowerCase()));
const myVote = p => (S.acct && p.votes.get(S.acct.toLowerCase())) || 0;
const roomProps = id => [...S.props.values()].filter(p => p.roomId === id).sort((a, b) => Number(b.id) - Number(a.id));
const CH = { 1: 'For', 2: 'Against', 3: 'Abstain' };
const route = () => { const h = location.hash.replace(/^#\/?/, '').split('/'); return { name: h[0] || 'landing', id: h[1] || '' }; };
const go = h => { location.hash = '#/' + h; };

/* ================= Bitget public prices (via /api/bitget) ================= */
async function api(qs) {
  const r = await fetch('/api/bitget?' + qs);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
async function bgFind() {
  S.draft = Object.assign(readForm(), { dir: (S.draft && S.draft.dir) || 'long' });
  const q = S.draft.pair;
  if (!q) { S.bg.err = 'Type a ticker first, e.g. NVDA.'; render(); return; }
  S.bg.loading = true; S.bg.err = ''; S.bg.results = null; render();
  try { const j = await api('action=search&q=' + encodeURIComponent(q)); S.bg.results = j.results; if (!j.results.length) S.bg.err = 'No Bitget spot USDT market matches "' + q + '". You can still enter levels by hand.'; }
  catch (e) { S.bg.err = 'Bitget lookup failed: ' + e.message; }
  S.bg.loading = false; render();
}
function bgPick(symbol, price, ts) {
  S.draft = Object.assign(readForm(), { dir: (S.draft && S.draft.dir) || 'long' });
  S.bg.picked = { symbol, price, ts: Number(ts) || Date.now() };
  S.draft.entry = String(price);
  render();
}
async function liveFor(symbol) {
  const c = S.live[symbol];
  if (c && (c.loading || Date.now() - c.at < 15000)) return;
  S.live[symbol] = { loading: true, at: Date.now() };
  try { const j = await api('action=ticker&symbol=' + symbol); S.live[symbol] = { at: Date.now(), price: j.price, bid: j.bid, ask: j.ask, ts: j.ts, change24h: j.change24h }; }
  catch (e) { S.live[symbol] = { at: Date.now(), err: e.message }; }
  render();
}
const hhmm = ts => { try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch (e) { return ''; } };

/* ================= views ================= */
function modes() {
  const c = [];
  c.push('<span class="chip demo nodot">TESTNET</span>');
  if (S.acct) c.push('<span class="chip ' + (S.chainOk ? 'ok' : 'bad') + '">' + (S.chainOk ? esc(short(S.acct)) : 'WRONG NETWORK') + '</span>');
  return c.join('');
}
function connectCard() {
  if (S.acct && S.chainOk) return '';
  return '<div class="card stack"><div class="lbl">Wallet</div>' +
    '<p class="sm mute">Your wallet address is your account. Open this page inside your wallet app\'s browser, then connect. Testnet only: no real funds are used.</p>' +
    '<button class="btn pri blk" data-act="connect"' + (S.busy ? ' disabled' : '') + '>' + (S.acct ? 'Switch to Robinhood Chain Testnet' : 'Connect wallet') + '</button>' +
    (S.walletMsg ? '<div class="note sm" style="border-color:var(--amber-ln);color:var(--fg)">' + esc(S.walletMsg) + '</div>' : '') +
    '<div class="xs dim">Wallet detected: ' + (window.ethereum ? 'yes' : 'no') + (S.acct ? ' · account ' + esc(short(S.acct)) : '') + ' · network ' + (S.chainOk ? 'correct' : 'not Robinhood Testnet') + '</div>' +
    '<p class="xs dim">You need a little testnet ETH for gas. Faucet (listed by third parties, not confirmed in the official docs): <a href="' + FAUCET + '" target="_blank" rel="noopener" style="color:var(--blue)">' + FAUCET.replace('https://', '') + '</a></p></div>';
}
function vLanding() {
  return '<section class="land"><div class="land-in">' +
    '<span class="pill-badge">Testnet · no real funds</span>' +
    '<h1 class="disp">Think together. Trade <em>smarter.</em></h1>' +
    '<p class="lead">Propose a stock thesis with a stop and target, let your circle vote once per wallet, and record the outcome on-chain.</p>' +
    '<div class="cta-col"><button class="btn pri blk" data-act="start" style="padding:18px;font-size:17px">' + (S.acct ? 'Open your trading desk' : 'Get started') + '</button>' +
    '<button class="link-cta" data-act="how">How it works ›</button></div>' +
    '<ul class="meta"><li>One vote per wallet, enforced by the contract</li><li>A vote is a signal. It never places or authorizes a trade</li><li>Nothing here holds funds or executes orders</li></ul>' +
    '</div></section>' +
    '<section class="how" id="how"><div class="lbl">How it works</div>' +
    ['Create or join a room with your wallet', 'Submit a proposal: ticker, entry, stop, target, thesis', 'Read the risk check and the rules-based review', 'Members vote once each (for, against, abstain)', 'The author records what actually happened'].map((t, i) => '<div class="row"><b class="mono dim">' + (i + 1) + '</b><span>' + t + '</span></div>').join('') +
    '<div class="lbl" style="margin-top:14px">Data labels</div><div class="srcs">' +
    '<div class="row"><span class="src calc">On-chain</span><span class="sm mute">Read from the registry contract: members, votes, proposal hashes</span></div>' +
    '<div class="row"><span class="src user">User-provided</span><span class="sm mute">Prices, levels and thesis typed by a member. Not verified</span></div>' +
    '<div class="row"><span class="src calc">Computed</span><span class="sm mute">Risk math from the member\'s own numbers</span></div>' +
    '<div class="row"><span class="src none">Rules-based</span><span class="sm mute">Checklist review. Not an AI model, not advice</span></div>' +
    '</div><p class="fine">There is no live market data in this app. Prices are whatever members enter. Testnet only; not financial advice. Real tokenized-stock products can be restricted for US persons.</p></section>';
}
function vSetup() {
  return '<div class="card stack"><div class="lbl">Registry</div>' +
    '<h2 style="font-size:20px;margin:0">No registry connected</h2>' +
    '<p class="sm mute">The registry is the contract that stores rooms, proposals and votes. Deploy a fresh one from your wallet (one transaction, testnet gas only), or paste an existing address.</p>' +
    '<button class="btn pri blk" data-act="deploy"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Working…' : 'Deploy registry') + '</button>' +
    '<div class="f"><label for="reg-in">Or use an existing registry address</label><input id="reg-in" placeholder="0x…" autocapitalize="off" autocomplete="off" spellcheck="false"></div>' +
    '<div class="f"><label for="reg-from">Deployed at block (optional, speeds up loading)</label><input id="reg-from" inputmode="numeric" placeholder="0"></div>' +
    '<button class="btn blk" data-act="setreg">Use this address</button></div>';
}
function regBar() {
  return '<div class="note xs row sp wrap-r"><span>Registry <a href="' + addrUrl(S.reg) + '" target="_blank" rel="noopener" style="color:var(--blue)">' + esc(short(S.reg)) + '</a></span>' +
    '<span class="row"><button class="btn sm ghost" data-act="share">Copy invite link</button><button class="btn sm ghost" data-act="refresh">' + (S.loading ? 'Loading…' : 'Refresh') + '</button></span></div>';
}
function vRooms() {
  let h = connectCard();
  if (!S.reg) return h + vSetup();
  h += regBar();
  if (S.err) h += '<div class="note" style="border-color:var(--red-ln);color:var(--red)">' + esc(S.err) + '</div>';
  const rooms = [...S.rooms.values()].sort((a, b) => Number(b.id) - Number(a.id));
  h += '<div class="card stack"><div class="lbl">Create a room</div><div class="f"><label for="rn">Room name</label><input id="rn" maxlength="80" placeholder="e.g. Kaduna swing traders"></div>' +
    '<button class="btn pri blk" data-act="newroom"' + (S.busy ? ' disabled' : '') + '>Create room</button><p class="xs dim">Sends one on-chain transaction. You become the first member.</p></div>';
  h += '<div class="lbl">Rooms</div>';
  if (!S.loaded || (S.loading && !rooms.length)) h += '<div class="sk"></div><div class="sk"></div>';
  else if (!rooms.length) h += '<div class="empty">No rooms on this registry yet. Create the first one above.</div>';
  else h += '<div class="stack">' + rooms.map(r => '<button class="card" data-act="room" data-id="' + esc(r.id) + '" style="text-align:left;cursor:pointer"><div class="row sp"><b>' + esc(r.name) + '</b><span class="src calc">On-chain</span></div><div class="xs mute" style="margin-top:6px">' + r.members.size + ' member' + (r.members.size === 1 ? '' : 's') + ' · ' + roomProps(r.id).length + ' proposal' + (roomProps(r.id).length === 1 ? '' : 's') + ' · created by ' + esc(short(r.creator)) + '</div></button>').join('') + '</div>';
  return h;
}
function propRow(p) {
  const d = p.data, t = tally(p);
  return '<button class="card" data-act="prop" data-id="' + esc(p.id) + '" style="text-align:left;cursor:pointer"><div class="row sp"><div class="row"><b class="mono">' + esc(d ? d.pair : '—') + '</b>' + (d ? '<span class="dir" style="' + (d.dir === 'long' ? 'color:var(--green);background:var(--green-bg)' : 'color:var(--red);background:var(--red-bg)') + '">' + (d.dir === 'long' ? 'LONG' : 'SHORT') + '</span>' : '') + '</div>' +
    '<span class="chip nodot ' + (p.closed ? '' : 'info') + '">' + (p.closed ? 'CLOSED' : 'VOTING') + '</span></div>' +
    '<div class="xs mute" style="margin-top:6px">' + (d ? 'Entry ' + esc(d.entry) + ' · Stop ' + esc(d.stop) + ' · Target ' + esc(d.target) + ' <span class="dim">(typed by proposer)</span><br>' : '') + t.y + ' for · ' + t.n + ' against · ' + t.ab + ' abstain · by ' + esc(short(p.author)) + '</div><div class="row sp" style="margin-top:10px"><span class="sm" style="color:var(--blue)">' + (p.closed ? 'View result ›' : 'Open &amp; vote ›') + '</span></div></button>';
}
function vRoom(id) {
  const r = S.rooms.get(id);
  if (!r) return '<div class="empty">' + (S.loading ? 'Loading…' : 'Room not found on this registry.') + '</div><button class="btn blk" data-act="rooms">Back to rooms</button>';
  const mem = isMember(r), ps = roomProps(id);
  let h = '<div class="row sp"><button class="btn sm ghost" data-act="rooms">‹ Rooms</button>' + (mem ? '<span class="chip ok">MEMBER</span>' : '') + '</div>' +
    '<div><div class="lbl">Room #' + esc(r.id) + '</div><h1 style="font:600 26px var(--f-disp);margin:6px 0 4px;letter-spacing:-.02em">' + esc(r.name) + '</h1><div class="xs mute">' + r.members.size + ' members · created by ' + esc(short(r.creator)) + '</div></div>';
  h += connectCard();
  h += '<div class="card stack"><div class="lbl">Add members</div><p class="sm mute">Members join themselves. Copy the invite link, send it to them, and they open it in their wallet\'s browser, connect, and tap Join this room.</p><button class="btn blk" data-act="share">Copy invite link for this room</button></div>';
  if (!mem) h += '<div class="card stack"><p class="sm mute">Only members can propose and vote. Joining is one on-chain transaction from your wallet.</p><button class="btn pri blk" data-act="join" data-id="' + esc(id) + '"' + (S.busy ? ' disabled' : '') + '>Join this room</button></div>';
  else h += '<button class="btn pri blk" data-act="newprop" data-id="' + esc(id) + '">New proposal</button>';
  h += '<div class="lbl">Proposals</div>';
  h += ps.length ? '<div class="stack">' + ps.map(propRow).join('') + '</div>' : '<div class="empty">No proposals yet.</div>';
  return h;
}
function vNew(id) {
  const r = S.rooms.get(id);
  if (!r) return '<div class="empty">Room not found.</div>';
  const d = S.draft || { dir: 'long' };
  return '<div class="row sp"><button class="btn sm ghost" data-act="room" data-id="' + esc(id) + '">‹ ' + esc(r.name) + '</button></div>' +
    '<div class="lbl">New proposal</div>' +
    '<form id="pf" class="card stack" novalidate>' +
    '<div class="f"><label for="np-pair">Stock ticker</label><input id="np-pair" maxlength="12" autocapitalize="characters" placeholder="e.g. NVDA" value="' + esc(d.pair || '') + '"></div>' +
    '<button type="button" class="btn sm" data-act="bgfind"' + (S.bg.loading ? ' disabled' : '') + '>' + (S.bg.loading ? 'Searching Bitget…' : 'Find live price on Bitget') + '</button>' + bgResults() +
    '<div class="seg"><button type="button" class="' + (d.dir === 'long' ? 'on long' : '') + '" data-act="dir" data-v="long">Long / Buy</button><button type="button" class="' + (d.dir === 'short' ? 'on short' : '') + '" data-act="dir" data-v="short">Short / Sell</button></div>' +
    '<div class="f"><label for="np-entry">Entry price (USD)</label><input id="np-entry" inputmode="decimal" value="' + esc(d.entry || '') + '"></div>' +
    '<div class="f"><label for="np-stop">Stop-loss</label><input id="np-stop" inputmode="decimal" value="' + esc(d.stop || '') + '"></div>' +
    '<div class="f"><label for="np-target">Take-profit</label><input id="np-target" inputmode="decimal" value="' + esc(d.target || '') + '"></div>' +
    '<div class="f"><label for="np-size">Position size in USD (optional)</label><input id="np-size" inputmode="decimal" value="' + esc(d.size || '') + '"></div>' +
    '<div class="f"><label for="np-h">Time horizon</label><select id="np-h">' + HORIZONS.map(x => '<option' + (d.horizon === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>' +
    '<div class="f"><label for="np-th">Thesis: why, and why now</label><textarea id="np-th" rows="5" maxlength="1200">' + esc(d.thesis || '') + '</textarea></div>' +
    '<div class="f"><label for="np-ev">Evidence, one per line (links help)</label><textarea id="np-ev" rows="3" maxlength="900">' + esc(d.evidence || '') + '</textarea></div>' +
    '<div id="np-err" class="xs" style="color:var(--red)"></div>' +
    '<button class="btn pri blk" type="submit"' + (S.busy ? ' disabled' : '') + '>Submit on-chain</button>' +
    '<p class="xs dim">Prices and levels are what you type. They are labelled user-provided and are not verified by the app.</p></form>';
}
function bgResults() {
  let h = '';
  if (S.bg.err) h += '<div class="note xs" style="border-color:var(--amber-ln);color:var(--fg)">' + esc(S.bg.err) + '</div>';
  if (S.bg.results && S.bg.results.length) h += '<div class="stack"><div class="xs mute">Bitget spot markets (USDT). Pick the one that matches your stock, and check what the token tracks. A token price can differ from the stock price.</div>' + S.bg.results.map(r => '<button type="button" class="btn sm" data-act="bgpick" data-s="' + esc(r.symbol) + '" data-p="' + esc(r.price || '') + '" data-t="' + esc(r.ts || '') + '" style="justify-content:space-between"><span class="mono">' + esc(r.symbol) + '</span><span class="mono">' + (r.price ? esc(r.price) + ' USDT' : 'no price') + '</span></button>').join('') + '</div>';
  if (S.bg.picked) h += '<div class="note xs"><span class="src calc">Bitget live</span> Using <b class="mono">' + esc(S.bg.picked.symbol) + '</b> at ' + esc(S.bg.picked.price) + ' USDT as the entry. Edit the entry if you want a different level.</div>';
  return h;
}
function readForm() {
  const g = i => ($('#' + i) || {}).value || '';
  return { pair: g('np-pair').replace(/[^A-Za-z0-9.\-]/g, '').toUpperCase().slice(0, 12), dir: (S.draft && S.draft.dir) || 'long', entry: g('np-entry').trim(), stop: g('np-stop').trim(), target: g('np-target').trim(), size: g('np-size').trim(), horizon: g('np-h'), thesis: g('np-th').trim(), evidence: g('np-ev') };
}
function riskHTML(d) {
  const rk = riskCalc(d);
  let h = '<div class="card stack"><div class="row sp"><div class="lbl">Risk check</div><span class="src calc">Computed</span></div>';
  if (rk.valid) {
    h += '<div class="flow"><div class="kv"><div class="lbl">Risk / reward</div><div class="big">' + rk.rr.toFixed(2) + '</div></div>' +
      '<div class="kv"><div class="lbl">Risk to stop</div><div class="big down">−' + rk.lossPct.toFixed(2) + '%</div></div>' +
      '<div class="kv"><div class="lbl">Gain at target</div><div class="big up">+' + rk.gainPct.toFixed(2) + '%</div></div>' +
      '<div class="kv"><div class="lbl">Break-even win rate</div><div class="big">' + rk.be.toFixed(0) + '%</div></div></div>';
    if (rk.size) h += '<div class="sm mute">On $' + f2(rk.size) + ': about <b class="down">−$' + f2(rk.loss) + '</b> at the stop, <b class="up">+$' + f2(rk.gain) + '</b> at the target, before fees and gaps.</div>';
  }
  h += rk.flags.map(f => '<div class="note xs" style="' + (f.level === 'bad' ? 'color:var(--red);border-color:var(--red-ln)' : f.level === 'warn' ? 'color:var(--amber);border-color:var(--amber-ln)' : '') + '">' + esc(f.text) + '</div>').join('') + '</div>';
  return h;
}
function reviewHTML(d) {
  const rv = ruleReview(d);
  const L = (t, a) => a.length ? '<div><div class="lbl">' + t + '</div><ul style="margin:8px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:5px" class="sm">' + a.map(x => '<li>' + esc(typeof x === 'string' ? x : x.point) + '</li>').join('') + '</ul></div>' : '';
  return '<div class="card stack"><div class="row sp"><div class="lbl">Review</div><span class="src none">Rules-based</span></div>' +
    '<p class="sm mute">A checklist applied to the text above. It does not check facts, prices or sources, and is not an AI model.</p>' +
    L('Questions to ask the proposer', ['What specific evidence supports this, and where can we check it?', 'Why is the market wrong right now?', 'What would make you exit before the stop?', 'Is an earnings or macro date inside your time horizon?', 'What size are you risking, and is that comfortable if the stop gaps?']) + L('Missing', rv.missing) + L('Counter-case', rv.counter) + L('Assumptions', rv.assumptions) + L('Invalidation', rv.invalidation) + L('Risks', rv.risks) + '</div>';
}
function bitgetBlock(b) {
  const lv = S.live[b.symbol];
  let live = '<span class="mute">loading…</span>';
  if (lv && lv.err) live = '<span class="down">unavailable (' + esc(lv.err) + ')</span>';
  else if (lv && lv.price) live = '<b class="mono">' + esc(lv.price) + ' USDT</b> <span class="xs dim">as of ' + esc(hhmm(lv.ts)) + '</span>';
  return '<div class="note xs stack"><div class="row sp"><span><span class="src calc">Bitget live</span> <b class="mono">' + esc(b.symbol) + '</b></span><button class="btn sm ghost" data-act="relive" data-s="' + esc(b.symbol) + '">Refresh</button></div>' +
    '<div class="sm">Now: ' + live + '</div><div class="sm mute">When proposed: ' + esc(b.price) + ' USDT' + (b.ts ? ' (' + esc(when(b.ts)) + ')' : '') + '</div>' +
    '<div class="xs dim">Price of this Bitget token market, not verified as the underlying stock price. Source: Bitget public API.</div></div>';
}
function vProp(id) {
  const p = S.props.get(id);
  if (!p) return '<div class="empty">' + (S.loading ? 'Loading…' : 'Proposal not found.') + '</div>';
  const r = S.rooms.get(p.roomId), d = p.data, t = tally(p), mem = isMember(r), mine = myVote(p);
  let h = '<div class="row sp"><button class="btn sm ghost" data-act="room" data-id="' + esc(p.roomId) + '">‹ ' + esc(r ? r.name : 'Room') + '</button><span class="chip nodot ' + (p.closed ? '' : 'info') + '">' + (p.closed ? 'VOTING CLOSED' : 'VOTING OPEN') + '</span></div>';
  if (!d) return h + '<div class="note" style="color:var(--red);border-color:var(--red-ln)">This proposal\'s data could not be read.</div>';
  h += '<div class="card stack"><div class="row sp"><div class="row"><h1 class="mono" style="font-size:26px;margin:0">' + esc(d.pair || '—') + '</h1><span class="dir" style="' + (d.dir === 'long' ? 'color:var(--green);background:var(--green-bg)' : 'color:var(--red);background:var(--red-bg)') + '">' + (d.dir === 'long' ? 'LONG' : 'SHORT') + '</span></div><span class="src user">User-provided</span></div>' +
    '<div class="flow"><div class="kv"><div class="lbl">Entry</div><div class="mono">' + esc(d.entry) + '</div></div><div class="kv"><div class="lbl">Stop</div><div class="mono">' + esc(d.stop) + '</div></div><div class="kv"><div class="lbl">Target</div><div class="mono">' + esc(d.target) + '</div></div>' + (d.size ? '<div class="kv"><div class="lbl">Size (USD)</div><div class="mono">' + esc(d.size) + '</div></div>' : '') + '</div>' +
    (d.bitget ? bitgetBlock(d.bitget) : '<div class="note xs"><span class="src none">No feed</span> No market price was attached to this proposal. Levels are typed by the proposer.</div>') + '<div class="xs mute">' + esc(d.horizon) + ' · proposed by ' + esc(short(p.author)) + '</div>' +
    '<div class="sm" style="white-space:pre-wrap">' + esc(d.thesis) + '</div>' +
    (d.evidence.length ? '<div><div class="lbl">Evidence</div><ul class="sm" style="margin:8px 0 0;padding-left:18px">' + d.evidence.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' : '') +
    '<div class="row xs ' + (p.hashOk ? 'up' : 'down') + '">' + (p.hashOk ? '✓ Text matches the hash recorded on-chain' : '✗ Text does NOT match the on-chain hash') + '</div></div>';
  h += riskHTML(d) + reviewHTML(d);
  const pct = x => t.total ? Math.round(x / t.total * 100) : 0;
  h += '<div class="card stack"><div class="row sp"><div class="lbl">Votes</div><span class="src calc">On-chain</span></div>' +
    '<div class="bar"><i style="width:' + pct(t.y) + '%;background:var(--green)"></i><i style="width:' + pct(t.n) + '%;background:var(--red)"></i><i style="width:' + pct(t.ab) + '%;background:var(--dim)"></i></div>' +
    '<div class="row sp sm"><span class="up">For ' + t.y + '</span><span class="down">Against ' + t.n + '</span><span class="mute">Abstain ' + t.ab + '</span></div>' +
    '<div class="note xs">A group vote is a signal. It does not authorize, place or size any trade, and this app cannot place orders.</div>';
  if (!S.acct) h += '<button class="btn pri blk" data-act="connect">Connect wallet to vote</button>';
  else if (!mem) h += '<div class="sm mute">Join the room to vote.</div><button class="btn blk" data-act="join" data-id="' + esc(p.roomId) + '">Join room</button>';
  else if (mine) h += '<div class="sm">You voted <b>' + CH[mine] + '</b>. One vote per wallet; it cannot be changed.</div>';
  else if (p.closed) h += '<div class="sm mute">Voting is closed.</div>';
  else h += '<div class="row"><button class="btn for grow" data-act="vote" data-id="' + esc(id) + '" data-v="1"' + (S.busy ? ' disabled' : '') + '>For</button><button class="btn against grow" data-act="vote" data-id="' + esc(id) + '" data-v="2"' + (S.busy ? ' disabled' : '') + '>Against</button><button class="btn abst grow" data-act="vote" data-id="' + esc(id) + '" data-v="3"' + (S.busy ? ' disabled' : '') + '>Abstain</button></div>';
  if (!p.closed && S.acct && r && (same(S.acct, p.author) || same(S.acct, r.creator))) h += '<button class="btn blk" data-act="close" data-id="' + esc(id) + '"' + (S.busy ? ' disabled' : '') + '>Close voting</button>';
  h += '</div>';
  h += '<div class="card stack"><div class="row sp"><div class="lbl">Outcome</div><span class="src user">User-provided</span></div>';
  if (p.outcome) h += '<div class="sm" style="white-space:pre-wrap">' + esc(p.outcome.text) + '</div><a class="xs" style="color:var(--blue)" href="' + txUrl(p.outcome.tx) + '" target="_blank" rel="noopener">View transaction</a>';
  else if (S.acct && same(S.acct, p.author)) h += '<p class="sm mute">What actually happened? This is a self-reported note, recorded on-chain. It is not verified.</p><div class="f"><label for="oc">Outcome note</label><textarea id="oc" rows="3" maxlength="600" placeholder="e.g. Did not trade. Price hit target on …"></textarea></div><button class="btn pri blk" data-act="outcome" data-id="' + esc(id) + '"' + (S.busy ? ' disabled' : '') + '>Record outcome</button>';
  else h += '<div class="sm mute">No outcome recorded yet. Only the author can record one.</div>';
  h += '</div>';
  return h;
}

/* ================= render + events ================= */
function render() {
  $('#modes').innerHTML = modes();
  const r = route(); let h = '';
  if (r.name === 'landing') h = vLanding();
  else if (r.name === 'rooms') h = vRooms();
  else if (r.name === 'room') h = vRoom(r.id);
  else if (r.name === 'new') h = vNew(r.id);
  else if (r.name === 'p') h = vProp(r.id);
  else h = vLanding();
  if (r.name === 'p') { const pp = S.props.get(r.id); if (pp && pp.data && pp.data.bitget) liveFor(pp.data.bitget.symbol); }
  const keep = document.activeElement && document.activeElement.id;
  const val = keep ? document.activeElement.value : null;
  $('#app').innerHTML = h;
  if (keep && val != null && $('#' + keep) && ['INPUT', 'TEXTAREA'].includes($('#' + keep).tagName) && !$('#' + keep).value) { $('#' + keep).value = val; }
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  if (a === 'home') go('');
  else if (a === 'start' || a === 'rooms') go('rooms');
  else if (a === 'how') { const el = document.getElementById('how'); if (el) el.scrollIntoView({ behavior: 'smooth' }); }
  else if (a === 'connect') await connect();
  else if (a === 'deploy') await deployRegistry();
  else if (a === 'setreg') {
    const v = ($('#reg-in').value || '').trim(), f = ($('#reg-from').value || '').trim();
    if (!isAddress(v)) { toast('That is not a valid address.', 'bad'); return; }
    S.reg = getAddress(v); S.from = /^\d+$/.test(f) ? f : '0'; ls('tc_reg', S.reg); ls('tc_from', S.from); await load();
  }
  else if (a === 'refresh') await load();
  else if (a === 'share') {
    const u = location.origin + location.pathname + '?reg=' + S.reg + '&from=' + S.from + location.hash;
    try { await navigator.clipboard.writeText(u); toast('Invite link copied', 'ok'); } catch (e) { toast(u); }
  }
  else if (a === 'room') go('room/' + id);
  else if (a === 'prop') go('p/' + id);
  else if (a === 'newprop') { S.draft = null; S.bg = { results: null, loading: false, err: '', picked: null }; go('new/' + id); }
  else if (a === 'bgfind') await bgFind();
  else if (a === 'bgpick') bgPick(b.dataset.s, b.dataset.p, b.dataset.t);
  else if (a === 'relive') { delete S.live[b.dataset.s]; liveFor(b.dataset.s); }
  else if (a === 'dir') { S.draft = Object.assign(readForm(), { dir: b.dataset.v }); render(); }
  else if (a === 'newroom') {
    const n = ($('#rn').value || '').trim();
    if (!n) { toast('Give the room a name.', 'bad'); return; }
    const h = await send('createRoom', [n], 'Room created');
    if (h) { const mine = [...S.rooms.values()].filter(r => same(r.creator, S.acct)).sort((x, y) => Number(y.id) - Number(x.id))[0]; if (mine) go('room/' + mine.id); }
  }
  else if (a === 'join') await send('join', [BigInt(id)], 'Joined');
  else if (a === 'vote') await send('castVote', [BigInt(id), Number(b.dataset.v)], 'Vote recorded');
  else if (a === 'close') await send('closeVoting', [BigInt(id)], 'Voting closed');
  else if (a === 'outcome') {
    const t = ($('#oc').value || '').trim();
    if (!t) { toast('Write the outcome first.', 'bad'); return; }
    await send('recordOutcome', [BigInt(id), t], 'Outcome recorded');
  }
});

document.addEventListener('submit', async ev => {
  if (ev.target.id !== 'pf') return;
  ev.preventDefault();
  const d = readForm(); S.draft = d;
  const errs = [];
  if (!/^[A-Z.\-]{1,12}$/.test(d.pair)) errs.push('Enter a stock ticker, letters only (e.g. NVDA).');
  const rk = riskCalc(d);
  rk.flags.filter(f => f.level === 'bad').forEach(f => errs.push(f.text));
  if (d.thesis.length < 20) errs.push('Write a thesis of at least a sentence or two.');
  if (errs.length) { $('#np-err').innerHTML = errs.map(esc).join('<br>'); return; }
  const rid = route().id;
  const body = { pair: d.pair, dir: d.dir, entry: d.entry, stop: d.stop, target: d.target, size: d.size, horizon: d.horizon, thesis: d.thesis, evidence: d.evidence.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 8) };
  if (S.bg.picked) body.bitget = { symbol: S.bg.picked.symbol, price: String(S.bg.picked.price), ts: S.bg.picked.ts };
  const data = JSON.stringify(body);
  if (new TextEncoder().encode(data).length > 3900) { $('#np-err').textContent = 'Too long. Shorten the thesis or evidence.'; return; }
  const hash = keccak256(toHex(data));
  const tx = await send('submitProposal', [BigInt(rid), hash, data], 'Proposal submitted');
  if (tx) { S.draft = null; go('room/' + rid); }
});

/* ================= boot ================= */
(async function boot() {
  render();
  if (window.ethereum) {
    try {
      const accts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accts && accts[0]) { S.wc = createWalletClient({ chain: CHAIN, transport: custom(window.ethereum) }); S.acct = accts[0]; await checkChain(); wire(window.ethereum); }
    } catch (e) { /* not connected yet */ }
  }
  await load();
  setInterval(() => { if (S.reg && !S.busy && !document.hidden && /^(room|p)$/.test(route().name)) load(); }, 20000);
})();

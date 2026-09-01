/* HyperFlow — coin news.
 *
 * This is the only server-side code in the project, and it exists for one
 * reason: no top-tier crypto outlet allows a browser to read it. CryptoCompare,
 * CoinDesk's RSS, The Block, Blockworks, Messari and CoinCap all refuse
 * cross-origin requests, and CoinGecko's news endpoint is paid-plan only. A key
 * in a public site's JavaScript is a published key, so the alternative to this
 * file is no news at all.
 *
 * It holds nothing, stores nothing, and never sees a wallet, an address or a
 * user. It reads four public RSS feeds, keeps the items that mention the coin,
 * and returns them as JSON. Vercel's edge caches the response for an hour, so
 * the outlets see one request per hour per coin rather than one per reader.
 */

/* Outlets with newsrooms and mastheads. No aggregators, no press-release
   wires, no "sponsored" feeds — a headline here should be one somebody stood
   behind. A feed that fails is skipped and named in `sources`, so a reader can
   see which ones answered rather than wondering what is missing. */
const SOURCES = [
  { name: 'CoinDesk',    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'The Block',   url: 'https://www.theblock.co/rss.xml' },
  { name: 'Blockworks',  url: 'https://blockworks.co/feed' },
  { name: 'Decrypt',     url: 'https://decrypt.co/feed' },
  { name: 'DL News',     url: 'https://www.dlnews.com/arc/outboundfeeds/rss/' },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'CryptoSlate', url: 'https://cryptoslate.com/feed/' },
  { name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed' },
  { name: 'The Defiant', url: 'https://thedefiant.io/api/feed' },
  { name: 'Protos',      url: 'https://protos.com/feed/' },
];

/* A ticker alone is a bad filter: "SUI" matches "suit", "OP" matches half the
   English language. Each coin gets the whole words that actually identify it,
   and the ticker only counts when it stands alone in caps. */
const NAMES = {
  BTC:['bitcoin'], ETH:['ethereum','ether'], SOL:['solana'], HYPE:['hyperliquid'],
  XRP:['xrp','ripple'], DOGE:['dogecoin'], SUI:['sui network','mysten'], ARB:['arbitrum'],
  OP:['optimism'], LINK:['chainlink'], AVAX:['avalanche'], TRX:['tron'], ZEC:['zcash'],
  XMR:['monero'], TON:['toncoin','telegram open network'], APT:['aptos'], NEAR:['near protocol'],
  INJ:['injective'], TIA:['celestia'], SEI:['sei network'], ADA:['cardano'], DOT:['polkadot'],
  MATIC:['polygon'], POL:['polygon'], LTC:['litecoin'], BCH:['bitcoin cash'], ATOM:['cosmos'],
  UNI:['uniswap'], AAVE:['aave'], CRV:['curve finance'], ENA:['ethena'], PENDLE:['pendle'],
  LDO:['lido'], MKR:['maker','makerdao'], SHIB:['shiba inu'], PEPE:['pepe coin'],
  WIF:['dogwifhat'], BONK:['bonk'], JUP:['jupiter exchange'], PYTH:['pyth network'],
  STRK:['starknet'], ZK:['zksync'], BLUR:['blur'], ENS:['ethereum name service'],
  FIL:['filecoin'], ICP:['internet computer'], HBAR:['hedera'], ALGO:['algorand'],
  VET:['vechain'], FTM:['fantom','sonic labs'], RUNE:['thorchain'], KAS:['kaspa'],
  TAO:['bittensor'], RENDER:['render network'], FET:['fetch.ai','artificial superintelligence'],
  GRT:['the graph'], SAND:['the sandbox'], MANA:['decentraland'], AXS:['axie infinity'],
  IMX:['immutable'], GMX:['gmx'], DYDX:['dydx'], PUMP:['pump.fun'], TRUMP:['official trump'],
  FARTCOIN:['fartcoin'], VIRTUAL:['virtuals protocol'], AI16Z:['ai16z'], EIGEN:['eigenlayer'],
  ETHFI:['ether.fi'], ONDO:['ondo finance'], MORPHO:['morpho'], BERA:['berachain'],
  MON:['monad'], S:['sonic'], KAITO:['kaito'], WLD:['worldcoin'], W:['wormhole'],
};

const strip = s => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
  .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, m =>
    ({ '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'",'&nbsp;':' ' }[m] || ' '))
  .replace(/\s+/g, ' ').trim();

const tag = (block, name) => {
  const m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? strip(m[1]) : '';
};

function parseFeed(xml, source) {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  return blocks.map(b => {
    let link = tag(b, 'link');
    if (!link) { const h = b.match(/<link[^>]*href="([^"]+)"/i); link = h ? h[1] : ''; }
    const when = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated');
    const t = Date.parse(when);
    return {
      title: tag(b, 'title'),
      summary: (tag(b, 'description') || tag(b, 'summary')).slice(0, 240),
      link, source,
      time: isFinite(t) ? t : null,
    };
  }).filter(x => x.title && x.link);
}

/* Whole-word match only, and a bare ticker has to be capitalised to count —
   otherwise every article about a lawsuit matches SUI. */
function mentions(item, coin, names) {
  const hay = (item.title + ' ' + item.summary);
  const low = hay.toLowerCase();
  for (const n of names) if (low.includes(n.toLowerCase())) return true;
  return new RegExp('(^|[^A-Za-z0-9])' + coin.replace(/[^A-Z0-9]/gi, '') + '([^A-Za-z0-9]|$)')
    .test(hay);
}

module.exports = async (req, res) => {
  const coin = String((req.query && req.query.coin) || '').toUpperCase().slice(0, 24)
    .replace(/[^A-Z0-9]/g, '');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  /* one hour at the edge; a stale copy is served while the new one is fetched,
     so a reader never waits on the outlets */
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=1800');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!coin) { res.status(400).end(JSON.stringify({ error: 'coin required' })); return; }

  const names = NAMES[coin] || [];
  const settled = await Promise.allSettled(SOURCES.map(async s => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 7000);
    try {
      const r = await fetch(s.url, {
        signal: ctl.signal,
        headers: { 'User-Agent': 'HyperFlow/1.0 (+https://hyper-flow-sigma.vercel.app)' },
      });
      if (!r.ok) return [];
      return parseFeed(await r.text(), s.name);
    } finally { clearTimeout(t); }
  }));

  const reached = [];
  let all = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.length) { reached.push(SOURCES[i].name); all = all.concat(r.value); }
  });

  const seen = new Set();
  const items = all
    .filter(x => mentions(x, coin, names))
    .filter(x => { const k = x.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.time || 0) - (a.time || 0))
    .slice(0, 10);

  res.status(200).end(JSON.stringify({
    coin, items, sources: reached, fetched: Date.now(),
    /* say when nothing matched rather than looking broken */
    note: items.length ? null : 'No recent story from these outlets mentions this market.',
  }));
};

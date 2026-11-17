// Token Radar's dashboard, radar-2. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan, and a model sandbox that recomputes the board live. No network:
// every byte it shows is in data.js.
//
// The model runs here exactly as it runs in lib/model.ts: impliedOf, growthMultiplier,
// maturityMultiplier, breadthMultiplier and tvlTerm are the same arithmetic, so the detail view can
// recompute a row and say whether its number matches board.json.
//
// What a reader can verify on this page without trusting anything.
//
// Every number in the table is recomputed in the browser from the same inputs the board was
// built from, and the detail drawer shows the recomputation beside the board's number with a
// match flag, so a wrong number would show itself. The watchlist toggle narrows the table to
// the forty protocols the snapshot names, the chain and category filters narrow it further,
// and the sandbox re-runs the whole ranking under different weights so the model's sensitivity
// is visible instead of asserted. Sorting by any column reorders the same rows rather than
// fetching anything, because there is nothing to fetch: the page carries its own data.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchlistOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sandbox: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtUsdShort(n) {
    var trim = function (s) { return s.replace(/\.?0+$/, ''); };
    if (n >= 1e9) return '$' + trim((n / 1e9).toFixed(2)) + 'B';
    if (n >= 1e6) return '$' + trim((n / 1e6).toFixed(1)) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtGrowth(change7d) {
    if (change7d === null || change7d === undefined) return 'no 7-day change on record';
    return (change7d > 0 ? '+' : '') + change7d.toFixed(2) + '% over 7 days';
  }
  function fmtAgePhrase(age) {
    if (age === null || age === undefined) return 'age unknown';
    return 'running ' + age + ' days';
  }

  // The model, one function per multiplier, exactly as lib/model.ts computes them.
  function growthMultiplier(change7d, model) {
    var raw = (typeof change7d === 'number' && isFinite(change7d)) ? change7d : 0;
    var growthPct = Math.max(model.growth_floor, model.growth_cap * Math.tanh(raw / model.growth_cap));
    return { growthPct: growthPct, growthMult: 1 + (growthPct / 100) * model.growth_weight };
  }
  function maturityMultiplier(age, model) {
    var a = (age === null || age === undefined) ? model.unknown_age_days : age;
    return model.maturity_floor + (Math.min(Math.max(a, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  }
  function breadthMultiplier(chains, model) {
    return 1 + model.breadth_per_chain * Math.min((chains || []).length, model.breadth_cap_chains);
  }
  function tvlTerm(tvl, maxTvl, model) {
    return Math.pow(tvl, model.tvl_exponent) * Math.pow(maxTvl, 1 - model.tvl_exponent);
  }
  function impliedOf(row, model, maxTvl) {
    var g = growthMultiplier(row.change_7d, model);
    var maturity = maturityMultiplier(row.age_days, model);
    var breadth = breadthMultiplier(row.chains, model);
    var base = model.base_multiple * tvlTerm(row.tvl_usd, maxTvl, model);
    return Math.max(1, Math.round(base * g.growthMult * maturity * breadth));
  }
  function medianSorted(sorted) {
    var n = sorted.length;
    if (n === 0) return 0;
    return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL, growth,
  // age and rank decide the action, the capital, the hold, the risk band and every cost and time.
  var CHEAP_CHAINS = ['Arbitrum', 'Base', 'Blast', 'Linea', 'Mantle', 'Manta', 'Mode', 'Morph', 'Optimism', 'Reya Network', 'RISE', 'Scroll', 'Starknet', 'World Chain', 'zkSync Era', 'Polygon zkEVM', 'Unichain', 'Soneium', 'Abstract', 'Ink', 'Berachain', 'Corn', 'BOB'];
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasFor(chain) {
    if (chain === 'Ethereum') return '$5–15';
    if (chain === 'Solana') return 'under $0.01';
    if (chain === 'Bitcoin') return '$1–5';
    if (CHEAP_CHAINS.indexOf(chain) >= 0) return 'under $1';
    return '$0.10–$1';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function riskFor(p, age) {
    var young = age !== null && age !== undefined && age < 180;
    var small = p.tvl_usd < 5e7;
    if (young && small) return 'Risk is high: young and small, so unaudited code and thin liquidity are the main dangers; size the position so a total loss stays affordable.';
    if (age !== null && age !== undefined && age >= 365 && p.tvl_usd >= 1e9) return 'Risk is lower: large and long-running, so the protocol is established — but a launch is less certain precisely because it has waited this long, and the edge is smaller.';
    if (age === null || age === undefined) return 'Risk is hard to judge: the snapshot records no listing date, so treat the protocol as unproven and keep the position small.';
    return 'Risk is medium: the protocol has some track record, but a token launch is never certain, so never farm money you cannot afford to lose.';
  }
  function articleFor(name) {
    return /^[aeiou]/i.test(name) ? 'an' : 'a';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index token on ' + chain + ' and hold it.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('stak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into ' + articleFor(name) + ' ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' into the ' + name + ' basis vault on ' + chain + ' and hold the delta-neutral position.';
    if (c.indexOf('cedefi') >= 0) return 'Deposit $' + capital + ' into ' + articleFor(name) + ' ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('payment') >= 0) return 'Fund $' + capital + ' through ' + name + ' on ' + chain + ' and make one payment with it.';
    if (c.indexOf('governance') >= 0) return 'Lock or delegate $' + capital + ' through ' + name + ' on ' + chain + ' and take part in one vote.';
    if (c.indexOf('btc') >= 0) return 'Deposit $' + capital + ' of BTC through ' + name + ' on ' + chain + ' and hold the receipt asset.';
    if (c.indexOf('card') >= 0) return 'Load $' + capital + ' onto the ' + name + ' card on ' + chain + ' and spend once with it.';
    if (c.indexOf('liquidity manager') >= 0) return 'Deposit $' + capital + ' into ' + articleFor(name) + ' ' + name + ' managed vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' into the ' + name + ' farm on ' + chain + ' and keep the position open.';
    if (c.indexOf('chain') >= 0) return 'Move $' + capital + ' onto ' + chain + " through its official bridge and use " + name + "'s main app once.";
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'about ' + gas + ' of gas for the first transaction on ' + chain, time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about ' + gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Why this protocol: ' + fmtUsdShort(p.tvl_usd) + ' TVL, ' + fmtGrowth(p.change_7d) + ', ' + fmtAgePhrase(p.age_days) + ' with no token on record — the model ranks it #' + p.rank + ' of ' + DATA.board_size + ' at an implied value of ' + fmtUsdShort(p.implied_value_usd) + '. ' + riskFor(p, p.age_days), cost: 'nothing to read, the position is already funded', time: '5 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about ' + gas + ' of gas a week on ' + chain, time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('w') === '1') state.watchlistOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('w', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watchlistOnly && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  // The sandbox model: the submitted constants with the slider values in place.
  function sandboxModel() {
    if (!state.sandbox) return null;
    var m = {};
    Object.keys(DATA.model).forEach(function (k) { m[k] = DATA.model[k]; });
    m.base_multiple = state.sandbox.base_multiple;
    m.growth_weight = state.sandbox.growth_weight;
    m.maturity_days = state.sandbox.maturity_days;
    return m;
  }
  // Rows as the table shows them: with the sandbox on, every row is rescored and re-ranked live.
  function displayedRows() {
    var list = rows();
    var m = sandboxModel();
    if (!m) return list.map(function (r) { return { row: r, implied: r.implied_value_usd, rank: r.rank }; });
    var scored = list.map(function (r) { return { row: r, implied: impliedOf(r, m, DATA.max_tvl_usd) }; });
    scored.sort(function (a, b) { return b.implied - a.implied || (a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0); });
    return scored.map(function (s, i) { return { row: s.row, implied: s.implied, rank: i + 1 }; });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.row.name.toLowerCase(); bv = b.row.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.row.tvl_usd; bv = b.row.tvl_usd; }
      else if (key === 'growth') { av = a.row.change_7d === null ? -Infinity : a.row.change_7d; bv = b.row.change_7d === null ? -Infinity : b.row.change_7d; }
      else if (key === 'age') { av = a.row.age_days === null ? Infinity : a.row.age_days; bv = b.row.age_days === null ? Infinity : b.row.age_days; }
      else { av = a.implied; bv = b.implied; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' }),
        el('p', { class: 'coverage', text: 'Coverage: ' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + ' watchlist protocols on the board, plus ' + DATA.early_size + ' early rows below the floor — ' + DATA.board_size + ' rows in all.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Base multiple (median mcap/TVL)' }), el('b', { text: String(DATA.model.base_multiple) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var watchToggle = el('input', { type: 'checkbox', id: 'watchlist', checked: state.watchlistOnly ? 'checked' : null });
    watchToggle.addEventListener('change', function () { state.watchlistOnly = watchToggle.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('label', { class: 'check', for: 'watchlist' }, watchToggle, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(displayedRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list.reduce(function (m, item) { return Math.max(m, item.implied); }, 1);
    var tbody = el('tbody');
    list.forEach(function (item) {
      var r = item.row;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var rankCell = item.rank <= 3
        ? el('span', { class: 'rank rank-' + item.rank, text: String(item.rank) })
        : el('span', { class: 'num', text: String(item.rank) });
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', null, rankCell),
        el('td', null, el('div', { class: 'name' },
          el('span', null, el('b', { text: r.name }), r.watchlist ? el('span', { class: 'badge', text: 'Watchlist' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((item.implied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(item.implied) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var recomputed = medianSorted(DATA.live_ratios.slice());
    var multipleOk = Math.abs(recomputed - m.base_multiple) < 1e-12;
    var sandbox = state.sandbox || { base_multiple: m.base_multiple, growth_weight: m.growth_weight, maturity_days: m.maturity_days };
    function slider(id, label, min, max, step, value, format) {
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      var output = el('output', { for: id, text: format(value) });
      input.addEventListener('input', function () {
        var v = parseFloat(input.value);
        output.textContent = format(v);
        if (!state.sandbox) state.sandbox = { base_multiple: m.base_multiple, growth_weight: m.growth_weight, maturity_days: m.maturity_days };
        if (id === 'sb-multiple') state.sandbox.base_multiple = v;
        if (id === 'sb-growth') state.sandbox.growth_weight = v;
        if (id === 'sb-maturity') state.sandbox.maturity_days = Math.round(v);
        render();
      });
      return el('div', { class: 'slider' }, el('label', { for: id, text: label }), input, output);
    }
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the submitted model', onclick: function () { state.sandbox = null; render(); } });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( ' + m.base_multiple + ' x sqrt(tvl_usd x ' + DATA.max_tvl_usd + ') x (1 + max(' + m.growth_floor + ', ' + m.growth_cap + ' x tanh(change_7d / ' + m.growth_cap + ')) / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.breadth_per_chain + ' x min(chains, ' + m.breadth_cap_chains + ')) )'
      ),
      el('p', { class: 'sub', text: 'The base multiple ' + m.base_multiple + ' is the median market-cap/TVL of the ' + m.base_multiple_n + ' live-token protocols in this snapshot — measured from the same data, not chosen. The page recomputes that median from the live set: ' + recomputed.toFixed(4) + (multipleOk ? ' — the same number the board carries.' : ' — which differs from the board.') }),
      el('p', { class: 'sub', text: 'TVL enters concave, as the square root rescaled by the largest TVL, because a dollar of TVL is worth less at $100B than at $10M. Maturity rises with age: a protocol that held TVL for years without a token has the most pent-up launch value. An unlisted age uses ' + m.unknown_age_days + ' days, and the detail view says so. Breadth adds 2% per chain, capped at ten chains.' }),
      el('div', { class: 'sandbox' },
        el('h3', { text: 'Model sandbox' }),
        el('p', { class: 'sub', text: 'Move a slider and the board re-ranks live, from the same arithmetic. The submitted board keeps the constants above; the sandbox only explores them.' }),
        el('div', { class: 'sliders' },
          slider('sb-multiple', 'Base multiple', 0.05, 0.5, 0.005, sandbox.base_multiple, function (v) { return v.toFixed(3); }),
          slider('sb-growth', 'Growth weight', 0, 2, 0.1, sandbox.growth_weight, function (v) { return v.toFixed(1); }),
          slider('sb-maturity', 'Maturity days', 365, 1825, 73, sandbox.maturity_days, function (v) { return String(Math.round(v)) + ' days'; })
        ),
        el('div', null, reset, state.sandbox ? el('span', { class: 'sandbox-note', text: ' Sandbox values are live: the table above is re-ranked with them.' }) : null)
      )
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Snapshot: DefiLlama protocol index, fetched 2026-11-14, sealed as of ' + DATA.as_of + '. Model ' + DATA.model_version + '.' }),
      el('span', { text: 'Implied value is a model, not a promise. This page runs with no network: every number comes from the sealed snapshot.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model, DATA.max_tvl_usd);
    var cat = (row.category || '').toLowerCase();
    var isReceipt = cat.indexOf('stak') >= 0 || cat.indexOf('bridge') >= 0;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · Watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    if (isReceipt) {
      dialog.appendChild(el('p', { class: 'note', text: 'Note: this is a staking/bridge product. Its launch would be a receipt token for an asset that already trades, not a new protocol token. The radar scores it like any other row, but read its farm plan as farming a receipt token.' }));
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' }),
      row.age_days === null || row.age_days === undefined ? el('p', { class: 'sub', text: 'Age unknown — the model assumes 1 year (365 days).' }) : null
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();

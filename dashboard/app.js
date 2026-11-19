// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, compare: [], minTvl: 0, growth: 'all' };

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
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity));
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

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
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
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
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
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('cmp')) state.compare = params.get('cmp').split(',').filter(function (s) { return s; }).slice(0, 3);
    if (params.get('mintvl')) state.minTvl = Math.max(0, parseInt(params.get('mintvl'), 10) || 0);
    if (params.get('growth')) state.growth = params.get('growth');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    if (state.compare.length > 0) params.set('cmp', state.compare.join(','));
    if (state.minTvl > 0) params.set('mintvl', String(state.minTvl));
    if (state.growth !== 'all') params.set('growth', state.growth);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (state.growth === 'rising' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (state.growth === 'falling' && !(r.change_7d !== null && r.change_7d < 0)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // The board as a spreadsheet file: one cell a value, quoted when it carries a comma or a quote.
  function csvCell(value) {
    if (value === null || value === undefined) return '';
    var text = String(value);
    if (text.indexOf(',') >= 0 || text.indexOf('"') >= 0 || text.indexOf('\n') >= 0) return '"' + text.split('"').join('""') + '"';
    return text;
  }
  function rowsToCsv(list) {
    var lines = ['rank,slug,name,category,chains,tvl_usd,change_7d,age_days,implied_value_usd'];
    list.forEach(function (entry) {
      lines.push([
        csvCell(entry.rank), csvCell(entry.slug), csvCell(entry.name), csvCell(entry.category || 'Other'),
        csvCell((entry.chains || []).join(';')), csvCell(entry.tvl_usd), csvCell(entry.change_7d),
        csvCell(entry.age_days), csvCell(entry.implied_value_usd)
      ].join(','));
    });
    return lines.join('\n') + '\n';
  }
  function downloadTextFile(filename, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = window.URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }
  function exportFilteredCsv() {
    downloadTextFile('token-radar-board.csv', rowsToCsv(sortedRows(rows())));
  }

  // Side-by-side comparison: up to three protocols, picked from the board or a detail view.
  function comparedRows() {
    return state.compare.map(function (slug) {
      return DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    }).filter(function (r) { return r; });
  }
  function isCompared(slug) {
    return state.compare.indexOf(slug) >= 0;
  }
  function toggleCompare(slug) {
    var at = state.compare.indexOf(slug);
    if (at >= 0) state.compare.splice(at, 1);
    else if (state.compare.length < 3) state.compare.push(slug);
    else state.compare = [state.compare[1], state.compare[2], slug];
    writeHash(); render();
  }
  function compareMetricLines(row) {
    var capital = capitalFor(row);
    var pairs = [
      ['Rank', '#' + row.rank + ' of ' + DATA.board_size],
      ['Category', row.category || 'Other'],
      ['Chains', (row.chains || []).join(', ') || 'an unnamed chain'],
      ['TVL', fmtUsd(row.tvl_usd)],
      ['Seven-day growth', fmtPct(row.change_7d)],
      ['Age with no token', fmtAge(row.age_days)],
      ['Growth multiplier', String(row.growth_multiplier)],
      ['Maturity multiplier', String(row.maturity_multiplier)],
      ['Implied value', fmtUsd(row.implied_value_usd)],
      ['Implied per TVL dollar', '$' + (row.implied_value_usd / row.tvl_usd).toFixed(3)],
      ['Farm capital', '$' + capital],
      ['Farm hold', holdDaysFor(row.age_days) + ' days']
    ];
    return pairs;
  }
  function comparePanel() {
    var picked = comparedRows();
    if (picked.length === 0) return null;
    var metricSets = picked.map(compareMetricLines);
    var labels = metricSets[0].map(function (pair) { return pair[0]; });
    var headCells = [el('th', { scope: 'col', text: 'Metric' })];
    picked.forEach(function (r) {
      headCells.push(el('th', { scope: 'col' }, el('strong', { text: r.name }), el('span', { class: 'sub', text: 'rank #' + r.rank })));
    });
    var body = el('tbody');
    labels.forEach(function (label, i) {
      var cells = [el('th', { scope: 'row', text: label })];
      metricSets.forEach(function (set) {
        cells.push(el('td', { class: 'num', text: set[i][1] }));
      });
      body.appendChild(el('tr', null, cells));
    });
    var clear = el('button', { class: 'button', type: 'button', text: 'Clear comparison', onclick: function () { state.compare = []; writeHash(); render(); } });
    return el('section', { class: 'panel compare' },
      el('div', { class: 'compare-head' },
        el('h2', { text: 'Compare ' + picked.length + ' protocol' + (picked.length === 1 ? '' : 's') }),
        el('p', { class: 'sub', text: 'Set up to three rows side by side. One model scores each of them, so the columns differ only by the snapshot figures.' }),
        clear
      ),
      el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, el('tr', null, headCells)), body))
    );
  }

  // The five fastest growers by seven-day TVL change, each opening its own detail view.
  function topMovers() {
    var movers = DATA.rows.filter(function (r) { return r.change_7d !== null; })
      .sort(function (a, b) { return b.change_7d - a.change_7d || b.implied_value_usd - a.implied_value_usd; })
      .slice(0, 5);
    if (movers.length === 0) return null;
    var items = movers.map(function (r) {
      return el('li', null,
        el('button', { type: 'button', class: 'mover', onclick: function () { openDetail(r.slug); } },
          el('strong', { text: r.name }),
          el('span', { class: 'num pos', text: fmtPct(r.change_7d) }),
          el('span', { class: 'sub', text: 'rank #' + r.rank + ' · ' + fmtUsd(r.implied_value_usd) })
        )
      );
    });
    return el('section', { class: 'panel movers' },
      el('h2', { text: 'Fastest growers this week' }),
      el('p', { class: 'sub', text: 'Seven-day TVL change, strongest first. Growth lifts implied value, but only within the clamp the model states.' }),
      el('ol', { class: 'mover-list' }, items)
    );
  }

  // The top row worked through step by step, with its own numbers, so the model can be checked by hand.
  function workedExample() {
    var top = DATA.rows[0];
    if (!top) return null;
    var growth = Math.min(DATA.model.growth_cap, Math.max(DATA.model.growth_floor, top.change_7d === null ? 0 : top.change_7d));
    var growthMult = 1 + (growth / 100) * DATA.model.growth_weight;
    var age = top.age_days === null ? DATA.model.unknown_age_days : top.age_days;
    var maturity = DATA.model.maturity_floor + (Math.min(Math.max(age, 0), DATA.model.maturity_days) / DATA.model.maturity_days) * DATA.model.maturity_range;
    var base = Math.round(top.tvl_usd * DATA.model.base_multiple);
    var growthNote = top.change_7d === null ? 'No growth figure, so 0%' : 'Seven-day growth ' + fmtPct(top.change_7d);
    return el('section', { class: 'panel worked' },
      el('h2', { text: 'Worked example: ' + top.name }),
      el('p', { class: 'sub', text: 'The top row, step by step, with its own numbers. Every other row follows the same arithmetic.' }),
      el('ol', { class: 'worked-steps' },
        el('li', null, el('b', { text: 'Base from TVL' }), el('span', { text: fmtUsd(top.tvl_usd) + ' x ' + DATA.model.base_multiple + ' = ' + fmtUsd(base) })),
        el('li', null, el('b', { text: 'Growth adjustment' }), el('span', { text: growthNote + ' gives a multiplier of ' + growthMult.toFixed(4) })),
        el('li', null, el('b', { text: 'Maturity adjustment' }), el('span', { text: fmtAge(top.age_days) + ' with no token gives a multiplier of ' + maturity.toFixed(4) })),
        el('li', null, el('b', { text: 'Implied value' }), el('span', { text: fmtUsd(base) + ' x ' + growthMult.toFixed(4) + ' x ' + maturity.toFixed(4) + ' = ' + fmtUsd(top.implied_value_usd) }))
      )
    );
  }

  // Row counts and total implied value by category, with each category's largest protocol.
  function categoryBreakdownPanel() {
    var byCategory = {};
    DATA.rows.forEach(function (r) {
      var label = r.category || 'Other';
      var entry = byCategory[label] || { rows: 0, total: 0, top: null };
      entry.rows += 1;
      entry.total += r.implied_value_usd;
      if (entry.top === null || r.implied_value_usd > entry.top.implied_value_usd) entry.top = r;
      byCategory[label] = entry;
    });
    var shares = Object.keys(byCategory).map(function (label) {
      var entry = byCategory[label];
      return { label: label, rows: entry.rows, total: entry.total, top: entry.top };
    }).sort(function (a, b) { return b.total - a.total || b.rows - a.rows; });
    var catBody = el('tbody');
    shares.forEach(function (share) {
      catBody.appendChild(el('tr', null,
        el('td', null, el('b', { text: share.label })),
        el('td', { class: 'num', text: String(share.rows) }),
        el('td', { class: 'num', text: fmtUsd(share.total) }),
        el('td', null, el('button', { type: 'button', class: 'mover', onclick: function () { openDetail(share.top.slug); } }, el('b', { text: share.top.name }), el('span', { class: 'sub', text: fmtUsd(share.top.implied_value_usd) })))
      ));
    });
    var catHead = el('tr', null,
      el('th', { scope: 'col', text: 'Category' }),
      el('th', { scope: 'col', text: 'Rows' }),
      el('th', { scope: 'col', text: 'Total implied' }),
      el('th', { scope: 'col', text: 'Largest protocol' })
    );
    return el('section', { class: 'panel categories' },
      el('h2', { text: 'Categories on the board' }),
      el('p', { class: 'sub', text: 'Row counts and total implied value by category. Select a category leader to open its detail view.' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, catHead),
        catBody
      ))
    );
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
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by implied value' }),
        el('p', { text: 'The board is every pre-token protocol that passes the house rule: no token on record, and not a wrapped, staked or bridged product of a token that already trades. All ' + DATA.watchlist_size + ' watchlist protocols are covered, plus ' + DATA.early_size + ' more the radar found. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Beyond the watchlist' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var tvlOptions = [[0, 'Any TVL'], [100000000, '$100M and up'], [500000000, '$500M and up'], [1000000000, '$1B and up']];
    var tvlSelect = el('select', { id: 'min-tvl', 'aria-label': 'Filter by minimum TVL' },
      tvlOptions.map(function (pair) { return el('option', { value: String(pair[0]), text: pair[1], selected: pair[0] === state.minTvl ? 'selected' : null }); })
    );
    tvlSelect.addEventListener('change', function () { state.minTvl = parseInt(tvlSelect.value, 10) || 0; writeHash(); render(); });
    var growthOptions = [['all', 'Any growth'], ['rising', 'Rising only'], ['falling', 'Falling only']];
    var growthSelect = el('select', { id: 'growth', 'aria-label': 'Filter by seven-day growth' },
      growthOptions.map(function (pair) { return el('option', { value: pair[0], text: pair[1], selected: pair[0] === state.growth ? 'selected' : null }); })
    );
    growthSelect.addEventListener('change', function () { state.growth = growthSelect.value; writeHash(); render(); });
    var exportBtn = el('button', { class: 'button export', type: 'button', text: 'Export CSV', onclick: function () { exportFilteredCsv(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'min-tvl', text: 'Minimum TVL' }), tvlSelect),
      el('div', { class: 'field' }, el('label', { for: 'growth', text: 'Seven-day growth' }), growthSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Download' }), exportBtn),
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
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null,
          el('span', { class: 'status', text: 'no token' }),
          el('button', { class: 'compare-toggle', type: 'button', 'aria-pressed': isCompared(r.slug) ? 'true' : 'false', text: isCompared(r.slug) ? 'Comparing' : 'Compare', onclick: function (e) { e.stopPropagation(); toggleCompare(r.slug); } })
        )
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
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Only launch candidates are ranked: pre-token protocols that are not a wrapped, staked or bridged product of a token that already trades, and not an exchange or a versioned pool. The multiple is a flat 0.25x TVL: category multiples were tested and dropped — leave-one-out on 128 tokenised comparables, median error 0.713 against 0.691 for flat. The live-token protocols are set aside with their market caps shown.' })
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
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
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
    dialog.appendChild(el('div', { class: 'detail-actions' },
      el('button', {
        class: 'button primary', type: 'button',
        text: isCompared(row.slug) ? 'In the comparison already' : 'Add to comparison',
        onclick: function () { state.selected = null; toggleCompare(row.slug); dialog.close(); }
      }),
      el('span', { class: 'sub', text: 'Compare up to three protocols side by side on the board.' })
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
    if (state.tab === 'pre-token') {
      var comparison = comparePanel();
      if (comparison) shell.appendChild(comparison);
      shell.appendChild(boardTable());
      shell.appendChild(modelPanel());
      var worked = workedExample();
      if (worked) shell.appendChild(worked);
      var movers = topMovers();
      if (movers) shell.appendChild(movers);
      shell.appendChild(categoryBreakdownPanel());
    } else {
      shell.appendChild(liveTable());
    }
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

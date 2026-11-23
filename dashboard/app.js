// Launch Scope v3 dashboard: no network, no fetch. All figures come from data.js.
// The farm steps below use the same words and the same arithmetic as lib/model.ts's
// planFarm, so the detail view and board.json say the same thing about every row.
(function () {
  'use strict';
  var D = window.LAUNCH_SCOPE_V3;
  var cover = D.cover;
  var rows = D.rows;
  var POOL = { mid: 0.05, low: 0.03, high: 0.1 };
  var OPPY = 0.05;
  var TIERS = [100, 1000, 10000];
  var STAKE = 10000;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function holdFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 90) return 90;
    if (age < 365) return 60;
    return 30;
  }
  function gasPerAction(chains) {
    return chains.length > 0 && chains[0].toLowerCase() === 'ethereum' ? 8 : 3;
  }
  function hoursFor(hold) {
    return 0.5 + 0.25 * Math.ceil(hold / 7) + 0.25;
  }
  function shortUsd(n) {
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
    return '$' + n.toFixed(2);
  }
  function money(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function deedFor(name, category, stake, chain) {
    var kind = (category || '').toLowerCase();
    if (kind.indexOf('lend') >= 0 || kind.indexOf('cdp') >= 0 || kind.indexOf('collateral') >= 0) {
      return 'Lend $' + stake + ' of USDC into ' + name + ' on ' + chain + ' and leave the loan open.';
    }
    if (kind.indexOf('dex') >= 0 || kind.indexOf('amm') >= 0 || kind.indexOf('swap') >= 0) {
      return 'Add $' + stake + ' of liquidity to the busiest ' + name + ' pool on ' + chain + ' and leave it in.';
    }
    if (kind.indexOf('bridge') >= 0) {
      return 'Move $' + stake + ' of USDC onto ' + chain + ' with ' + name + ' and put the bridged funds to work in its app.';
    }
    if (kind.indexOf('stak') >= 0 || kind.indexOf('restak') >= 0) {
      return 'Stake $' + stake + ' of the native staking asset through ' + name + ' and keep the receipt token.';
    }
    if (kind.indexOf('perp') >= 0 || kind.indexOf('deriv') >= 0) {
      return 'Post $' + stake + ' of USDC as collateral on ' + name + ' and open one small hedged position.';
    }
    if (kind.indexOf('predict') >= 0) {
      return 'Back one market on ' + name + ' with $' + stake + ' and let it settle.';
    }
    if (kind.indexOf('vault') >= 0 || kind.indexOf('curator') >= 0 || kind.indexOf('allocat') >= 0) {
      return 'Place $' + stake + ' into a ' + name + ' vault on ' + chain + ' and hold the vault shares.';
    }
    if (kind.indexOf('stable') >= 0) {
      return 'Mint or hold $' + stake + ' of the dollar asset ' + name + ' issues on ' + chain + '.';
    }
    if (kind.indexOf('rwa') >= 0 || kind.indexOf('real world') >= 0) {
      return 'Mint $' + stake + ' of ' + name + '\'s tokenised yield asset on ' + chain + ' and hold it.';
    }
    if (kind.indexOf('insur') >= 0) {
      return 'Buy $' + stake + ' of cover from ' + name + ' on ' + chain + ' and keep the policy live.';
    }
    return 'Put $' + stake + ' of USDC to work in ' + name + ' on ' + chain + ' and leave the position open.';
  }
  // The same five steps lib/model.ts writes into board.json, from the same fields.
  function farmSteps(row) {
    var name = row[2], category = row[3], chains = row[4].split('|'), tvl = row[5];
    var age = row[8], ev = row[11], verdict = row[12];
    var chain = chains.length > 0 ? chains[0] : 'its home chain';
    var hold = holdFor(age);
    var gas = 3 * gasPerAction(chains);
    var hours = hoursFor(hold);
    var share = STAKE / tvl;
    var expLow = share * POOL.low * ev, expMid = share * POOL.mid * ev, expHigh = share * POOL.high * ev;
    var opp = STAKE * OPPY * (hold / 365);
    var usdHr = (expMid - gas - opp) / hours;
    var gpa = gasPerAction(chains);
    return [
      'Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. It costs under $3 of gas for the first transaction and takes about 5 minutes.',
      deedFor(name, category, STAKE, chain) + ' It costs $' + STAKE + ' of capital and about $' + gas + ' of gas, and takes about 15 minutes to set up.',
      'Do one qualifying action every week, like a deposit, a borrow, a swap or a vote, so the wallet stays active. It costs about $' + gpa + ' of gas a week and takes about 10 minutes a week.',
      'Keep the position open for at least ' + hold + ' days so the activity lands in more than one snapshot. The $' + STAKE + ' stays in the position for those ' + hold + ' days.',
      'Verdict ' + verdict + ': at $' + STAKE + ' this farm expects ' + shortUsd(expLow) + '-' + shortUsd(expHigh) + ' against $' + gas + ' of gas plus $' + opp.toFixed(2) + ' of forgone yield, about $' + usdHr.toFixed(2) + ' an hour over ' + hours.toFixed(2) + ' hours. Before you withdraw, open the protocol\'s own points page from the link it publishes and claim only there.'
    ];
  }
  function ageBand(age) {
    if (age === null || age === undefined) return 'unknown';
    if (age < 90) return '<90d';
    if (age < 365) return '90-365d';
    if (age < 730) return '1-2y';
    return '2y+';
  }
  function tvlBand(tvl) {
    if (tvl < 50000000) return '<50M';
    if (tvl < 250000000) return '50-250M';
    if (tvl < 1000000000) return '250M-1B';
    return '1B+';
  }
  function tierUsdHr(row, deposit, holdDays) {    var chains = row[4].split('|'), tvl = row[5], age = row[8], ev = row[11];
    var hold = holdDays === undefined ? holdFor(age) : holdDays;
    var gas = 3 * gasPerAction(chains);
    var hours = hoursFor(hold);
    var expMid = (deposit / tvl) * POOL.mid * ev;
    var opp = deposit * OPPY * (hold / 365);
    return (expMid - gas - opp) / hours;
  }
  function breakEven(row) {
    var chains = row[4].split('|'), tvl = row[5], age = row[8], ev = row[11];
    var hold = holdFor(age);
    var gas = 3 * gasPerAction(chains);
    var perDollar = (POOL.mid * ev) / tvl - OPPY * (hold / 365);
    if (perDollar <= 0) return null;
    return Math.ceil(gas / perDollar);
  }

  // ---- cover: KPI strip, integrity, self-check
  var wf = cover.walkForward;
  document.getElementById('kpi').innerHTML =
    '<div class="k"><b>x' + cover.loo.median.toFixed(2) + '</b><span>leave-one-out median error (' + cover.loo.n + ' anchors)</span></div>' +
    '<div class="k"><b>' + (wf ? 'x' + wf.median.toFixed(2) : 'n/a') + '</b><span>walk-forward median error' + (wf ? ' (' + wf.n + ' tested)' : '') + '</span></div>' +
    '<div class="k"><b>' + cover.fit.r2.toFixed(2) + '</b><span>fit R2 on ' + cover.fit.anchors + ' live anchors</span></div>' +
    '<div class="k"><b>' + cover.verdicts.FARM + ' / ' + cover.verdicts.THIN + ' / ' + cover.verdicts.SKIP + '</b><span>FARM / THIN / SKIP verdicts</span></div>';
  document.getElementById('integrity').textContent =
    'Assumptions: ' + cover.assumptions.join(' ') + ' Limits: ' + cover.limits.join(' ');
  var check = document.createElement('ul');
  check.className = 'small';
  cover.selfCheck.forEach(function (s) {
    var li = document.createElement('li');
    li.textContent = '✓ ' + s;
    check.appendChild(li);
  });
  document.getElementById('cover').appendChild(check);

  // ---- board: filter, sort, render
  var q = document.getElementById('q');
  var verdictSel = document.getElementById('verdict');
  var catSel = document.getElementById('category');
  var sortSel = document.getElementById('sort');
  var tbody = document.getElementById('rows');
  var cats = {};
  rows.forEach(function (r) { if (r[3]) cats[r[3]] = 1; });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c; catSel.appendChild(o);
  });
  var sortKey = 'rank', sortDir = 1;
  function visible() {
    var needle = q.value.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (verdictSel.value && r[12] !== verdictSel.value) return false;
      if (catSel.value && r[3] !== catSel.value) return false;
      if (needle && (r[1] + ' ' + r[2] + ' ' + (r[3] || '')).toLowerCase().indexOf(needle) < 0) return false;
      return true;
    });
    var key = sortKey;
    list.sort(function (a, b) {
      var av, bv;
      if (key === 'rank') { av = a[0]; bv = b[0]; }
      else if (key === 'ev') { av = a[11]; bv = b[11]; }
      else if (key === 'odds') { av = a[10]; bv = b[10]; }
      else if (key === 'usd') { av = a[13]; bv = b[13]; }
      else if (key === 'tvl') { av = a[5]; bv = b[5]; }
      else { av = a[2].toLowerCase(); bv = b[2].toLowerCase(); }
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return a[0] - b[0];
    });
    return list;
  }
  function ageText(age) {
    if (age === null || age === undefined) return '—';
    if (age < 365) return age + 'd';
    return (age / 365).toFixed(1) + 'y';
  }
  function render() {
    var list = visible();
    document.getElementById('count').textContent = list.length + ' of ' + rows.length + ' ranked';
    var html = '';
    list.forEach(function (r) {
      html += '<tr data-slug="' + esc(r[1]) + '"><td class="r">' + r[0] + '</td>' +
        '<td><span class="name">' + esc(r[2]) + '</span><br><span class="cat">' + esc(r[3] || '—') + ' · ' + esc(r[4].split('|').join(', ')) + '</span></td>' +
        '<td><span class="badge ' + r[12] + '">' + r[12] + '</span></td>' +
        '<td class="num">' + money(r[11]) + '</td>' +
        '<td class="num">' + (r[10] * 100).toFixed(0) + '%</td>' +
        '<td class="num">' + money(r[9]) + '</td>' +
        '<td class="num">' + (r[13] >= 0 ? '$' : '−$') + Math.abs(r[13]).toFixed(2) + '</td>' +
        '<td class="num">' + money(r[5]) + '</td>' +
        '<td class="num">' + ageText(r[8]) + '</td></tr>';
    });
    tbody.innerHTML = html;
  }
  tbody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  document.querySelectorAll('#board th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = k === 'name' ? 1 : -1; }
      render();
    });
  });
  [q, verdictSel, catSel, sortSel].forEach(function (el) {
    el.addEventListener('input', function () {
      if (el === sortSel) { sortKey = sortSel.value === 'rank' ? 'rank' : sortSel.value; sortDir = sortKey === 'rank' ? 1 : -1; }
      render();
    });
  });

  // ---- detail view + farm matrix
  var detailEl = document.getElementById('detail');
  var matrixEl = document.getElementById('matrixwrap');
  function showDetail(slug) {
    var row = null;
    rows.forEach(function (r) { if (r[1] === slug) row = r; });
    if (!row) return;
    var chains = row[4].split('|');
    var hold = holdFor(row[8]);
    var be = breakEven(row);
    var steps = farmSteps(row);
    var tiersHtml = TIERS.map(function (dep) {
      var share = dep / row[5];
      var expLow = share * POOL.low * row[11], expMid = share * POOL.mid * row[11], expHigh = share * POOL.high * row[11];
      var gas = 3 * gasPerAction(chains);
      var opp = dep * OPPY * (hold / 365);
      var hrs = hoursFor(hold);
      var usd = (expMid - gas - opp) / hrs;
      return '<tr><td class="num">$' + dep.toLocaleString('en-US') + '</td><td class="num">' + shortUsd(expLow) + ' – ' + shortUsd(expHigh) + '</td><td class="num">$' + gas + '</td><td class="num">$' + opp.toFixed(2) + '</td><td class="num">' + hrs.toFixed(2) + 'h</td><td class="num">' + (usd >= 0 ? '$' : '−$') + Math.abs(usd).toFixed(2) + '/h</td></tr>';
    }).join('');
    var horizons = [30, 60, 90];
    var mhead = '<tr><th>Deposit \\ horizon</th>' + horizons.map(function (h) { return '<th>' + h + ' days</th>'; }).join('') + '</tr>';
    var mrows = TIERS.map(function (dep) {
      var cells = horizons.map(function (h) {
        var v = tierUsdHr(row, dep, h);
        var cls = v >= 10 ? 'best' : (v < 0 ? 'neg' : '');
        return '<td class="' + cls + '">' + (v >= 0 ? '$' : '−$') + Math.abs(v).toFixed(2) + '</td>';
      }).join('');
      return '<tr><td>$' + dep.toLocaleString('en-US') + '</td>' + cells + '</tr>';
    }).join('');
    detailEl.hidden = false;
    detailEl.innerHTML = '<div class="card"><h2>' + esc(row[2]) + ' <span class="badge ' + row[12] + '">' + row[12] + '</span></h2>' +
      '<p class="muted small">' + esc(row[3] || '—') + ' · ' + esc(chains.join(', ')) + ' · listed ' + esc(row[7] || 'unknown') + ' · odds cohort ' + esc(ageBand(row[8]) + ' × ' + tvlBand(row[5])) + '</p>' +
      '<div class="grid">' +
      '<div class="cell"><b>' + money(row[11]) + '</b><span>expected value (fitted × odds)</span></div>' +
      '<div class="cell"><b>' + money(row[9]) + '</b><span>fitted token value</span></div>' +
      '<div class="cell"><b>' + (row[10] * 100).toFixed(0) + '%</b><span>odds a token ever lists</span></div>' +
      '<div class="cell"><b>' + (row[13] >= 0 ? '$' : '−$') + Math.abs(row[13]).toFixed(2) + '/h</b><span>farm $/hour at $10,000</span></div>' +
      '<div class="cell"><b>' + money(row[5]) + '</b><span>TVL</span></div>' +
      '<div class="cell"><b>' + (row[6] === null ? '—' : (row[6] >= 0 ? '+' : '') + row[6] + '%') + '</b><span>7-day TVL change</span></div>' +
      '<div class="cell"><b>' + ageText(row[8]) + '</b><span>age, ' + hold + '-day hold</span></div>' +
      '<div class="cell"><b>' + (be === null ? 'never' : '$' + be.toLocaleString('en-US')) + '</b><span>break-even deposit</span></div>' +
      '</div>' +
      '<h3>Farm plan by deposit</h3><table><thead><tr><th>Deposit</th><th>Expected value</th><th>Gas</th><th>Forgone yield</th><th>Hours</th><th>$/hour</th></tr></thead><tbody>' + tiersHtml + '</tbody></table>' +
      '<h3>Farm steps — $10,000 plan</h3><ol class="steps">' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="small muted">Verdict ' + row[12] + ' is read off the $10,000 tier at $10/hour. The farmer pool is 5% of the token value (3–10% shown); a deposit earns its pro-rata share of TVL.</p></div>';
    matrixEl.hidden = false;
    matrixEl.innerHTML = '<div class="card"><h3>Farm matrix — $/hour by deposit and horizon</h3>' +
      '<table class="matrix">' + mhead + mrows + '</table>' +
      '<p class="small muted">Green is $10/hour or more. The hold in the main plan is ' + hold + ' days, set from this protocol\u2019s age.</p></div>';
    detailEl.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  // ---- live tokens + accounting
  var liveHtml = '<div class="card"><h3>Already live — at the market\u2019s value, never ranked as launches</h3><p class="small muted">Top ' + D.liveTop.length + ' of ' + cover.accounting.live + ' protocols whose token already trades. They anchor the value fit; they are not farms.</p><table><thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>mcap / TVL</th></tr></thead><tbody>' +
    D.liveTop.map(function (p) {
      return '<tr><td><span class="name">' + esc(p.name) + '</span><br><span class="cat">' + esc(p.category || '—') + '</span></td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + (p.mcap_usd / p.tvl_usd).toFixed(2) + '×</td></tr>';
    }).join('') + '</tbody></table></div>';
  document.getElementById('live').innerHTML = liveHtml;
  var acc = cover.accounting;
  var accHtml = '<div class="card"><h3>Accounting — all ' + acc.total + ' protocols in the snapshot</h3>' +
    '<p>Ranked as launch candidates: <b>' + acc.ranked + '</b>. Live at market value: <b>' + acc.live + '</b>. Token recorded with no market price: <b>' + acc.recordedNoPrice + '</b>. Excluded from ranking, with a reason:</p><ul>' +
    acc.excluded.map(function (e) { return '<li>' + esc(e.reason) + ': ' + e.count + '</li>'; }).join('') + '</ul>' +
    '<p class="small muted">The full lists ride in board.json. Snapshot: ' + esc(cover.source) + ' · as of ' + esc(cover.asOf) + ' · ' + cover.missing.listedAt + ' protocols with no listed date, ' + cover.missing.change7d + ' with no 7-day change, ' + cover.missing.mcapNonPositive + ' live records with mcap at or below $0 (excluded from the fit).</p></div>';
  document.getElementById('accounting').innerHTML = accHtml;

  // ---- deep links: ?detail=slug and ?verdict=FARM (used by the screenshots)
  var params = new URLSearchParams(window.location.search);
  if (params.get('verdict')) {
    verdictSel.value = params.get('verdict');
  }
  render();
  if (params.get('detail')) {
    showDetail(params.get('detail'));
  }
})();

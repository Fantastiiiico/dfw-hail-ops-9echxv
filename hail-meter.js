/* Hail meter. Uses the same public storm files as the hail map (MESH radar swaths and ground reports).
   No owner names, phones, or emails. A missing feed is "data unavailable", never a guessed size. */
(function () {
  var NEAR = 10, CLOSE = 3, GAUGE_MAX = 2.5;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function miles(lat, lon, la, lo) {
    var k = Math.cos(lat * Math.PI / 180);
    var dy = (la - lat) * 69.05, dx = (lo - lon) * 69.05 * k;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function daysNear(MI, lat, lon) {
    var seen = {}, out = [], dl = 0.15, dn = 0.15 / Math.cos(lat * Math.PI / 180);
    var a0 = Math.floor((lat - dl) * 10), a1 = Math.floor((lat + dl) * 10);
    var b0 = Math.floor((lon - dn) * 10), b1 = Math.floor((lon + dn) * 10);
    for (var a = a0; a <= a1; a++) for (var b = b0; b <= b1; b++) {
      (MI.cells[a + '_' + b] || []).forEach(function (i) {
        var d = MI.days[i];
        if (!seen[d]) { seen[d] = 1; out.push(d); }
      });
    }
    return out;
  }
  function sizeLabel(n, source) {
    var num = n >= 2.5 ? '2.50"+' : n.toFixed(2) + '"';
    if (source === 'radar') return 'about ' + num + (n >= 2.5 ? '' : ' or larger') + ' (radar estimate)';
    return num + ' (ground report)';
  }
  function distLabel(d) {
    if (!(d > 0.05)) return 'at this spot';
    return (d < 1 ? d.toFixed(2) : d.toFixed(1)) + ' mi away';
  }
  function better(a, b) {
    if (a.size !== b.size) return a.size > b.size;
    if (Math.abs(a.dist - b.dist) > 0.02) return a.dist < b.dist;
    return a.date > b.date;
  }
  function pick(cands, pred) {
    var best = null;
    cands.forEach(function (c) {
      if (!pred(c)) return;
      if (!best || better(c, best)) best = c;
    });
    return best;
  }
  /* Rating uses the reading on the gauge.
     High: 1.50" or larger, within 3 miles, 365-day window still open.
     Moderate: 0.75" up to but not including 1.50", within 3 miles, window still open.
     Low: hail within 10 miles that is smaller than 0.75", farther than 3 miles, or the window is closed.
     None: no hail within 10 miles in the loaded data. */
  function rate(ev) {
    if (!ev) return { key: 'none', name: 'None' };
    var open = ev.left >= 0, close = ev.dist <= CLOSE;
    if (open && close && ev.size >= 1.5) return { key: 'high', name: 'High' };
    if (open && close && ev.size >= 0.75) return { key: 'mod', name: 'Moderate' };
    return { key: 'low', name: 'Low' };
  }
  function choose(cands) {
    var openNear = pick(cands, function (c) { return c.left >= 0 && c.dist <= CLOSE; });
    if (openNear) return openNear;
    var anyNear = pick(cands, function (c) { return c.dist <= CLOSE; });
    if (anyNear) return anyNear;
    return pick(cands, function () { return true; });
  }

  var CSS = '#hmv{position:fixed;inset:0;z-index:1500;background:#F7F3EA;display:none;flex-direction:column;color:#0A2748}' +
    '#hmv.on{display:flex}#hmv .wh{background:rgba(255,255,255,.96);border-bottom:1px solid #e5e7eb;padding:calc(8px + env(safe-area-inset-top)) 12px 10px}' +
    '#hmv .wt{display:flex;align-items:center;gap:8px}#hmv .wt b{flex:1;font-size:18px}' +
    '#hmv .bd{flex:1;overflow:auto;padding:12px 12px calc(var(--nav,64px) + env(safe-area-inset-bottom) + 18px)}' +
    '#hmv label{display:block;font-size:12px;font-weight:700;color:#64748b;margin:8px 0 4px}' +
    '#hmv input{width:100%;box-sizing:border-box;min-height:48px;border:1px solid #e5e7eb;border-radius:12px;padding:0 12px;font-size:16px}' +
    '#hmv .go{width:100%;min-height:48px;margin-top:8px;border:0;border-radius:12px;background:#0A2748;color:#fff;font-weight:800;font-size:16px}' +
    '#hmv .go.alt{background:#F4EFE4;color:#0A2748;border:1px solid #e7d7b0}' +
    '#hmv .mu{color:#64748b;font-size:13px;line-height:1.4}#hmv .cd{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:14px;margin:10px 0}' +
    '#hmv .sug{display:none;background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin-top:6px;overflow:hidden}' +
    '#hmv .sug button{display:block;width:100%;text-align:left;border:0;border-top:1px solid #f1f5f9;background:#fff;padding:10px 12px;font:inherit}' +
    '#hmv .sug b{display:block}#hmv .sug small{color:#64748b}' +
    '#hm_gauge{display:block;width:100%;max-width:280px;margin:0 auto}#hm_size{font-size:28px;font-weight:800;text-align:center;margin-top:-8px}' +
    '#hm_rate{text-align:center;font-size:22px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin:4px 0}' +
    '#hm_rate.high{color:#0A2748}#hm_rate.mod{color:#8a6a1a}#hm_rate.low{color:#64748b}#hm_rate.none{color:#94a3b8}' +
    '#hmv dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:10px 0 0}#hmv dt{color:#64748b;font-size:13px}#hmv dd{margin:0;font-weight:700}' +
    '#hm_rules{font-size:13px;color:#334155;margin:0;padding-left:18px}#hm_rules li{margin:4px 0}';
  var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

  var root = document.createElement('div');
  root.id = 'hmv'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Hail meter');
  root.innerHTML = '<div class="wh"><div class="wt"><b>Hail meter</b><button class="ic" type="button" id="hm_x" aria-label="Close">&times;</button></div></div>' +
    '<div class="bd"><p class="mu">Hail recorded near this spot, from the same public radar swaths and ground reports as the map.</p>' +
    '<form id="hm_f"><label for="hm_q">Address, street, city, or ZIP</label>' +
    '<input id="hm_q" type="search" inputmode="search" enterkeyhint="search" placeholder="75098 or 300 Country Club Rd" autocomplete="off">' +
    '<div id="hm_sug" class="sug" role="listbox"></div>' +
    '<button class="go" type="submit">Read this place</button></form>' +
    '<button class="go alt" type="button" id="hm_map">Use the map center</button>' +
    '<div class="cd" id="hm_card"><div id="hm_where" class="mu">Choose a spot.</div>' +
    '<svg id="hm_gauge" viewBox="0 0 200 118" aria-hidden="true"><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#e5e7eb" stroke-width="16" stroke-linecap="round"/>' +
    '<path id="hm_arc" d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#B78A2A" stroke-width="16" stroke-linecap="round" stroke-dasharray="0 252"/></svg>' +
    '<div id="hm_size">—</div><div id="hm_rate" class="none"> </div>' +
    '<dl id="hm_facts"></dl><p class="mu" id="hm_note"></p></div>' +
    '<div class="cd"><h4 style="margin:0 0 6px">How the rating is set</h4><ul id="hm_rules">' +
    '<li><b>High</b> — 1.50" or larger, within 3 miles, and the 365-day window is still open.</li>' +
    '<li><b>Moderate</b> — 0.75" up to but not including 1.50", within 3 miles, and the window is still open.</li>' +
    '<li><b>Low</b> — hail within 10 miles that is under 0.75", farther than 3 miles, or whose 365-day window is closed.</li>' +
    '<li><b>None</b> — no hail within 10 miles in the loaded storm data.</li>' +
    '</ul><p class="mu">The gauge tops out at 2.50". Radar sizes are the swath band (about that size or larger), not a stone someone measured. This is where hail was recorded, not roof damage.</p></div></div>';
  document.body.appendChild(root);

  var $ = function (id) { return document.getElementById(id); };
  var seq = 0, ARC = Math.PI * 80;

  function paint(pct, color) {
    var arc = $('hm_arc');
    var n = Math.max(0, Math.min(1, pct)) * ARC;
    arc.setAttribute('stroke', color);
    arc.setAttribute('stroke-dasharray', n.toFixed(1) + ' ' + (ARC + 2).toFixed(1));
  }
  function showWait(where) {
    $('hm_where').textContent = where;
    $('hm_size').textContent = '…';
    $('hm_rate').className = 'none';
    $('hm_rate').textContent = '';
    $('hm_facts').innerHTML = '';
    $('hm_note').textContent = 'Reading the storm data…';
    paint(0, '#e5e7eb');
  }
  function showBad(where, msg) {
    $('hm_where').textContent = where || '';
    $('hm_size').textContent = 'Data unavailable';
    $('hm_rate').className = 'none';
    $('hm_rate').textContent = 'Data unavailable';
    $('hm_facts').innerHTML = '';
    $('hm_note').textContent = msg;
    paint(0, '#e5e7eb');
  }
  function showNone(where, note) {
    $('hm_where').textContent = where;
    $('hm_size').textContent = 'No hail within 10 mi';
    $('hm_rate').className = 'none';
    $('hm_rate').textContent = 'None';
    $('hm_facts').innerHTML = '<dt>Largest hail</dt><dd>None within 10 miles</dd><dt>How far</dt><dd>No hail within 10 miles</dd><dt>Date</dt><dd>No hail within 10 miles</dd><dt>Days left</dt><dd>No hail within 10 miles</dd>';
    $('hm_note').textContent = note || 'No hail within 10 miles in the loaded storm data.';
    paint(0, '#cbd5e1');
  }
  function showEvent(where, ev, rating, extra) {
    var color = rating.key === 'high' ? '#0A2748' : rating.key === 'mod' ? '#B78A2A' : '#64748b';
    $('hm_where').textContent = where;
    $('hm_size').textContent = sizeLabel(ev.size, ev.source);
    $('hm_rate').className = rating.key;
    $('hm_rate').textContent = rating.name;
    var left = ev.left >= 0 ? (ev.left + ' days left in the 365-day window') : 'Window closed';
    $('hm_facts').innerHTML = '<dt>Largest hail</dt><dd>' + esc(sizeLabel(ev.size, ev.source)) + '</dd>' +
      '<dt>How far</dt><dd>' + esc(distLabel(ev.dist)) + '</dd>' +
      '<dt>Date</dt><dd>' + esc(AddrSearch.fdate(ev.date)) + '</dd>' +
      '<dt>Days left</dt><dd>' + esc(left) + '</dd>';
    $('hm_note').textContent = extra || '';
    paint(Math.min(1, ev.size / GAUGE_MAX), color);
  }

  function collect(lat, lon, lay, reps) {
    var cands = [];
    Object.keys(lay || {}).forEach(function (d) {
      (lay[d] || []).forEach(function (p) {
        if (!(p.t > 0) || !p.g) return;
        var dist = AddrSearch.geomDist(lat, lon, p.g, NEAR);
        if (dist > NEAR) return;
        cands.push({ size: p.t, dist: dist, date: d, source: 'radar', left: AddrSearch.cwLeft(d) });
      });
    });
    (reps || []).forEach(function (r) {
      if (!(r[2] > 0)) return;
      var dist = miles(lat, lon, r[0], r[1]);
      if (dist > NEAR) return;
      cands.push({ size: r[2], dist: dist, date: r[3], source: 'ground', left: AddrSearch.cwLeft(r[3]) });
    });
    return cands;
  }

  function run(lat, lon, label) {
    var my = ++seq;
    if (!window.HailStore || !window.AddrSearch) { showBad(label, 'Data unavailable. The storm files are not ready.'); return; }
    showWait(label);
    HailStore.loadLookup().then(function () {
      if (my !== seq) return;
      var LK = HailStore.lookup();
      if (!LK || !LK.mi || !LK.mi.days) throw new Error('lookup');
      if (!LK.reps) LK.reps = (LK.rp || []).map(function (r) { return [r[0], r[1], r[2], LK.days[r[3]], r[4], r[5]]; });
      var days = daysNear(LK.mi, lat, lon);
      return HailStore.loadDays(days).then(function () {
        if (my !== seq) return;
        var lay = {}, miss = 0;
        days.forEach(function (d) {
          var m = HailStore.mesh(d);
          if (!m) { miss++; return; }
          lay[d] = m;
        });
        var cands = collect(lat, lon, lay, LK.reps);
        if (!cands.length && miss && miss === days.length && days.length) {
          showBad(label, 'Data unavailable. The storm-day files for this spot did not load.');
          return;
        }
        var ev = choose(cands);
        if (!ev) {
          showNone(label, miss ? 'No hail within 10 miles in the days that loaded. ' + miss + ' storm day' + (miss === 1 ? '' : 's') + ' did not load, so this is not a full reading.' : 'No hail within 10 miles in the loaded storm data.');
          return;
        }
        var rating = rate(ev);
        var note = ev.source === 'radar' ? 'Radar size is the swath band, not a measured stone.' : 'Size is from a public ground hail report.';
        if (miss) note += ' ' + miss + ' storm day' + (miss === 1 ? '' : 's') + ' did not load, so a larger event could be missing.';
        var bigger = pick(cands, function (c) { return c !== ev && c.size > ev.size + 0.001; });
        if (bigger) note += ' Larger hail farther out: ' + sizeLabel(bigger.size, bigger.source) + ', ' + distLabel(bigger.dist) + ', ' + AddrSearch.fdate(bigger.date) + '.';
        showEvent(label, ev, rating, note);
      });
    }).catch(function () {
      if (my === seq) showBad(label, 'Data unavailable. The hail files did not load.');
    });
  }

  function mapCenter() {
    var c = window.HailStore && HailStore.center && HailStore.center();
    if (!c || !isFinite(c.lat)) { showBad('Map center', 'Data unavailable. The map is not ready.'); return; }
    $('hm_q').value = '';
    run(c.lat, c.lon, 'Map center');
  }

  var sugN = 0, sugT = null;
  $('hm_q').addEventListener('input', function () {
    var q = this.value.trim(), box = $('hm_sug'), my = ++sugN;
    clearTimeout(sugT);
    if (q.length < 3 || !(window.AddrSearch && AddrSearch.esriSuggest)) { box.style.display = 'none'; box.innerHTML = ''; return; }
    sugT = setTimeout(function () {
      AddrSearch.esriSuggest(q).catch(function () { return AddrSearch.suggest(q); }).then(function (r) {
        if (my !== sugN) return;
        box.innerHTML = '';
        if (!r || !r.length) { box.style.display = 'none'; return; }
        r.slice(0, 6).forEach(function (x) {
          var b = document.createElement('button'); b.type = 'button';
          b.innerHTML = '<b>' + esc(x.label) + '</b><small>' + esc(x.full || '') + '</small>';
          b.onclick = function () { sugN++; box.style.display = 'none'; $('hm_q').value = x.label; goQuery(x.label); };
          box.appendChild(b);
        });
        box.style.display = 'block';
      }).catch(function () { if (my === sugN) box.style.display = 'none'; });
    }, 280);
  });
  function goQuery(q) {
    q = (q || '').trim();
    if (!q) return;
    if (!(window.AddrSearch && AddrSearch.searchAll)) { showBad(q, 'Data unavailable. Search is not ready.'); return; }
    showWait(q);
    var m = q.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    var p = m ? Promise.resolve([{ lat: +m[1], lon: +m[2], label: q }]) : AddrSearch.searchAll(q);
    p.then(function (r) {
      if (!r || !r.length) { showBad(q, 'No Texas match for that search. Nothing was scored.'); return; }
      run(r[0].lat, r[0].lon, r[0].label);
    }).catch(function () { showBad(q, 'Data unavailable. The place lookup did not answer.'); });
  }
  $('hm_f').onsubmit = function (e) { e.preventDefault(); sugN++; $('hm_sug').style.display = 'none'; goQuery($('hm_q').value); };
  $('hm_map').onclick = mapCenter;
  $('hm_x').onclick = function () { close(); if (window.FVnav) FVnav('map'); };
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-hm]');
    if (!b) return;
    e.preventDefault();
    var p = b.getAttribute('data-hm').split(',');
    open(true);
    run(+p[0], +p[1], b.getAttribute('data-hml') || 'This spot');
  });

  function open(skipRead) {
    root.classList.add('on');
    document.body.style.overflow = 'hidden';
    if (window.FVmark) FVmark('hm');
    if (!skipRead && !$('hm_q').value) mapCenter();
  }
  function close() { root.classList.remove('on'); document.body.style.overflow = ''; seq++; }
  window.HMV = { open: open, close: close, openAt: function (lat, lon, label) { open(true); run(lat, lon, label); } };
})();

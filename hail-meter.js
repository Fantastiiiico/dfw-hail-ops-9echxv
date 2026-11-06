/* Home history for one searched place.
   Hail dates: every storm day in this app's public files (NWS and CoCoRaHS ground reports
   back to 1955, plus MRMS MESH radar swaths from Oct 2020). No date cap.
   Wind, tornado, and flood reports: NWS local storm reports via the Iowa Environmental Mesonet.
   Flood zone: FEMA National Flood Hazard Layer. County declarations: OpenFEMA.
   Year built and last deed: county appraisal parcel at the point. Owner names are not requested.
   Permits, sale price, NCEI storm-event files, and insurance claims are not invented. */
(function () {
  var MAXR = 25;
  var WIND = { 'TSTM WND GST': 1, 'TSTM WND DMG': 1, 'NON-TSTM WND GST': 1, 'NON-TSTM WND DMG': 1, 'TORNADO': 1 };
  var FLOOD = { 'FLOOD': 1, 'FLASH FLOOD': 1 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function miles(lat, lon, la, lo) {
    var k = Math.cos(lat * Math.PI / 180);
    return Math.hypot((la - lat) * 69.05, (lo - lon) * 69.05 * k);
  }
  function famLabel(f) {
    if (f === 'cocorahs_observer') return 'CoCoRaHS ground report';
    if (f === 'nws') return 'NWS ground report';
    return 'Ground report';
  }
  function sizeTxt(n, radar) {
    if (!(n > 0)) return 'size not given';
    var t = n >= 2.5 ? '2.50"+' : (+n).toFixed(2) + '"';
    if (!radar) return t;
    return 'about ' + t + (n >= 2.5 ? '' : ' or larger') + ' (radar swath, not a measured stone)';
  }
  function distTxt(d) {
    if (!(d > 0.05)) return 'at this point';
    return (d < 1 ? d.toFixed(2) : d.toFixed(1)) + ' mi';
  }
  function dol(d) {
    if (!(window.AddrSearch && AddrSearch.cwLeft)) return '365-day window: data unavailable';
    var l = AddrSearch.cwLeft(d);
    return l >= 0 ? (l + ' days left in the 365-day window') : '365-day window closed (history only)';
  }
  function when(d) {
    if (window.AddrSearch && AddrSearch.fdate) return AddrSearch.fdate(d);
    return d;
  }
  function dayKey(iso) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(iso)); }
    catch (e) { return String(iso || '').slice(0, 10); }
  }
  function deedTxt(ms) {
    if (!ms) return '';
    var dt = new Date(ms);
    if (isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function cleanAddr(s) {
    return String(s || '').replace(/\r/g, '\n').split('\n').map(function (x) { return x.replace(/\s+/g, ' ').trim(); }).filter(Boolean).join(', ');
  }
  function yearOf(v) { var n = +v; return n > 1800 && n < 2100 ? Math.round(n) : null; }
  function getJson(url, ms) {
    var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, ms || 12000);
    return fetch(url, { cache: 'no-store', signal: ac.signal }).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { clearTimeout(t); throw e; });
  }

  var CSS = '#hmv{position:fixed;inset:0;z-index:1500;background:#F7F3EA;display:none;flex-direction:column;color:#0A2748}' +
    '#hmv.on{display:flex}#hmv .wh{background:rgba(255,255,255,.96);border-bottom:1px solid #e7d7b0;padding:calc(8px + env(safe-area-inset-top)) 12px 10px}' +
    '#hmv .wt{display:flex;align-items:center;gap:8px}#hmv .wt b{flex:1;font-size:18px}' +
    '#hmv .bd{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:12px 12px calc(var(--nav,64px) + env(safe-area-inset-bottom) + 24px)}' +
    '#hmv h3{margin:16px 0 6px;font-size:16px}#hmv h3 span{font-weight:700;color:#64748b}' +
    '#hmv label{display:block;font-size:12px;font-weight:700;color:#64748b;margin:8px 0 4px}' +
    '#hmv input,#hmv select{width:100%;box-sizing:border-box;min-height:48px;border:1px solid #e5e7eb;border-radius:12px;padding:0 12px;font-size:16px;background:#fff;color:#0A2748}' +
    '#hmv .filt{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
    '#hmv .go{width:100%;min-height:48px;margin-top:8px;border:0;border-radius:12px;background:#0A2748;color:#F4EFE4;font-weight:800;font-size:16px}' +
    '#hmv .go.alt{background:#F4EFE4;color:#0A2748;border:1px solid #e7d7b0}' +
    '#hmv .mu{color:#64748b;font-size:13px;line-height:1.45}' +
    '#hmv .row{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;margin:8px 0;font-size:14px;line-height:1.4}' +
    '#hmv .row b{display:block;font-size:15px}#hmv .row .sub{color:#334155;margin-top:2px}' +
    '#hmv .row.near{background:#F4EFE4;border-color:#e7d7b0;box-shadow:inset 4px 0 0 #B78A2A}' +
    '#hmv .nearflag{display:inline-block;margin-top:4px;font-size:12px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:#8a6a1a}' +
    '#hmv .sug{display:none;background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin-top:6px;overflow:hidden}' +
    '#hmv .sug button{display:block;width:100%;text-align:left;border:0;border-top:1px solid #f1f5f9;background:#fff;padding:10px 12px;font:inherit;color:#0A2748}' +
    '#hmv .sug b{display:block}#hmv .sug small{color:#64748b}';
  var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  var root = document.createElement('div');
  root.id = 'hmv'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Home history');
  root.innerHTML = '<div class="wh"><div class="wt"><b>Home history</b><button class="ic" type="button" id="hm_x" aria-label="Close">&times;</button></div></div>' +
    '<div class="bd"><p class="mu">Every hail date on file near this place, then wind, flood, and the public record of the house. Scroll for the older dates. Nothing here is a guess.</p>' +
    '<button type="button" class="src-link" data-sources>Sources</button>' +
    '<form id="hm_f"><label for="hm_q">Address, street, city, or ZIP</label>' +
    '<input id="hm_q" type="search" inputmode="search" enterkeyhint="search" placeholder="75098 or 100 N Ballard Ave" autocomplete="off">' +
    '<div id="hm_sug" class="sug" role="listbox"></div>' +
    '<button class="go" type="submit">Read this place</button></form>' +
    '<button class="go alt" type="button" id="hm_map">Use the map center</button>' +
    '<p id="hh_where" class="mu"></p>' +
    '<div class="filt"><div><label for="hh_rad">Radius</label><select id="hh_rad"><option value="1">1 mile</option><option value="3">3 miles</option><option value="10" selected>10 miles</option><option value="25">25 miles</option></select></div>' +
    '<div><label for="hh_sz">Smallest hail</label><select id="hh_sz"><option value="0">Any size</option><option value="0.75">0.75" and up</option><option value="1">1.00" and up</option><option value="1.5">1.50" and up</option><option value="2">2.00" and up</option></select></div></div>' +
    '<h3>Hail dates <span id="hh_count"></span></h3><div id="hh_hail"></div><p class="mu" id="hh_hail_src"></p>' +
    '<h3>Wind and tornado</h3><div id="hh_wind"></div>' +
    '<h3>Flood</h3><div id="hh_flood"></div>' +
    '<h3>County disaster declarations</h3><div id="hh_dec"></div>' +
    '<h3>The house</h3><div id="hh_prop"></div>' +
    '<h3>Past insurance claims</h3><div class="row"><b>Not public</b><div class="sub">Not public: ask the homeowner or request a CLUE report. A CLUE report needs the owner’s consent. This screen does not show a claim, and none is filled in.</div></div>' +
    '</div>';
  document.body.appendChild(root);
  var $ = function (id) { return document.getElementById(id); };
  var seq = 0, state = null;

  function row(date, lines, near, flag) {
    return '<div class="row' + (near ? ' near' : '') + '"><b>' + esc(when(date)) + '</b>' +
      lines.map(function (l) { return '<div class="sub">' + esc(l) + '</div>'; }).join('') +
      (flag ? '<div class="nearflag">' + esc(flag) + '</div>' : '') +
      '<div class="sub">' + esc(dol(date)) + '</div></div>';
  }
  function rad() { return +$('hh_rad').value || 10; }
  function minSz() { return +$('hh_sz').value || 0; }

  function passes(part) {
    return part && part.dist <= rad() + 1e-6 && (part.size || 0) >= minSz() - 1e-6;
  }
  function hailRows() {
    if (!state || !state.by) return [];
    var out = [];
    Object.keys(state.by).forEach(function (d) {
      var e = state.by[d], lines = [], dist = 1e9;
      if (passes(e.g)) {
        lines.push(sizeTxt(e.g.size, false) + ' · ' + distTxt(e.g.dist) + ' · ' + famLabel(e.g.fam) + (e.g.n > 1 ? ' · nearest of ' + e.g.n + ' ground reports' : ''));
        if (e.g.dist < dist) dist = e.g.dist;
      }
      if (passes(e.r)) {
        lines.push(sizeTxt(e.r.size, true) + ' · ' + distTxt(e.r.dist) + ' · MRMS MESH radar swath');
        if (e.r.bigger && e.r.bigger.size > e.r.size + 0.01 && e.r.bigger.dist <= rad()) {
          lines.push('Larger radar band ' + sizeTxt(e.r.bigger.size, true) + ', ' + distTxt(e.r.bigger.dist));
        }
        if (e.r.dist < dist) dist = e.r.dist;
      }
      if (lines.length) out.push({ date: d, lines: lines, dist: dist });
    });
    out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var best = null;
    out.forEach(function (r) { if (best == null || r.dist < best) best = r.dist; });
    out.forEach(function (r) {
      r.near = best != null && Math.abs(r.dist - best) < 0.02;
      r.flag = r.near ? (r.dist <= 0.05 ? 'At this point' : 'Nearest to this place') : '';
    });
    return out;
  }
  function paintHail() {
    var box = $('hh_hail'), src = $('hh_hail_src');
    if (!state) { box.innerHTML = ''; $('hh_count').textContent = ''; src.textContent = ''; return; }
    if (state.hailBad) {
      $('hh_count').textContent = '';
      box.innerHTML = '<div class="row"><b>Data unavailable</b><div class="sub">The hail files did not load. No dates were filled in.</div></div>';
      src.textContent = '';
      return;
    }
    var rows = hailRows();
    $('hh_count').textContent = rows.length ? ('· ' + rows.length) : '· 0';
    if (!rows.length) box.innerHTML = '<div class="row"><b>No hail date in this radius and size</b><div class="sub">The files loaded. Nothing was dropped for being old. Widen the radius or lower the size to see more.</div></div>';
    else box.innerHTML = rows.map(function (r) { return row(r.date, r.lines, r.near, r.flag); }).join('');
    src.textContent = (state.radarNote && /Checking|did not load/.test(state.radarNote)) ? state.radarNote : '';
    if (window.Sources && state.span) Sources.note('hail', 'Ground reports in this app run ' + state.span[0] + ' through ' + state.span[1] + '.');
  }

  function takeNearest(prev, dist, size, fam) {
    if (!prev || dist < prev.dist - 0.001 || (Math.abs(dist - prev.dist) <= 0.001 && size > (prev.size || 0))) {
      return { dist: dist, size: size, fam: fam, n: (prev ? prev.n : 0) + 1 };
    }
    prev.n++;
    return prev;
  }
  function indexGround(LK, lat, lon) {
    var by = {}, reps = LK.reps, days = LK.days, fams = LK.fams || [];
    for (var i = 0; i < reps.length; i++) {
      var r = reps[i], dist = miles(lat, lon, r[0], r[1]);
      if (dist > MAXR) continue;
      var d = typeof r[3] === 'string' ? r[3] : days[r[3]]; if (!d) continue;
      var e = by[d] || (by[d] = { g: null, r: null });
      e.g = takeNearest(e.g, dist, r[2] || 0, fams[r[4]] || '');
    }
    return by;
  }
  function meshDays(LK, lat, lon, radius) {
    var deg = radius / 69, dn = deg / Math.cos(lat * Math.PI / 180), seen = {}, out = [];
    var a0 = Math.floor((lat - deg) * 10), a1 = Math.floor((lat + deg) * 10);
    var b0 = Math.floor((lon - dn) * 10), b1 = Math.floor((lon + dn) * 10);
    var cells = (LK.mi && LK.mi.cells) || {}, days = (LK.mi && LK.mi.days) || [];
    for (var a = a0; a <= a1; a++) for (var b = b0; b <= b1; b++) {
      var idx = cells[a + '_' + b]; if (!idx) continue;
      for (var i = 0; i < idx.length; i++) {
        var d = days[idx[i]];
        if (d && !seen[d]) { seen[d] = 1; out.push(d); }
      }
    }
    return out;
  }
  function mergeRadar(lat, lon, days) {
    var miss = 0, checked = 0;
    days.forEach(function (d) {
      var polys = HailStore.mesh(d);
      if (!polys) { miss++; return; }
      checked++;
      polys.forEach(function (p) {
        if (!(p.t > 0) || !p.g || !window.AddrSearch) return;
        var dist = AddrSearch.geomDist(lat, lon, p.g, MAXR);
        if (!(dist <= MAXR)) return;
        var e = state.by[d] || (state.by[d] = { g: null, r: null });
        if (!e.r) e.r = { dist: dist, size: p.t, bigger: null };
        else if (dist < e.r.dist - 0.001) {
          if (e.r.size > p.t + 0.01) e.r.bigger = { size: e.r.size, dist: e.r.dist };
          e.r.dist = dist; e.r.size = p.t;
        } else if (p.t > e.r.size + 0.01 && (!e.r.bigger || p.t > e.r.bigger.size)) e.r.bigger = { size: p.t, dist: dist };
      });
    });
    return { checked: checked, miss: miss };
  }

  function eventRows(list) {
    var rows = (list || []).filter(function (r) { return r.dist <= rad() + 1e-6; });
    rows.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var best = null;
    rows.forEach(function (r) { if (best == null || r.dist < best) best = r.dist; });
    rows.forEach(function (r) { r.near = best != null && Math.abs(r.dist - best) < 0.02; });
    return rows;
  }
  function paintEvents() {
    var wind = $('hh_wind'), flood = $('hh_flood');
    if (!state.iem) {
      if (state.zoneHtml || state.nceiHtml) flood.innerHTML = (state.zoneHtml || '') + (state.nceiHtml || '');
      return;
    }
    if (state.iem.bad) {
      wind.innerHTML = '<div class="row"><b>Data unavailable</b><div class="sub">The NWS local storm report feed did not answer. No wind or tornado report was filled in.</div></div>';
      flood.innerHTML = (state.zoneHtml || '') + '<div class="row"><b>Flood reports: data unavailable</b><div class="sub">The same NWS report feed did not answer.</div></div>' + (state.nceiHtml || '');
      return;
    }
    function block(arr, empty) {
      var rows = eventRows(arr);
      if (!rows.length) return '<div class="row"><div class="sub">' + esc(empty) + '</div></div>';
      return rows.map(function (r) {
        var lines = [r.what + ' · ' + distTxt(r.dist) + (r.mag ? ' · ' + r.mag : '') + (r.n > 1 ? ' · nearest of ' + r.n + ' reports' : '')];
        if (r.where) lines.push(r.where);
        return row(r.date, lines, r.near, r.near ? 'Nearest to this place' : '');
      }).join('');
    }
    wind.innerHTML = block(state.iem.wind, 'No wind or tornado report within ' + rad() + ' miles in this feed.');
    var floodReports = block(state.iem.flood, 'No flood or flash-flood report within ' + rad() + ' miles in this feed.');
    var zone = state.zoneHtml || '';
    var ncei = state.nceiHtml || '';
    flood.innerHTML = zone + floodReports + ncei;
    if (window.Sources) {
      var bits = [];
      if (state.iem.fileSpan) bits.push('The file that answered runs ' + state.iem.fileSpan[0] + ' through ' + state.iem.fileSpan[1] + '.');
      if (state.iem.span) bits.push('Reports within 25 miles run ' + state.iem.span[0] + ' through ' + state.iem.span[1] + '.');
      Sources.note('iem', bits.join(' '));
    }
  }

  var PARCELS = [
    {
      name: 'Collin CAD',
      url: 'https://gismaps.cityofallen.org/arcgis/rest/services/ReferenceData/Collin_County_Appraisal_District_Parcels/FeatureServer/1/query',
      fields: 'GIS_DBO_AD_Entity_situs_display,GIS_DBO_AD_Entity_yr_blt,GIS_DBO_AD_Entity_eff_yr_blt,GIS_DBO_AD_Entity_deed_dt',
      read: function (a) {
        return { address: cleanAddr(a.GIS_DBO_AD_Entity_situs_display), year: yearOf(a.GIS_DBO_AD_Entity_yr_blt), eff: yearOf(a.GIS_DBO_AD_Entity_eff_yr_blt), deed: deedTxt(a.GIS_DBO_AD_Entity_deed_dt), source: 'Collin Central Appraisal District parcels (City of Allen open data). Owner name was not requested.' };
      }
    },
    {
      name: 'Dallas CAD',
      url: 'https://maps.dcad.org/prdwa/rest/services/Property/ParcelQuery/MapServer/4/query',
      fields: 'SITEADDRESS,RESYRBLT',
      read: function (a) {
        return { address: cleanAddr(a.SITEADDRESS), year: yearOf(a.RESYRBLT), eff: null, deed: '', source: 'Dallas Central Appraisal District ParcelPublishing. Owner name was not requested. This feed has no deed date.' };
      }
    },
    {
      name: 'Tarrant CAD',
      url: 'https://mapit.tarrantcounty.com/arcgis/rest/services/Tax/TCProperty/MapServer/0/query',
      fields: 'SITUS_ADDR,YEAR_BUILT',
      read: function (a) {
        return { address: cleanAddr(a.SITUS_ADDR), year: yearOf(a.YEAR_BUILT), eff: null, deed: '', source: 'Tarrant County tax parcels. Owner name was not requested. This feed has no deed date.' };
      }
    }
  ];
  function parcelAt(lat, lon) {
    return Promise.all(PARCELS.map(function (p) {
      var q = p.url + '?f=json&geometry=' + lon + ',' + lat + '&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=' + encodeURIComponent(p.fields) + '&returnGeometry=false';
      return getJson(q, 12000).then(function (j) {
        var f = (j.features || [])[0];
        return f ? p.read(f.attributes || {}) : null;
      }).catch(function () { return { error: p.name }; });
    }));
  }
  function paintHouse(parts) {
    var box = $('hh_prop');
    var hits = [], failed = [];
    (parts || []).forEach(function (p) { if (!p) return; if (p.error) failed.push(p.error); else hits.push(p); });
    var html = '';
    if (!hits.length && failed.length === PARCELS.length) {
      html += '<div class="row"><b>Year built: data unavailable</b><div class="sub">The county parcel feeds did not answer.</div></div>';
      html += '<div class="row"><b>Sale history: data unavailable</b></div>';
    } else if (!hits.length) {
      html += '<div class="row"><b>Year built: data unavailable</b><div class="sub">No appraisal parcel contains this point' + (failed.length ? ('. ' + failed.join(' and ') + ' did not answer') : '') + '.</div></div>';
      html += '<div class="row"><b>Sale history: data unavailable</b><div class="sub">No parcel at this point, so there is no deed date to show.</div></div>';
    } else hits.forEach(function (h) {
      html += '<div class="row"><b>' + esc(h.address || 'Parcel at this point') + '</b>' +
        '<div class="sub">Year built: ' + (h.year ? esc(String(h.year)) : 'data unavailable') + '</div>' +
        (h.eff ? '<div class="sub">Effective year built on the appraisal record: ' + esc(String(h.eff)) + '. This is not a permit.</div>' : '') +
        '<div class="sub">' + (h.deed ? ('Last deed date on the appraisal record: ' + esc(h.deed) + '. Sale price is not in this feed.') : 'Sale history: data unavailable. This feed has no sale price, and no deed date was on the parcel.') + '</div>' +
        '<div class="sub">' + esc(h.source) + '</div></div>';
    });
    html += '<div class="row"><b>Building permits: data unavailable</b><div class="sub">Roof and repair permits are not in these free county appraisal feeds. None were filled in.</div></div>';
    box.innerHTML = html;
  }

  function read(lat, lon, label) {
    var my = ++seq;
    state = { lat: lat, lon: lon, label: label, by: null, hailBad: false, span: null, radarNote: 'Checking radar swaths…', radarFor: 0, iem: null, zoneHtml: '<div class="row"><div class="sub">Checking the FEMA flood zone…</div></div>', nceiHtml: '', seq: my };
    $('hh_where').textContent = label || 'This place';
    $('hm_q').value = label || '';
    $('hh_hail').innerHTML = '<div class="row"><div class="sub">Reading hail dates…</div></div>';
    $('hh_count').textContent = '';
    $('hh_wind').innerHTML = '<div class="row"><div class="sub">Checking wind and tornado reports…</div></div>';
    $('hh_flood').innerHTML = '';
    $('hh_dec').innerHTML = '<div class="row"><div class="sub">Checking FEMA disaster declarations…</div></div>';
    $('hh_prop').innerHTML = '<div class="row"><div class="sub">Checking the appraisal parcel…</div></div>';
    if (!window.HailStore || !window.AddrSearch) {
      state.hailBad = true; paintHail();
    } else {
      HailStore.loadLookup().then(function () {
        if (my !== seq) return;
        var LK = HailStore.lookup();
        if (!LK || !LK.rp || !LK.days) throw new Error('lookup');
        if (!LK.reps) LK.reps = LK.rp.map(function (r) { return [r[0], r[1], r[2], LK.days[r[3]], r[4], r[5]]; });
        state.by = indexGround(LK, lat, lon);
        state.span = [LK.days[0], LK.days[LK.days.length - 1]];
        state.LK = LK;
        paintHail();
        return loadRadar(my);
      }).catch(function () { if (my === seq) { state.hailBad = true; state.radarNote = ''; paintHail(); } });
    }
    loadIem(lat, lon, my);
    loadFlood(lat, lon, my);
    loadCounty(lat, lon, my);
    parcelAt(lat, lon).then(function (parts) { if (my === seq) paintHouse(parts); });
  }
  function loadRadar(my) {
    var radius = Math.max(rad(), state.radarFor || 0);
    if (radius <= state.radarFor) { paintHail(); return Promise.resolve(); }
    var days = meshDays(state.LK, state.lat, state.lon, radius);
    state.radarNote = 'Checking ' + days.length + ' radar days…';
    paintHail();
    return HailStore.loadDays(days).then(function () {
      if (my !== seq) return;
      var n = mergeRadar(state.lat, state.lon, days);
      state.radarFor = radius;
      state.radarNote = n.miss ? (n.checked + ' radar days checked. ' + n.miss + ' did not load, so a radar-only date could be missing.') : (n.checked + ' radar days checked.');
      paintHail();
    });
  }
  function indexIem(fc, lat, lon) {
    var wind = {}, flood = {}, first = '', last = '', fileFirst = '', fileLast = '';
    (fc.features || []).forEach(function (f) {
      var p = f.properties || {}, typ = p.typetext || '';
      var date = dayKey(p.valid);
      if (date && (!fileFirst || date < fileFirst)) fileFirst = date;
      if (date && (!fileLast || date > fileLast)) fileLast = date;
      var bucket = WIND[typ] ? wind : FLOOD[typ] ? flood : null;
      if (!bucket) return;
      var la = p.lat, lo = p.lon;
      if (f.geometry && f.geometry.type === 'Point') { lo = f.geometry.coordinates[0]; la = f.geometry.coordinates[1]; }
      if (la == null || lo == null) return;
      var dist = miles(lat, lon, +la, +lo);
      if (dist > MAXR) return;
      if (!first || date < first) first = date;
      if (!last || date > last) last = date;
      var mag = '';
      if (p.magf != null && p.unit) mag = p.magf + ' ' + p.unit;
      else if (p.magnitude) mag = String(p.magnitude) + (p.unit ? ' ' + p.unit : '');
      var key = date + '|' + typ;
      var prev = bucket[key];
      var where = [p.city, p.county ? p.county + ' Co.' : ''].filter(Boolean).join(', ');
      if (!prev || dist < prev.dist) bucket[key] = { date: date, dist: dist, what: typ, mag: mag, where: where, n: (prev ? prev.n : 0) + 1 };
      else prev.n++;
    });
    function list(o) { return Object.keys(o).map(function (k) { return o[k]; }); }
    return { wind: list(wind), flood: list(flood), span: first ? [first, last] : null, fileSpan: fileFirst ? [fileFirst, fileLast] : null, bad: false };
  }
  function loadIem(lat, lon, my) {
    var end = new Date().toISOString().slice(0, 10);
    var url = 'https://mesonet.agron.iastate.edu/geojson/lsr.py?sts=1996-01-01T00:00Z&ets=' + end + 'T23:59:00Z&wfos=FWD';
    getJson(url, 25000).then(function (j) {
      if (my !== seq) return;
      state.iem = indexIem(j, lat, lon);
      paintEvents();
    }).catch(function () {
      if (my !== seq) return;
      state.iem = { bad: true, wind: [], flood: [] };
      paintEvents();
    });
  }
  function loadFlood(lat, lon, my) {
    var nfhl = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?f=json&geometry=' + lon + ',' + lat +
      '&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF&returnGeometry=false';
    getJson(nfhl, 12000).then(function (j) {
      if (my !== seq) return;
      var feats = j.features || [];
      if (!feats.length) state.zoneHtml = '<div class="row"><b>FEMA flood zone</b><div class="sub">No flood-hazard polygon at this point.</div><div class="sub">Source: FEMA National Flood Hazard Layer.</div></div>';
      else state.zoneHtml = feats.map(function (f) {
        var a = f.attributes || {};
        var sfha = a.SFHA_TF === 'T' ? 'Special flood hazard area.' : 'Not marked as a special flood hazard area.';
        return '<div class="row"><b>FEMA flood zone ' + esc(a.FLD_ZONE || 'on file') + '</b><div class="sub">' + esc(a.ZONE_SUBTY || sfha) + '</div><div class="sub">' + esc(sfha) + ' Source: FEMA National Flood Hazard Layer.</div></div>';
      }).join('');
      paintEvents();
    }).catch(function () {
      if (my !== seq) return;
      state.zoneHtml = '<div class="row"><b>FEMA flood zone: data unavailable</b><div class="sub">The National Flood Hazard Layer did not answer. No zone was filled in.</div></div>';
      paintEvents();
    });
    state.nceiHtml = '<div class="row"><b>NCEI flood events: data unavailable</b><div class="sub">The NCEI Storm Events page did not return a data file this phone can read. No flood event from that source was filled in.</div></div>';
  }
  function loadCounty(lat, lon, my) {
    var url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=json&location=' + lon + ',' + lat;
    getJson(url, 8000).then(function (j) {
      if (my !== seq) return;
      var sub = ((j.address || {}).Subregion || '').replace(/ County$/i, '');
      if (!sub) throw new Error('county');
      state.county = sub;
      var filter = "state eq 'TX' and designatedArea eq '" + sub.replace(/'/g, "''") + " (County)'";
      var q = 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=' + encodeURIComponent(filter) +
        '&$select=disasterNumber,declarationTitle,incidentType,declarationDate,designatedArea&$orderby=' + encodeURIComponent('declarationDate desc') + '&$top=50';
      return getJson(q, 12000);
    }).then(function (j) {
      if (my !== seq || !j) return;
      var rows = j.DisasterDeclarationsSummaries || [];
      if (!rows.length) {
        $('hh_dec').innerHTML = '<div class="row"><b>No declaration in the feed</b><div class="sub">OpenFEMA returned no disaster declaration for ' + esc(state.county) + ' County, Texas.</div></div>';
        return;
      }
      $('hh_dec').innerHTML = rows.map(function (r) {
        var day = String(r.declarationDate || '').slice(0, 10);
        return '<div class="row"><b>' + esc(r.incidentType || 'Declaration') + (day ? ' · ' + esc(when(day)) : '') + '</b><div class="sub">' + esc(r.declarationTitle || '') + '</div><div class="sub">FEMA ' + esc(r.disasterNumber) + ' · ' + esc(r.designatedArea || '') + '</div></div>';
      }).join('') + '<p class="mu">Source: OpenFEMA Disaster Declarations Summaries for the county. A declaration is for the county, not proof of damage at this house.</p>';
    }).catch(function () {
      if (my === seq) $('hh_dec').innerHTML = '<div class="row"><b>Data unavailable</b><div class="sub">The county or the OpenFEMA declaration feed did not answer. No declaration was filled in.</div></div>';
    });
  }

  $('hh_rad').onchange = function () {
    if (state && state.LK && rad() > (state.radarFor || 0)) loadRadar(seq);
    else { paintHail(); paintEvents(); }
  };
  $('hh_sz').onchange = function () { paintHail(); };

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
    if (!(window.AddrSearch && AddrSearch.searchAll)) { $('hh_where').textContent = 'Search is not ready. Data unavailable.'; return; }
    $('hh_where').textContent = 'Finding ' + q + '…';
    var m = q.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    var p = m ? Promise.resolve([{ lat: +m[1], lon: +m[2], label: q }]) : AddrSearch.searchAll(q);
    p.then(function (r) {
      if (!r || !r.length) { $('hh_where').textContent = 'No Texas match for that search. Nothing was read.'; return; }
      read(r[0].lat, r[0].lon, r[0].label);
    }).catch(function () { $('hh_where').textContent = 'Data unavailable. The place lookup did not answer.'; });
  }
  $('hm_f').onsubmit = function (e) { e.preventDefault(); sugN++; $('hm_sug').style.display = 'none'; goQuery($('hm_q').value); };
  function mapCenter() {
    var c = window.HailStore && HailStore.center && HailStore.center();
    if (!c || !isFinite(c.lat)) { $('hh_where').textContent = 'Data unavailable. The map is not ready.'; return; }
    read(c.lat, c.lon, 'Map center');
  }
  $('hm_map').onclick = mapCenter;
  $('hm_x').onclick = function () { close(); if (window.FVnav) FVnav('map'); };
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-hm]');
    if (!b) return;
    e.preventDefault();
    var p = b.getAttribute('data-hm').split(',');
    open(true);
    read(+p[0], +p[1], b.getAttribute('data-hml') || 'This place');
  });
  function open(skipRead) {
    root.classList.add('on');
    document.body.style.overflow = 'hidden';
    if (window.FVmark) FVmark('hm');
    if (!skipRead && !$('hm_q').value) {
      var pin = window.HailStore && HailStore.pin && HailStore.pin();
      if (pin && isFinite(pin[0])) read(pin[0], pin[1], pin[2] || 'Last search');
      else mapCenter();
    }
  }
  function close() { root.classList.remove('on'); document.body.style.overflow = ''; seq++; }
  window.HMV = { open: open, close: close, openAt: function (lat, lon, label) { open(true); read(lat, lon, label); } };
})();

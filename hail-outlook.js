/* Forward hail outlook on the Weather screen.
   NOAA SPC Day 1 and Day 2 hail probabilities (1"+ within 25 miles), plus Open-Meteo daily weather codes.
   SPC does not publish a Day 3 hail probability. A failed feed is "data unavailable", not a made-up percent. */
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ct(iso, withTime) {
    if (!iso) return '';
    var o = { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' };
    if (withTime) { o.hour = 'numeric'; }
    return new Date(iso).toLocaleString('en-US', o) + (withTime ? ' CT' : '');
  }
  function contains(lat, lon, g) {
    if (!g || !window.AddrSearch) return false;
    if (g.type === 'GeometryCollection') return (g.geometries || []).some(function (x) { return contains(lat, lon, x); });
    if (g.type === 'Polygon' || g.type === 'MultiPolygon') return AddrSearch.inGeom(lat, lon, g);
    return false;
  }
  function emptyGeom(g) {
    if (!g) return true;
    if (g.type === 'GeometryCollection') return !(g.geometries && g.geometries.length);
    return false;
  }
  function dayName(ymd) {
    var p = String(ymd).split('-');
    if (p.length < 3) return ymd;
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 18)).toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' });
  }
  function catAt(fc, lat, lon) {
    var feats = (fc && fc.features) || [];
    if (!feats.length) return { ok: false };
    var hit = null;
    feats.forEach(function (f) {
      var p = f.properties || {};
      if (emptyGeom(f.geometry)) return;
      if (contains(lat, lon, f.geometry) && (!hit || (+p.DN || 0) > (+hit.DN || 0))) hit = p;
    });
    if (!hit) return { ok: true, none: true };
    return { ok: true, label: hit.LABEL2 || hit.LABEL || '', dn: +hit.DN || 0, valid: hit.VALID_ISO, expire: hit.EXPIRE_ISO };
  }
  function spcAt(fc, lat, lon) {
    var feats = (fc && fc.features) || [];
    if (!feats.length) return { ok: false };
    var hit = null, blanket = null;
    feats.forEach(function (f) {
      var p = f.properties || {};
      if (emptyGeom(f.geometry)) { blanket = p; return; }
      if (contains(lat, lon, f.geometry) && (!hit || (+p.DN || 0) > (+hit.DN || 0))) hit = p;
    });
    var p = hit || blanket;
    if (!p) return { ok: true, uncovered: true };
    return { ok: true, dn: +p.DN || 0, label: p.LABEL || p.LABEL2 || '', valid: p.VALID_ISO, expire: p.EXPIRE_ISO, blanket: !hit };
  }
  function codeLine(c) {
    if (c === 96 || c === 99) return 'thunderstorm with hail in the code';
    if (c === 95) return 'thunderstorm, hail not in the code';
    return 'no thunderstorm or hail code';
  }
  function level(days, om) {
    var spcOk = days.some(function (d) { return d.spc && d.spc.ok && !d.spc.uncovered && typeof d.spc.dn === 'number'; });
    var omOk = !!(om && om.ok);
    if (!spcOk && !omOk) return { key: 'na', name: 'Data unavailable' };
    var maxDn = 0;
    if (spcOk) days.forEach(function (d) { if (d.spc && d.spc.ok && typeof d.spc.dn === 'number' && d.spc.dn > maxDn) maxDn = d.spc.dn; });
    var hail = omOk && om.days.some(function (d) { return d.code === 96 || d.code === 99; });
    var storm = omOk && om.days.some(function (d) { return d.code === 95 || d.code === 96 || d.code === 99; });
    if ((spcOk && maxDn >= 15) || hail) return { key: 'up', name: 'Elevated' };
    if ((spcOk && maxDn >= 5) || storm) return { key: 'mid', name: 'Limited' };
    return { key: 'low', name: 'Lower' };
  }

  var CSS = '#wxv_hm{padding:0 12px 8px}#wxv_hm .cd{background:#fff;border:1px solid var(--ln,#e5e7eb);border-radius:14px;padding:14px;margin:0 0 12px;color:#0A2748}' +
    '#wxv_hm h4{margin:0 0 4px;font-size:16px}#wxv_hm .mu{color:#64748b;font-size:13px;line-height:1.4}' +
    '#ol_rate{font-size:16px;font-weight:700;margin:8px 0 2px}' +
    '#ol_days{margin:8px 0 0}#ol_days div{padding:8px 0;border-top:1px solid #f1f5f9;font-size:14px}#ol_days b{display:block}' +
    '#wxv_hm ul{margin:6px 0 0;padding-left:18px;font-size:13px;color:#334155}#wxv_hm li{margin:4px 0}';
  var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  var host = document.getElementById('wxv_hm');
  if (!host) return;
  host.innerHTML = '<div class="cd"><h4>Hail outlook</h4><div id="ol_where" class="mu">Same place as this forecast.</div>' +
    '<div id="ol_rate"></div><div id="ol_days"></div><p class="mu" id="ol_note"></p>' +
    '<button type="button" class="src-link" data-sources>Sources</button></div>';

  var $ = function (id) { return document.getElementById(id); };
  var seq = 0;
  function getJson(url) {
    var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, 8000);
    return fetch(url, { cache: 'no-store', signal: ac.signal }).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { clearTimeout(t); throw e; });
  }
  function paint(lv) {
    $('ol_rate').textContent = lv.key === 'na' ? 'Outlook: data unavailable.' : ('Outlook: ' + lv.name + '.');
  }
  function dayBlock(title, spc) {
    if (!spc || !spc.ok) return '<div><b>' + esc(title) + '</b>SPC hail outlook: data unavailable.</div>';
    if (spc.uncovered) return '<div><b>' + esc(title) + '</b>This point is outside the drawn hail areas. The exact percent is data unavailable.</div>';
    var when = (spc.valid ? ct(spc.valid, true) : '') + (spc.expire ? ' – ' + ct(spc.expire, true) : '');
    var text = spc.label || (spc.dn ? spc.dn + '%' : 'Under 5%');
    return '<div><b>' + esc(title) + (when ? ' · ' + esc(when) : '') + '</b>' + esc(text) + '</div>';
  }
  function read(lat, lon, label) {
    var my = ++seq;
    $('ol_where').textContent = label || 'This place';
    $('ol_rate').textContent = 'Checking…';
    $('ol_days').innerHTML = '';
    $('ol_note').textContent = 'Checking the hail outlook…';
    var spcUrls = [
      'https://www.spc.noaa.gov/products/outlook/day1otlk_hail.lyr.geojson',
      'https://www.spc.noaa.gov/products/outlook/day2otlk_hail.lyr.geojson'
    ];
    var catUrl = 'https://www.spc.noaa.gov/products/outlook/day3otlk_cat.lyr.geojson';
    var omUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&daily=weather_code&timezone=America%2FChicago&forecast_days=7';
    Promise.all([
      getJson(spcUrls[0]).then(function (j) { return spcAt(j, lat, lon); }).catch(function () { return { ok: false }; }),
      getJson(spcUrls[1]).then(function (j) { return spcAt(j, lat, lon); }).catch(function () { return { ok: false }; }),
      getJson(catUrl).then(function (j) { return catAt(j, lat, lon); }).catch(function () { return { ok: false }; }),
      getJson(omUrl).then(function (j) {
        var t = (j.daily && j.daily.time) || [], c = (j.daily && j.daily.weather_code) || [];
        if (!t.length || t.length !== c.length) throw new Error('empty');
        return { ok: true, days: t.map(function (d, i) { return { date: d, code: c[i] }; }) };
      }).catch(function () { return { ok: false }; })
    ]).then(function (res) {
      if (my !== seq) return;
      var days = [{ title: 'Day 1 hail', spc: res[0] }, { title: 'Day 2 hail', spc: res[1] }];
      var cat = res[2], om = res[3];
      var lv = level(days, om);
      paint(lv);
      var html = days.map(function (d) { return dayBlock(d.title, d.spc); }).join('');
      html += '<div><b>Day 3 hail probability</b>Data unavailable. SPC does not publish a Day 3 hail outlook.</div>';
      if (!cat.ok) html += '<div><b>Day 3 severe category</b>Data unavailable. This is not used as a hail percent.</div>';
      else {
        var when = (cat.valid ? ct(cat.valid, true) : '') + (cat.expire ? ' – ' + ct(cat.expire, true) : '');
        html += '<div><b>Day 3 severe category' + (when ? ' · ' + esc(when) : '') + '</b>' +
          (cat.none ? 'No drawn SPC severe area at this point.' : esc(cat.label || 'Category on file')) +
          ' Not a hail percent.</div>';
      }
      if (!om.ok) html += '<div><b>Open-Meteo daily codes</b>Data unavailable.</div>';
      else html += '<div><b>Open-Meteo, next 7 days</b>' + om.days.map(function (d) {
        return esc(dayName(d.date)) + ': ' + esc(codeLine(d.code));
      }).join('<br>') + '</div>';
      $('ol_days').innerHTML = html;
      var miss = [];
      if (!res[0].ok || !res[1].ok) miss.push('an SPC hail day');
      if (!om.ok) miss.push('Open-Meteo');
      $('ol_note').textContent = miss.length ? ('Missing: ' + miss.join(' and ') + '. That part is data unavailable and is not guessed.') : '';
    });
  }
  window.HailOutlook = { read: read };
})();

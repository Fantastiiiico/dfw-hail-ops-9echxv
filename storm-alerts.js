/* Storm alert sheet on the Varro Restoration phone hail map.
   National Weather Service watches/warnings (api.weather.gov) plus this map's
   published hail areas and radar hail swaths. Nothing is filled in when a feed fails. */
(function () {
  var Lgc = window.StormAlertLogic;
  if (!Lgc) return;
  var sw24 = null;
  var origSw = window.HAILSW24;
  window.HAILSW24 = function (o) {
    sw24 = o;
    if (typeof origSw === 'function') origSw(o);
    if (api.onSwath) api.onSwath(o);
  };

  var ICO = {
    hail: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="7.5" cy="8" r="2.3" fill="currentColor"/><circle cx="15.5" cy="7.2" r="1.7" fill="currentColor"/><circle cx="12" cy="14.2" r="2.6" fill="currentColor"/><circle cx="16.2" cy="15.6" r="1.3" fill="currentColor"/></svg>',
    wind: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 8h11a2.4 2.4 0 1 0-2.2-2.4"/><path d="M3 12h15a2.4 2.4 0 1 1-2.2 2.4"/><path d="M3 16h8"/></svg>',
    tornado: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M3 4.2h18L14.2 11h-.8l.9 2.6h-1.6L11.4 18h-1.5l1.3-4.4H9.4L10.2 11H9.2L3 4.2z"/></svg>',
    thunderstorm: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M13.2 1.6L4.6 13.2h6.1l-1.2 9.2 9.9-13.4h-6.2l1.2-7.4z"/></svg>',
    snow: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 3v18M5.1 7.1l13.8 9.8M18.9 7.1L5.1 16.9"/><path d="M12 7.2l1.5-1.3M12 7.2L10.5 5.9M12 16.8l1.5 1.3M12 16.8l-1.5 1.3M8.2 9.2L6.8 8.4M8.2 9.2l.2-1.8M15.8 14.8l1.4.8M15.8 14.8l-.2 1.8M15.8 9.2l1.4-.8M15.8 9.2l-.2-1.8M8.2 14.8L6.8 15.6M8.2 14.8l.2 1.8"/></svg>'
  };
  var CHECK = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function todayCT() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  }
  function boxOf(b) {
    return { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() };
  }
  function unionGeoms(geoms) {
    var polys = [];
    geoms.forEach(function (g) {
      if (!g) return;
      if (g.type === 'Polygon') polys.push(g.coordinates);
      else if (g.type === 'MultiPolygon') (g.coordinates || []).forEach(function (p) { polys.push(p); });
    });
    if (!polys.length) return null;
    if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0] };
    return { type: 'MultiPolygon', coordinates: polys };
  }
  function mapPool(items, n, fn) {
    var i = 0, left = items.length;
    if (!left) return Promise.resolve();
    return new Promise(function (resolve) {
      function next() {
        if (i >= items.length) return;
        var cur = items[i++];
        Promise.resolve(fn(cur)).then(function () {}, function () {}).then(function () {
          left--;
          if (left <= 0) resolve();
          else next();
        });
      }
      for (var k = 0; k < n && k < items.length; k++) next();
    });
  }
  function fetchJson(url, ms) {
    var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ac) ac.abort(); }, ms || 12000);
    return fetch(url, { cache: 'no-store', signal: ac && ac.signal, headers: { Accept: 'application/geo+json' } }).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { clearTimeout(t); throw e; });
  }

  var FILTERS = [['all', 'All'], ['hail', 'Hail'], ['wind', 'Wind'], ['tornado', 'Tornado']];
  var state = {
    filter: 'all',
    named: [],
    swaths: [],
    nws: [],
    feed: { active: 'load', recent: 'load', swath: 'load' },
    place: 'this area',
    selected: null,
    collapsed: true,
    expandNote: '',
    list: [],
    icons: true
  };
  try { state.icons = localStorage.getItem('varroAlertMapIcons') !== '0'; } catch (e) {}
  var ZONE = {};
  var M = null;
  var layer = null;
  var drawKey = '';
  var geomSerial = 0;
  var geoSeq = 0;
  var booted = false;

  function filterWord(f) {
    if (f === 'hail') return 'hail';
    if (f === 'wind') return 'wind';
    if (f === 'tornado') return 'tornado';
    return 'storm';
  }
  function geomPending() {
    return state.nws.some(function (e) {
      return Lgc.matches(e, state.filter) && e.geomState === 'pending';
    });
  }
  function missingGeom() {
    return state.nws.some(function (e) {
      return Lgc.matches(e, state.filter) && (e.geomState === 'missing' || e.geomState === 'partial');
    });
  }
  function placedPool() {
    var out = state.named.filter(function (e) { return Lgc.matches(e, state.filter); });
    if (state.feed.swath === 'ok') out = out.concat(state.swaths.filter(function (e) { return Lgc.matches(e, state.filter); }));
    state.nws.forEach(function (e) {
      if (Lgc.matches(e, state.filter) && (e.geomState === 'ok' || e.geomState === 'partial') && e.geom) out.push(e);
    });
    return out;
  }
  function typeColor(ev) { return Lgc.kindColor(Lgc.markerCat(ev)); }
  function iconFor(ev) {
    var cat = Lgc.markerCat(ev);
    var size = ev.source === 'swath' ? 22 : 28;
    var ring = ev.status === 'live' ? '#B78A2A' : '#fff';
    var html = '<div class="as-pin-i" style="background:' + typeColor(ev) + ';border-color:' + ring + ';width:' + size + 'px;height:' + size + 'px">' + (ICO[cat] || ICO.wind) + '</div>';
    return L.divIcon({ className: 'as-pin', html: html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  }
  function popupHtml(ev) {
    var pill = ev.status === 'live' ? 'Live' : ev.status === 'closed' ? 'Closed' : 'data unavailable';
    return '<b>' + esc(ev.title) + '</b> <span class="as-pill ' + (ev.status === 'live' ? 'live' : ev.status === 'closed' ? 'closed' : 'unk') + '">' + esc(pill) + '</span><br>' + esc(Lgc.describeEvent(ev));
  }
  function drawMarkers() {
    if (!M || !layer) return;
    var box = boxOf(M.getBounds());
    var pins = state.pins || [];
    var key = [(state.icons ? '1' : '0'), state.filter, box.w.toFixed(2), box.s.toFixed(2), box.e.toFixed(2), box.n.toFixed(2), pins.map(function (e) { return e.id; }).join(','), geomSerial].join('|');
    if (key === drawKey) return;
    drawKey = key;
    layer.clearLayers();
    pins.forEach(function (ev) {
      var col = typeColor(ev);
      if (ev.source === 'nws' && ev.geom && Lgc.geomHits(ev.geom, box)) {
        L.geoJSON(ev.geom, {
          interactive: false,
          style: {
            color: col,
            weight: ev.status === 'live' ? 2.5 : 1.5,
            fillColor: col,
            fillOpacity: ev.status === 'live' ? 0.16 : 0.06,
            dashArray: ev.status === 'live' ? null : '5 4'
          }
        }).addTo(layer);
      }
      if (!state.icons) return;
      var lat = ev.lat, lon = ev.lon;
      if (lat == null || lon == null || !Lgc.pointIn(lat, lon, box)) return;
      var marker = L.marker([lat, lon], { icon: iconFor(ev), keyboard: true, title: ev.title, zIndexOffset: ev.live ? 500 : 200 });
      marker.bindPopup(popupHtml(ev), { maxWidth: 280 });
      marker.on('click', function (e) {
        if (e && e.originalEvent && L.DomEvent) L.DomEvent.stopPropagation(e.originalEvent);
        focusEvent(ev);
      });
      marker.addTo(layer);
    });
  }
  function arrange(rows, center) {
    var nws = [], named = [], sw = [];
    rows.forEach(function (e) {
      if (e.source === 'nws') nws.push(e);
      else if (e.source === 'swath') sw.push(e);
      else named.push(e);
    });
    nws = Lgc.sortEvents(nws);
    named = Lgc.sortEvents(named);
    var cover = sw.filter(function (e) { return e.geom && Lgc.contains(center.lat, center.lon, e.geom); });
    cover.sort(function (a, b) { return (b.when || 0) - (a.when || 0); });
    var swShow = cover.slice(0, 4);
    if (swShow.length < 3) {
      var rest = Lgc.sortEvents(sw.filter(function (e) { return swShow.indexOf(e) < 0; }));
      swShow = swShow.concat(rest.slice(0, 3 - swShow.length));
    }
    var namedShow = named.slice(0, 20);
    return {
      rows: nws.concat(namedShow, swShow),
      pins: nws.concat(namedShow),
      more: (named.length - namedShow.length) + (sw.length - swShow.length)
    };
  }
  function focusEvent(ev) {
    state.selected = ev.id;
    state.collapsed = false;
    var sheet = document.getElementById('alertSheet');
    if (sheet) sheet.classList.remove('is-min');
    if (!M || ev.lat == null) { render(); return; }
    var c = M.getCenter();
    if (ev.geom && Lgc.contains(c.lat, c.lng, ev.geom)) { render(); return; }
    var ll = L.latLng(ev.lat, ev.lon);
    var z = M.getZoom();
    if (M.getBounds().contains(ll)) M.panTo(ll, { animate: true, duration: 0.35 });
    else M.flyTo(ll, Math.max(z, 9), { duration: 0.45 });
    render();
  }
  function expand() {
    var pool = placedPool();
    if (!pool.length) {
      state.expandNote = 'No ' + filterWord(state.filter) + ' alerts in the available data.';
      render();
      return;
    }
    var c = M.getCenter();
    var center = { lat: c.lat, lon: c.lng };
    var z = M.getZoom();
    var size = M.getSize();
    function project(ll, zoom) {
      var p = M.project(L.latLng(ll.lat, ll.lon), zoom);
      return { x: p.x, y: p.y };
    }
    function unproject(pt, zoom) {
      var ll = M.unproject(L.point(pt.x, pt.y), zoom);
      return { lat: ll.lat, lng: ll.lng };
    }
    var minZ = M.getMinZoom();
    for (var i = 0; i < 18; i++) {
      if (z <= minZ) break;
      z = Math.max(minZ, z - 1);
      var box = Lgc.boundsAt(center, z, size, project, unproject);
      var hit = pool.some(function (e) { return Lgc.eventInView(e, box); });
      if (hit) {
        state.expandNote = '';
        M.flyTo(c, z, { duration: 0.55 });
        return;
      }
    }
    var best = null, bd = Infinity;
    pool.forEach(function (e) {
      if (e.lat == null) return;
      var d = Lgc.distToEvent(e, center).miles;
      if (d != null && d < bd) { bd = d; best = e; }
    });
    if (!best) {
      state.expandNote = 'No ' + filterWord(state.filter) + ' alerts in the available data.';
      render();
      return;
    }
    state.expandNote = '';
    M.flyTo([best.lat, best.lon], 9, { duration: 0.65 });
  }
  function metaFor(ev, center, now) {
    var info = Lgc.distToEvent(ev, center);
    ev._miles = info.miles;
    var dist = Lgc.distText(info);
    var ago = ev.date ? Lgc.daysAgoLabel(ev.date, todayCT()) : Lgc.agoFromMs(ev.when, now);
    return [dist, ago].filter(Boolean).join(' · ');
  }
  function render() {
    var listEl = document.getElementById('asList');
    var titleEl = document.getElementById('asTitle');
    var sheet = document.getElementById('alertSheet');
    if (!listEl || !M) return;
    if (titleEl) titleEl.textContent = 'Alerts in ' + (state.place || 'this area');
    if (sheet) sheet.classList.toggle('is-min', !!state.collapsed);
    var box = boxOf(M.getBounds());
    var center = { lat: M.getCenter().lat, lon: M.getCenter().lng };
    var now = Date.now();
    var rows = Lgc.visibleEvents(state.named, state.feed.swath === 'ok' ? state.swaths : [], state.nws, state.filter, box);
    rows.forEach(function (ev) { ev._meta = metaFor(ev, center, now); });
    var arranged = arrange(rows, center);
    rows = arranged.rows;
    state.list = rows;
    state.pins = arranged.pins;
    var waiting = Lgc.feedWaiting(state.filter, state.feed, geomPending());
    var note = Lgc.feedNote(state.filter, state.feed, missingGeom());
    var mode = Lgc.listMode({ inViewCount: rows.length, waiting: waiting, note: note });
    var html = '';
    if (note && mode === 'cards') html += '<div class="as-unavail as-inline"><b>data unavailable</b><span>' + esc(note) + '</span></div>';
    if (waiting && mode === 'cards') html += '<p class="as-note">Checking National Weather Service…</p>';
    if (mode === 'loading') {
      html += '<p class="as-wait">Checking National Weather Service…</p>';
    } else if (mode === 'unavailable') {
      html += '<div class="as-unavail"><b>data unavailable</b><span>' + esc(note) + '</span>' +
        '<button type="button" class="as-expand" id="asExpand">Expand Search Area</button>' +
        (state.expandNote ? '<p class="as-extra">' + esc(state.expandNote) + '</p>' : '') + '</div>';
    } else if (mode === 'empty') {
      html += '<div class="as-empty"><div class="as-check">' + CHECK + '</div><p>No alerts in this area.</p>' +
        '<button type="button" class="as-expand" id="asExpand">Expand Search Area</button>' +
        (state.expandNote ? '<p class="as-extra">' + esc(state.expandNote) + '</p>' : '') + '</div>';
    } else {
      var shown = rows;
      html += shown.map(function (ev, i) {
        var pill = ev.status === 'live' ? 'Live' : ev.status === 'closed' ? 'Closed' : 'data unavailable';
        var cls = ev.status === 'live' ? 'live' : ev.status === 'closed' ? 'closed' : 'unk';
        var cat = Lgc.markerCat(ev);
        var col = typeColor(ev);
        return '<button type="button" class="as-card' + (ev.id === state.selected ? ' on' : '') + '" data-i="' + i + '" style="border-left:5px solid ' + col + '">' +
          '<span class="as-ico" style="background:' + col + '">' + (ICO[cat] || ICO.wind) + '</span>' +
          '<span class="as-main"><span class="as-top"><span class="as-name">' + esc(ev.title) + '</span>' +
          '<span class="as-pill ' + cls + '">' + esc(pill) + '</span></span>' +
          '<span class="as-meta">' + esc(ev._meta || '') + '</span>' +
          '<span class="as-desc">' + esc(Lgc.describeEvent(ev)) + '</span></span></button>';
      }).join('');
      if (arranged.more > 0) html += '<p class="as-note">' + arranged.more + ' more in this view.</p>';
    }
    listEl.innerHTML = html;
    var exp = document.getElementById('asExpand');
    if (exp) exp.onclick = function () { expand(); };
    [].forEach.call(listEl.querySelectorAll('.as-card'), function (btn) {
      btn.onclick = function () {
        var ev = state.list[+btn.getAttribute('data-i')];
        if (ev) focusEvent(ev);
      };
    });
    drawMarkers();
    requestAnimationFrame(syncChrome);
  }
  function syncChrome() {
    var sheet = document.getElementById('alertSheet');
    var wrap = document.getElementById('mapwrap');
    if (!sheet || !wrap) return;
    var nav = document.querySelector('.bnav');
    var navH = nav ? nav.offsetHeight : 64;
    wrap.style.setProperty('--asheet', (sheet.offsetHeight + navH + 14) + 'px');
  }
  function fitMap() {
    var wrap = document.getElementById('mapwrap');
    var mapEl = document.getElementById('map');
    if (!wrap || !mapEl) return;
    var top = wrap.getBoundingClientRect().top + window.scrollY;
    var h = Math.round(window.innerHeight - top);
    if (h < 420) h = 420;
    mapEl.style.height = h + 'px';
    if (M) M.invalidateSize({ pan: false });
    syncChrome();
  }
  function scheduleGeo() {
    clearTimeout(scheduleGeo.t);
    scheduleGeo.t = setTimeout(runGeo, 420);
  }
  function runGeo() {
    if (!M) return;
    var c = M.getCenter();
    var my = ++geoSeq;
    var url = 'https://photon.komoot.io/reverse?lang=en&lat=' + c.lat.toFixed(4) + '&lon=' + c.lng.toFixed(4);
    fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (my !== geoSeq || !M) return;
      var props = j.features && j.features[0] && j.features[0].properties;
      state.place = Lgc.placeTitle(props || null, boxOf(M.getBounds()));
      var t = document.getElementById('asTitle');
      if (t) t.textContent = 'Alerts in ' + state.place;
    }).catch(function () {
      if (my !== geoSeq) return;
      state.place = 'this area';
      var t = document.getElementById('asTitle');
      if (t) t.textContent = 'Alerts in this area';
    });
  }
  function applyZones() {
    state.nws.forEach(function (e) {
      if (e.geomState !== 'pending') return;
      var zones = e.zones || [];
      if (!zones.length) { e.geomState = 'missing'; return; }
      if (zones.some(function (u) { return !(u in ZONE); })) return;
      var geoms = [], failed = false;
      zones.forEach(function (u) {
        if (ZONE[u]) geoms.push(ZONE[u]);
        else failed = true;
      });
      if (!geoms.length) { e.geomState = 'missing'; return; }
      e.geom = unionGeoms(geoms);
      e.bbox = e.geom ? Lgc.bboxOf(e.geom) : null;
      var anchor = e.geom ? Lgc.anchorOf(e.geom) : null;
      if (anchor) { e.lat = anchor.lat; e.lon = anchor.lon; }
      e.geomState = failed ? 'partial' : 'ok';
    });
    geomSerial++;
    drawKey = '';
  }
  function resolveZones() {
    var urls = [], seen = {};
    state.nws.forEach(function (e) {
      if (e.geomState !== 'pending') return;
      (e.zones || []).forEach(function (u) {
        if (u && !seen[u] && !(u in ZONE)) { seen[u] = 1; urls.push(u); }
      });
    });
    return mapPool(urls, 5, function (u) {
      return fetchJson(u, 10000).then(function (j) {
        ZONE[u] = j && j.geometry ? j.geometry : null;
      }).catch(function () { ZONE[u] = null; });
    }).then(function () {
      applyZones();
      var still = state.nws.some(function (e) { return e.geomState === 'pending'; });
      if (still) {
        state.nws.forEach(function (e) { if (e.geomState === 'pending') e.geomState = 'missing'; });
        geomSerial++;
        drawKey = '';
      }
    });
  }
  function loadOne(url, slot) {
    var keep = state.feed[slot] === 'ok';
    return fetchJson(url, 12000).then(function (j) {
      state.feed[slot] = 'ok';
      return j.features || [];
    }).catch(function () {
      state.feed[slot] = keep ? 'ok' : 'err';
      return null;
    });
  }
  function loadNws() {
    var events = 'Tornado Warning,Tornado Watch,Severe Thunderstorm Warning,Severe Thunderstorm Watch,Extreme Wind Warning,High Wind Warning,High Wind Watch,Wind Advisory,Special Weather Statement,Winter Storm Warning,Winter Storm Watch,Winter Weather Advisory,Blizzard Warning,Snow Squall Warning,Lake Effect Snow Warning,Lake Effect Snow Advisory';
    var recentUrl = 'https://api.weather.gov/alerts?area=TX&limit=200&event=' + encodeURIComponent(events);
    var activeUrl = 'https://api.weather.gov/alerts/active?area=TX';
    return Promise.all([loadOne(activeUrl, 'active'), loadOne(recentUrl, 'recent')]).then(function (both) {
      if ((both[0] == null || both[1] == null) && state.nws.length) { render(); return; }
      var feats = [];
      if (both[0]) feats = feats.concat(both[0]);
      if (both[1]) feats = feats.concat(both[1]);
      state.nws = Lgc.groupAlerts(feats, Date.now());
      return resolveZones();
    }).then(function () { if (booted) render(); });
  }
  function build() {
    var css = document.createElement('style');
    css.textContent = '' +
      '#map{height:calc(100vh - 168px);height:calc(100dvh - 168px);min-height:440px}' +
      '#mapwrap{position:relative}' +
      '#alertSheet{position:absolute;left:8px;right:8px;bottom:calc(var(--nav, 64px) + env(safe-area-inset-bottom) + 6px);z-index:820;background:#fff;border-radius:16px;box-shadow:0 8px 24px rgba(15,23,42,.16);display:flex;flex-direction:column;height:auto;max-height:42%;max-width:744px;margin:0 auto;overflow:hidden}' +
      '#alertSheet.is-min{max-height:none}' +
      '#alertSheet.is-min #asList{display:none}' +
      '#alertSheet .as-grab{display:block;width:100%;border:0;background:transparent;padding:5px 0 0;cursor:pointer}' +
      '#alertSheet .as-grab i{display:block;width:36px;height:4px;border-radius:3px;background:#cbd5e1;margin:0 auto}' +
      '#asTitle,.as-chips,.as-bar{flex:0 0 auto}' +
      '#asTitle{margin:0;padding:1px 10px 0;font-size:17px;letter-spacing:-.02em;color:#0A2748;line-height:1.15}' +
      '.as-bar{display:flex;align-items:center;gap:6px;padding:4px 8px 6px}' +
      '.as-bar .as-chips{flex:1;min-width:0;padding:0}' +
      '.as-bar .src-link{margin:0;flex:0 0 auto;font-size:13px}' +
      '.as-chips{display:flex;gap:6px;overflow-x:auto;padding:0 10px 6px;scrollbar-width:none;-webkit-overflow-scrolling:touch}' +
      '.as-chips::-webkit-scrollbar{display:none}' +
      '.as-chips button{flex:0 0 auto;border:1px solid #e5e7eb;background:#fff;color:#0A2748;border-radius:999px;padding:4px 10px;font:700 13px/1.2 system-ui,-apple-system,sans-serif;cursor:pointer}' +
      '.as-chips button i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:1px}' +
      '.as-chips button.on{background:#0A2748;color:#fff;border-color:#0A2748}' +
      '.as-titlebar{display:flex;align-items:center;gap:6px;padding:0 8px 0 0}' +
      '.as-titlebar #asTitle{flex:1;padding-right:0}' +
      '.as-tog{flex:0 0 auto;display:flex;align-items:center;gap:4px;font-size:12px;font-weight:700;color:#0A2748;margin:0}' +
      '.as-tog input{width:18px;height:18px;accent-color:#0A2748;margin:0}' +
      '#asList{overflow:auto;-webkit-overflow-scrolling:touch;flex:1 1 auto;min-height:0;padding-bottom:8px}' +
      '.as-card{display:flex;gap:10px;width:calc(100% - 24px);margin:0 12px 10px;padding:12px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;text-align:left;cursor:pointer;font:inherit;color:inherit}' +
      '.as-card.on{border-color:#B78A2A;box-shadow:0 0 0 1px #B78A2A}' +
      '.as-ico{flex:0 0 40px;width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff}' +
      '.as-main{flex:1;min-width:0}' +
      '.as-top{display:flex;gap:8px;align-items:flex-start}' +
      '.as-name{flex:1;min-width:0;font-weight:800;font-size:15px;line-height:1.25;color:#0A2748}' +
      '.as-pill{flex:0 0 auto;font-size:12px;font-weight:800;border-radius:999px;padding:3px 8px;line-height:1.3}' +
      '.as-pill.live{background:#B78A2A;color:#fff}' +
      '.as-pill.closed{background:#e5e7eb;color:#334155}' +
      '.as-pill.unk{background:#fff7ed;color:#9A3412}' +
      '.as-meta{display:block;margin-top:3px;font-size:13px;color:#64748b}' +
      '.as-desc{display:block;margin-top:6px;font-size:14px;line-height:1.35;color:#334155}' +
      '.as-empty{text-align:center;padding:16px 16px 8px}' +
      '.as-check{width:54px;height:54px;margin:4px auto 8px;color:#64748b;display:flex;align-items:center;justify-content:center}' +
      '.as-empty p{margin:0 0 12px;font-weight:800;font-size:16px;color:#0f172a}' +
      '.as-expand{display:flex;align-items:center;justify-content:center;width:100%;min-height:46px;border:0;border-radius:12px;background:#0A2748;color:#fff;font:700 15px/1.2 system-ui,-apple-system,sans-serif;cursor:pointer}' +
      '.as-unavail{margin:4px 12px 10px;background:#fff7ed;border:1px solid #f59e0b;color:#9A3412;border-radius:12px;padding:12px;font-weight:700}' +
      '.as-unavail span{display:block;margin:4px 0 10px;font-weight:600;font-size:14px;line-height:1.35}' +
      '.as-unavail.as-inline{margin-top:0}' +
      '.as-wait,.as-note,.as-src,.as-extra{font-size:12.5px;color:#64748b;margin:4px 14px 8px;line-height:1.4}' +
      '.as-wait{font-size:14px;font-weight:700;color:#0A2748;padding:12px 2px}' +
      '.as-extra{font-weight:700;color:#0A2748}' +
      '.as-pin{background:transparent;border:0}' +
      '.as-pin-i{border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)}' +
      '#map .leaflet-bottom{bottom:var(--asheet, 220px)!important}' +
      '#mapwrap .legend{bottom:calc(var(--asheet, 220px) + 4px)!important}' +
      '#mapwrap #mbar{bottom:calc(var(--asheet, 220px) + 54px)!important}' +
      '#mapwrap #rvbar{bottom:calc(var(--asheet, 220px) + 4px)!important}';
    document.head.appendChild(css);
    var wrap = document.getElementById('mapwrap');
    if (!wrap) return;
    var sheet = document.createElement('section');
    sheet.id = 'alertSheet';
    sheet.setAttribute('aria-label', 'Storm alerts for the map view');
    var dots = { hail: '#1d4ed8', wind: '#0f766e', tornado: '#dc2626' };
    var chips = FILTERS.map(function (f) {
      var dot = dots[f[0]] ? '<i style="background:' + dots[f[0]] + '"></i>' : '';
      return '<button type="button" data-f="' + f[0] + '"' + (f[0] === 'all' ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + dot + f[1] + '</button>';
    }).join('');
    sheet.className = 'is-min';
    sheet.innerHTML = '<button type="button" class="as-grab" id="asGrab" aria-expanded="false" aria-label="Show or hide the alert list"><i></i></button>' +
      '<div class="as-titlebar"><h2 id="asTitle">Alerts in this area</h2><label class="as-tog"><input type="checkbox" id="asIcons"' + (state.icons ? ' checked' : '') + '> Map icons</label></div>' +
      '<div class="as-bar"><div class="as-chips" role="tablist">' + chips + '</div><button type="button" class="src-link" data-sources>Sources</button></div><div id="asList" aria-live="polite"></div>';
    wrap.appendChild(sheet);
    sheet.querySelector('#asGrab').onclick = function () {
      state.collapsed = !state.collapsed;
      this.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true');
      render();
    };
    sheet.querySelector('#asIcons').onchange = function () {
      state.icons = !!this.checked;
      try { localStorage.setItem('varroAlertMapIcons', state.icons ? '1' : '0'); } catch (e) {}
      drawKey = '';
      drawMarkers();
    };
    [].forEach.call(sheet.querySelectorAll('.as-chips button'), function (b) {
      b.onclick = function () {
        state.filter = b.getAttribute('data-f');
        state.expandNote = '';
        state.selected = null;
        drawKey = '';
        [].forEach.call(sheet.querySelectorAll('.as-chips button'), function (x) {
          var on = x === b;
          x.classList.toggle('on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        render();
      };
    });
  }

  var api = {
    onSwath: function (o) {
      if (!o || !o.d) { state.feed.swath = 'err'; state.swaths = []; }
      else { state.feed.swath = 'ok'; state.swaths = Lgc.swathEvents(o); }
      drawKey = '';
      if (booted) render();
    }
  };
  window.StormAlerts = api;

  function boot() {
    if (!window.L || !window.M) { setTimeout(boot, 80); return; }
    if (booted) return;
    booted = true;
    M = window.M;
    state.named = Lgc.namedHail(window.AR, 'ar').concat(Lgc.namedHail(window.HIST, 'hist'));
    if (sw24) api.onSwath(sw24);
    build();
    fitMap();
    layer = L.layerGroup().addTo(M);
    var rt = null;
    M.on('moveend', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { render(); scheduleGeo(); }, 70);
    });
    window.addEventListener('resize', fitMap);
    render();
    scheduleGeo();
    loadNws();
    setInterval(function () { if (!document.hidden) loadNws(); }, 300000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) loadNws(); });
    setTimeout(function () {
      if (state.feed.swath === 'load') { state.feed.swath = 'err'; render(); }
    }, 20000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

/* Map-linked storm alerts for the Varro Restoration phone map.
   Pure helpers: no network, no DOM. Cards only use fields passed in from
   National Weather Service alerts and this app's published hail history. */
(function (root) {
  function ringsOf(g) {
    if (!g) return [];
    if (g.type === 'Polygon') return g.coordinates || [];
    if (g.type === 'MultiPolygon') {
      var out = [];
      (g.coordinates || []).forEach(function (p) { (p || []).forEach(function (r) { out.push(r); }); });
      return out;
    }
    if (g.type === 'GeometryCollection') {
      var all = [];
      (g.geometries || []).forEach(function (x) { ringsOf(x).forEach(function (r) { all.push(r); }); });
      return all;
    }
    return [];
  }
  function eachCoord(g, fn) {
    ringsOf(g).forEach(function (r) { r.forEach(function (c) { if (c && c.length >= 2) fn(c[0], c[1]); }); });
  }
  function pip(lon, lat, ring) {
    var c = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-15) + xi) c = !c;
    }
    return c;
  }
  function contains(lat, lon, g) {
    var rings = ringsOf(g);
    if (!rings.length) return false;
    var hits = 0;
    for (var i = 0; i < rings.length; i++) if (pip(lon, lat, rings[i])) hits++;
    return hits % 2 === 1;
  }
  function bboxOf(g) {
    var b = [Infinity, Infinity, -Infinity, -Infinity], n = 0;
    eachCoord(g, function (lon, lat) {
      n++;
      if (lon < b[0]) b[0] = lon;
      if (lat < b[1]) b[1] = lat;
      if (lon > b[2]) b[2] = lon;
      if (lat > b[3]) b[3] = lat;
    });
    return n ? b : null;
  }
  function bboxOverlap(b, box) {
    if (!b) return true;
    return !(b[2] < box.w || b[0] > box.e || b[3] < box.s || b[1] > box.n);
  }
  function pointIn(lat, lon, box) {
    return lon >= box.w && lon <= box.e && lat >= box.s && lat <= box.n;
  }
  function geomHits(g, box) {
    if (!g || !box) return false;
    var bb = g._bbox || bboxOf(g);
    if (!bboxOverlap(bb, box)) return false;
    var probes = [[box.w, box.s], [box.w, box.n], [box.e, box.s], [box.e, box.n], [(box.w + box.e) / 2, (box.s + box.n) / 2]];
    for (var i = 0; i < probes.length; i++) if (contains(probes[i][1], probes[i][0], g)) return true;
    var rings = ringsOf(g);
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r], step = Math.max(1, Math.floor(ring.length / 32));
      for (var k = 0; k < ring.length; k += step) {
        if (pointIn(ring[k][1], ring[k][0], box)) return true;
      }
    }
    return false;
  }
  function anchorOf(g) {
    var bb = bboxOf(g);
    if (!bb) return null;
    var cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    if (contains(cy, cx, g)) return { lat: cy, lon: cx };
    var best = null, bd = Infinity;
    eachCoord(g, function (lon, lat) {
      var d = (lon - cx) * (lon - cx) + (lat - cy) * (lat - cy);
      if (d < bd) { bd = d; best = { lat: lat, lon: lon }; }
    });
    return best;
  }
  function firstParam(p, k) {
    var v = p && p.parameters && p.parameters[k];
    if (Array.isArray(v)) return v.length ? v[0] : null;
    return v == null || v === '' ? null : v;
  }
  function hailSizeText(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s) return null;
    var n = parseFloat(s);
    if (!isFinite(n) || n <= 0) return null;
    return s;
  }
  function categorize(p) {
    var event = (p && p.event) || '';
    var el = event.toLowerCase();
    var text = (((p && p.headline) || '') + ' ' + ((p && p.description) || '')).toLowerCase();
    var hailSize = hailSizeText(firstParam(p, 'maxHailSize'));
    var windRaw = firstParam(p, 'maxWindGust');
    var windGust = windRaw == null ? null : String(windRaw).trim();
    if (!windGust) windGust = null;
    var hailThreat = firstParam(p, 'hailThreat');
    var windThreat = firstParam(p, 'windThreat');
    var torDet = firstParam(p, 'tornadoDetection');
    var cats = [];
    if (/tornado/.test(el)) cats.push('tornado');
    var hail = /hail/.test(el) || !!hailSize || !!hailThreat || (/severe thunderstorm/.test(el) && /hail/.test(text));
    var wind = /wind/.test(el) || !!windGust || !!windThreat || (/severe thunderstorm/.test(el) && /\bwind\b|gust/.test(text));
    if (!cats.length && /special weather statement|severe weather statement/.test(el)) {
      if (/tornado/.test(text)) cats.push('tornado');
      if (/hail/.test(text)) hail = true;
      if (/\bwind\b|gust/.test(text)) wind = true;
    }
    if (hail && cats.indexOf('hail') < 0) cats.push('hail');
    if (wind && cats.indexOf('wind') < 0) cats.push('wind');
    return {
      cats: cats,
      hailSize: hailSize,
      windGust: windGust,
      threats: {
        hail: hailThreat ? String(hailThreat) : null,
        wind: windThreat ? String(windThreat) : null,
        tornado: torDet ? String(torDet) : null
      }
    };
  }
  function vtecParts(p) {
    var v = firstParam(p, 'VTEC');
    if (!v) return null;
    var m = String(v).match(/\/[OTEX]\.([A-Z]{3})\.([A-Z0-9]+)\.([A-Z]{2})\.([WAYSF])\.(\d{4})\./);
    if (!m) return null;
    return { action: m[1], office: m[2], phen: m[3], sig: m[4], etn: m[5], key: m[2] + '.' + m[3] + '.' + m[4] + '.' + m[5] };
  }
  var LIVE_ACT = { NEW: 1, CON: 1, EXT: 1, EXA: 1, EXB: 1, COR: 1, UPG: 1 };
  function parseTime(s) {
    if (!s) return null;
    var t = Date.parse(s);
    return isFinite(t) ? t : null;
  }
  function clean(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }
  function nwsTitle(event, area) {
    var parts = String(area || '').split(';').map(function (s) { return s.trim(); }).filter(Boolean);
    if (parts.length === 1) return event + ' in ' + parts[0];
    if (parts.length > 1 && parts.length <= 3) return event + ' in ' + parts.join('; ');
    return event;
  }
  function groupAlerts(features, now) {
    var groups = {};
    (features || []).forEach(function (f) {
      var p = (f && f.properties) || {};
      if (p.replacedBy) return;
      var st = (p.status || 'Actual').toLowerCase();
      if (st && st !== 'actual') return;
      var info = categorize(p);
      if (!info.cats.length) return;
      var vt = vtecParts(p);
      var key = (vt && vt.key) || p.id || p['@id'] || (p.event + '|' + (p.sent || '') + '|' + (p.areaDesc || ''));
      var g = groups[key] || (groups[key] = []);
      g.push({ f: f, p: p, info: info, vt: vt, sent: parseTime(p.sent) || 0 });
    });
    return Object.keys(groups).map(function (key) {
      var msgs = groups[key].sort(function (a, b) { return b.sent - a.sent; });
      var display = null;
      for (var i = 0; i < msgs.length; i++) {
        var mt = msgs[i].p.messageType;
        var head = msgs[i].p.headline || '';
        if (mt === 'Cancel' || /has been cancelled/i.test(head)) continue;
        display = msgs[i];
        break;
      }
      if (!display) display = msgs[0];
      var geom = null;
      for (var j = 0; j < msgs.length; j++) if (msgs[j].f.geometry) { geom = msgs[j].f.geometry; break; }
      var ends = [];
      msgs.forEach(function (m) {
        var t = parseTime(m.p.ends || m.p.expires);
        if (t) ends.push(t);
      });
      var end = ends.length ? Math.max.apply(null, ends) : null;
      var cancelled = msgs.some(function (m) {
        return m.p.messageType === 'Cancel' || (m.vt && m.vt.action === 'CAN') || /has been cancelled/i.test(m.p.headline || '');
      });
      var latest = msgs[0];
      var liveAct = latest.vt ? !!LIVE_ACT[latest.vt.action] : latest.p.messageType !== 'Cancel';
      var status = 'unknown';
      if (cancelled || (end != null && end <= now) || (latest.vt && (latest.vt.action === 'CAN' || latest.vt.action === 'EXP'))) status = 'closed';
      else if (end != null && end > now && liveAct && latest.p.messageType !== 'Cancel') status = 'live';
      var headline = clean(display.p.headline || '');
      if (cancelled && !/cancel/i.test(headline)) headline = (headline ? headline + ' ' : '') + 'The National Weather Service cancelled this alert.';
      var anchor = geom ? anchorOf(geom) : null;
      var zones = display.p.affectedZones || latest.p.affectedZones || [];
      return {
        id: 'nws:' + key,
        source: 'nws',
        cats: display.info.cats,
        event: display.p.event,
        area: clean(display.p.areaDesc || latest.p.areaDesc || ''),
        title: nwsTitle(display.p.event, display.p.areaDesc || latest.p.areaDesc || ''),
        headline: headline,
        hailSize: display.info.hailSize,
        windGust: display.info.windGust,
        threats: display.info.threats,
        status: status,
        live: status === 'live',
        sent: display.sent || latest.sent || null,
        end: end,
        when: display.sent || latest.sent || null,
        geom: geom,
        bbox: geom ? bboxOf(geom) : null,
        lat: anchor ? anchor.lat : null,
        lon: anchor ? anchor.lon : null,
        zones: geom ? [] : zones.slice(),
        geomState: geom ? 'ok' : (zones.length ? 'pending' : 'missing')
      };
    });
  }
  function inches(n) {
    if (typeof n !== 'number' || !isFinite(n) || n <= 0) return null;
    var s = (Math.round(n * 100) / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return s + '"';
  }
  function namedHail(list, kind) {
    return (list || []).map(function (a, i) {
      if (!a || a.lat == null || a.lon == null || !a.d) return null;
      return {
        id: kind + ':' + i,
        source: 'hail-area',
        cats: ['hail'],
        date: a.d,
        name: a.nm || '',
        inches: inches(typeof a.gm === 'number' ? a.gm : parseFloat(a.gm)),
        lat: +a.lat,
        lon: +a.lon,
        status: 'closed',
        live: false,
        title: 'Hail · ' + (a.nm || 'Reported area'),
        when: Date.parse(a.d + 'T18:00:00Z'),
        geom: null,
        geomState: 'ok'
      };
    }).filter(Boolean);
  }
  function swathEvents(sw24) {
    var d = sw24 && sw24.d;
    if (!d) return [];
    return Object.keys(d).sort().map(function (day) {
      var pair = d[day];
      var geom = pair && pair[1];
      if (!geom) return null;
      var anchor = anchorOf(geom);
      if (!anchor) return null;
      var bb = bboxOf(geom);
      geom._bbox = bb;
      return {
        id: 'swath:' + day,
        source: 'swath',
        cats: ['hail'],
        date: day,
        lat: anchor.lat,
        lon: anchor.lon,
        geom: geom,
        bbox: bb,
        status: 'closed',
        live: false,
        title: 'Radar hail · ' + dateLabel(day),
        when: Date.parse(day + 'T18:00:00Z'),
        geomState: 'ok'
      };
    }).filter(Boolean);
  }
  function matches(ev, filter) {
    if (!ev) return false;
    if (filter === 'all') return true;
    return (ev.cats || []).indexOf(filter) >= 0;
  }
  function eventInView(ev, box) {
    if (!ev || !box) return false;
    if (ev.geom) return geomHits(ev.geom, box);
    if (ev.lat != null && ev.lon != null) return pointIn(ev.lat, ev.lon, box);
    return false;
  }
  function visibleEvents(named, swaths, nws, filter, box) {
    var namedIn = (named || []).filter(function (e) { return matches(e, filter) && eventInView(e, box); });
    var dates = {};
    namedIn.forEach(function (e) { if (e.date) dates[e.date] = 1; });
    var swIn = (swaths || []).filter(function (e) { return matches(e, filter) && !dates[e.date] && eventInView(e, box); });
    var nwsIn = (nws || []).filter(function (e) {
      return matches(e, filter) && (e.geomState === 'ok' || e.geomState === 'partial') && eventInView(e, box);
    });
    return namedIn.concat(swIn, nwsIn);
  }
  function hav(lat1, lon1, lat2, lon2) {
    var r = Math.PI / 180;
    var x = Math.sin((lat2 - lat1) * r / 2), y = Math.sin((lon2 - lon1) * r / 2);
    return 7917.6 * Math.asin(Math.min(1, Math.sqrt(x * x + Math.cos(lat1 * r) * Math.cos(lat2 * r) * y * y)));
  }
  function distToEvent(ev, center) {
    if (!ev || !center) return { miles: null, inside: false };
    if (ev.geom && contains(center.lat, center.lon, ev.geom)) return { miles: 0, inside: true };
    var best = Infinity;
    if (ev.geom) {
      eachCoord(ev.geom, function (lon, lat) {
        var d = hav(center.lat, center.lon, lat, lon);
        if (d < best) best = d;
      });
    } else if (ev.lat != null && ev.lon != null) {
      best = hav(center.lat, center.lon, ev.lat, ev.lon);
    }
    return { miles: isFinite(best) ? best : null, inside: false };
  }
  function distText(info) {
    if (!info || info.miles == null || !isFinite(info.miles)) return '';
    if (info.inside) return 'here';
    if (info.miles < 0.1) return 'under 0.1 mi away';
    if (info.miles < 10) return (Math.round(info.miles * 10) / 10).toFixed(1) + ' mi away';
    return Math.round(info.miles) + ' mi away';
  }
  function daysBetween(fromYmd, toYmd) {
    var a = Date.parse(fromYmd + 'T00:00:00Z'), b = Date.parse(toYmd + 'T00:00:00Z');
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.round((b - a) / 86400000);
  }
  function daysAgoLabel(ymd, today) {
    var d = daysBetween(ymd, today);
    if (d == null || d < 0) return '';
    if (d === 0) return 'today';
    return d + 'd';
  }
  function agoFromMs(ts, now) {
    if (ts == null || !isFinite(ts) || !isFinite(now)) return '';
    var s = Math.max(0, now - ts);
    var min = Math.round(s / 60000);
    if (min < 1) return 'now';
    if (min < 60) return min + 'm';
    var hr = Math.round(s / 3600000);
    if (hr < 48) return hr + 'h';
    return Math.round(s / 86400000) + 'd';
  }
  function dateLabel(ymd) {
    var p = String(ymd || '').split('-');
    if (p.length < 3) return ymd || '';
    var t = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 18));
    if (!isFinite(t.getTime())) return ymd;
    return t.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function withInches(s) {
    if (/inch|"/i.test(s)) return s;
    return s + '"';
  }
  function describeEvent(ev) {
    if (!ev) return '';
    if (ev.source === 'nws') {
      var bits = [];
      if (ev.headline) bits.push(ev.headline);
      if (ev.hailSize) bits.push('Hail size on the alert: ' + withInches(ev.hailSize) + '.');
      if (ev.windGust) bits.push('Wind gust on the alert: ' + ev.windGust + '.');
      if (ev.threats && ev.threats.hail) bits.push('NWS hail threat: ' + ev.threats.hail + '.');
      if (ev.threats && ev.threats.wind) bits.push('NWS wind threat: ' + ev.threats.wind + '.');
      if (ev.threats && ev.threats.tornado) bits.push('NWS tornado detection: ' + ev.threats.tornado + '.');
      return bits.join(' ');
    }
    if (ev.source === 'hail-area') {
      var line = dateLabel(ev.date) + '.';
      if (ev.inches) line += ' Largest hail on file: ' + ev.inches + '.';
      return line;
    }
    if (ev.source === 'swath') return dateLabel(ev.date) + '. Radar saw 1"+ hail in this view (possible hail).';
    return '';
  }
  function placeTitle(props, box) {
    if (!props || !box) return 'this area';
    var state = props.state || '';
    if (state && state !== 'Texas' && state !== 'TX') return 'this area';
    var latSpan = box.n - box.s, lonSpan = box.e - box.w;
    if (!(latSpan > 0) || !(lonSpan > 0)) return 'this area';
    if (latSpan > 1.15 || lonSpan > 1.35) return 'this area';
    var city = props.city || '';
    var county = props.county || '';
    if (latSpan <= 0.42 && lonSpan <= 0.55 && city) return city;
    if (county) return /county$/i.test(county) ? county : county + ' County';
    if (city) return city;
    return 'this area';
  }
  function feedWaiting(filter, feed, geomPending) {
    if (!feed) return true;
    if (feed.active === 'load' || feed.recent === 'load' || geomPending) return true;
    if ((filter === 'all' || filter === 'hail') && feed.swath === 'load') return true;
    return false;
  }
  function feedNote(filter, feed, missingGeom) {
    var notes = [];
    var nwsBad = feed && (feed.active === 'err' || feed.recent === 'err');
    var swBad = feed && feed.swath === 'err';
    if (nwsBad) notes.push('National Weather Service alerts: data unavailable.');
    if (swBad && (filter === 'all' || filter === 'hail')) notes.push('Radar hail areas: data unavailable.');
    if (missingGeom) notes.push('Some alerts had no map area: data unavailable.');
    return notes.join(' ');
  }
  function listMode(o) {
    if (o.inViewCount > 0) return 'cards';
    if (o.waiting) return 'loading';
    if (o.note) return 'unavailable';
    return 'empty';
  }
  function sortEvents(list) {
    return list.slice().sort(function (a, b) {
      if (!!a.live !== !!b.live) return a.live ? -1 : 1;
      var da = a._miles, db = b._miles;
      if (da == null) return 1;
      if (db == null) return -1;
      if (Math.abs(da - db) > 0.05) return da - db;
      return (b.when || 0) - (a.when || 0);
    });
  }
  function markerCat(ev, filter) {
    if (filter === 'hail' || filter === 'wind' || filter === 'tornado') return filter;
    if ((ev.cats || []).indexOf('tornado') >= 0) return 'tornado';
    if ((ev.cats || []).indexOf('hail') >= 0) return 'hail';
    return 'wind';
  }
  function boundsAt(center, zoom, size, project, unproject) {
    var p = project(center, zoom);
    var sw = unproject({ x: p.x - size.x / 2, y: p.y + size.y / 2 }, zoom);
    var ne = unproject({ x: p.x + size.x / 2, y: p.y - size.y / 2 }, zoom);
    return { w: sw.lng, s: sw.lat, e: ne.lng, n: ne.lat };
  }
  root.StormAlertLogic = {
    categorize: categorize, groupAlerts: groupAlerts, namedHail: namedHail, swathEvents: swathEvents,
    matches: matches, eventInView: eventInView, visibleEvents: visibleEvents, geomHits: geomHits,
    contains: contains, anchorOf: anchorOf, bboxOf: bboxOf, distToEvent: distToEvent, distText: distText,
    daysBetween: daysBetween, daysAgoLabel: daysAgoLabel, agoFromMs: agoFromMs, dateLabel: dateLabel,
    describeEvent: describeEvent, placeTitle: placeTitle, feedWaiting: feedWaiting, feedNote: feedNote,
    listMode: listMode, sortEvents: sortEvents, markerCat: markerCat, boundsAt: boundsAt, inches: inches,
    pointIn: pointIn, vtecParts: vtecParts
  };
})(typeof window !== 'undefined' ? window : this);

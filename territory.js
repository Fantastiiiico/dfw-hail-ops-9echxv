/* Varro Territory — phone map of a ZIP, city, or point plus a radius.
   Counts are never invented.
   Free parcel feeds (owner names are not requested and are not stored):
   - Collin CAD parcels via the City of Allen open feature service (certified market value,
     year built, legal acres, homestead exemption HS).
   - Dallas CAD ParcelPublishing (market value, year built, parcel-polygon area).
     Owner-occupied is not in that feed.
   - Tarrant County tax parcels (appraised value, year built, land acres).
     The exemption column in that feed is blank, so owner-occupied is data unavailable.
   - USA Structures residential footprints when the point is outside those three counties.
   - Census ACS 5-year tract stats at the center point, labeled as tract context.
   Roof or permit age is not in those feeds. A LandGlide export can be loaded on this
   phone only (localStorage). Owner names, phones, and emails are stripped before save
   and are never written into the knock-list CSV. */
(function () {
  var YEAR = new Date().getFullYear();
  var SAVE_KEY = 'varro_territories_v1';
  var LG_KEY = 'varro_landglide_v1';
  var STRUCT = 'https://services2.arcgis.com/FiaPA4ga0iQKduv3/ArcGIS/rest/services/USA_Structures_View/FeatureServer/0/query';
  var ROW_CAP = 1000;
  var PII = { owner: 1, ownername: 1, owner_name: 1, owneraddr: 1, owner_addr: 1, owneraddress: 1, phone: 1, email: 1, mail: 1, mailing: 1, contact: 1 };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[$,]/g, '')); return isFinite(n) ? n : null; }
  function sq(s) { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function milesM(mi) { return mi * 1609.344; }
  function havM(a, b, c, d) {
    var R = 6371000, x = Math.sin((c - a) * Math.PI / 360), y = Math.sin((d - b) * Math.PI / 360);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x * x + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * y * y)));
  }
  function clean(s) { return String(s == null ? '' : s).replace(/\r/g, '\n').split('\n')[0].replace(/\s+/g, ' ').trim(); }
  function fmt(n) { return n.toLocaleString('en-US'); }
  function blankFilters() { return { value: '', age: '', acres: '', occ: '', roof: '' }; }
  function anyFilter(f) { return !!(f.value || f.age || f.acres || f.occ || f.roof); }

  var SOURCES = [
    {
      id: 'collin', name: 'Collin CAD',
      detail: 'Collin Central Appraisal District parcels (City of Allen open data): certified market value, year built, legal acres, homestead exemption. Owner names are not requested.',
      url: 'https://gismaps.cityofallen.org/arcgis/rest/services/ReferenceData/Collin_County_Appraisal_District_Parcels/FeatureServer/1/query',
      value: 'GIS_DBO_AD_Entity_cert_market',
      year: 'GIS_DBO_AD_Entity_yr_blt',
      acresSql: function (a) { return 'GIS_DBO_AD_Entity_legal_acreage >= ' + a; },
      occ: "(GIS_DBO_AD_Entity_exemptions = 'HS' OR GIS_DBO_AD_Entity_exemptions LIKE 'HS,%' OR GIS_DBO_AD_Entity_exemptions LIKE '%,HS' OR GIS_DBO_AD_Entity_exemptions LIKE '%,HS,%')",
      outFields: 'GIS_DBO_AD_Entity_situs_display,GIS_DBO_AD_Entity_situs_city,GIS_DBO_AD_Entity_situs_zip,GIS_DBO_AD_Entity_yr_blt,GIS_DBO_AD_Entity_legal_acreage,GIS_DBO_AD_Entity_cert_market,GIS_DBO_AD_Entity_exemptions',
      row: function (a, c) {
        var ex = String(a.GIS_DBO_AD_Entity_exemptions || '');
        var hs = /(^|,)HS(,|$)/.test(ex.replace(/\s/g, ''));
        return baseRow(clean(a.GIS_DBO_AD_Entity_situs_display), clean(a.GIS_DBO_AD_Entity_situs_city), clean(a.GIS_DBO_AD_Entity_situs_zip), c, {
          value: num(a.GIS_DBO_AD_Entity_cert_market), year: yearOrNull(a.GIS_DBO_AD_Entity_yr_blt), acres: pos(a.GIS_DBO_AD_Entity_legal_acreage),
          ownerOcc: hs, source: 'Collin CAD'
        });
      }
    },
    {
      id: 'dallas', name: 'Dallas CAD',
      detail: 'Dallas Central Appraisal District ParcelPublishing: current market value and residential year built. Lot size is the parcel polygon area (square feet ÷ 43,560). Owner-occupied and roof age are not in this feed. Owner names are not requested.',
      url: 'https://maps.dcad.org/prdwa/rest/services/Property/ParcelQuery/MapServer/4/query',
      value: 'CNTASSDVAL',
      year: 'RESYRBLT',
      acresSql: function (a) { return 'Shape.STArea() >= ' + Math.round(a * 43560); },
      occ: null,
      outFields: 'SITEADDRESS,RESYRBLT,CNTASSDVAL',
      row: function (a, c) {
        return baseRow(clean(a.SITEADDRESS), '', '', c, {
          value: num(a.CNTASSDVAL), year: yearOrNull(a.RESYRBLT), acres: null, ownerOcc: null, source: 'Dallas CAD'
        });
      }
    },
    {
      id: 'tarrant', name: 'Tarrant CAD',
      detail: 'Tarrant County tax parcels (Tarrant Appraisal District): total appraised value, year built, and land acres. The exemption column in this public feed is blank, so owner-occupied is data unavailable. Roof age is not published. Owner names are not requested.',
      url: 'https://mapit.tarrantcounty.com/arcgis/rest/services/Tax/TCProperty/MapServer/0/query',
      value: 'TOTAL_VALU',
      year: 'YEAR_BUILT',
      acresSql: function (a) { return 'LAND_ACRES >= ' + a; },
      occ: null,
      outFields: 'SITUS_ADDR,CITY,ZIPCODE,YEAR_BUILT,LAND_ACRES,TOTAL_VALU',
      row: function (a, c) {
        return baseRow(clean(a.SITUS_ADDR), clean(a.CITY), clean(a.ZIPCODE), c, {
          value: num(a.TOTAL_VALU), year: yearOrNull(a.YEAR_BUILT), acres: pos(a.LAND_ACRES), ownerOcc: null, source: 'Tarrant CAD'
        });
      }
    }
  ];

  function yearOrNull(v) { var n = num(v); return n > 1800 && n <= YEAR ? Math.round(n) : null; }
  function pos(v) { var n = num(v); return n > 0 ? n : null; }
  function baseRow(address, city, zip, c, extra) {
    return {
      address: address, city: city, zip: zip,
      lat: c ? +c.y : null, lon: c ? +c.x : null,
      value: extra.value, year: extra.year, acres: extra.acres,
      ownerOcc: extra.ownerOcc, roofYear: null, permitYear: null, source: extra.source
    };
  }
  function whereFor(src, f) {
    var parts = ['1=1'], gaps = [];
    if (f.value) { if (!src.value) gaps.push('home value'); else parts.push(src.value + ' >= ' + (+f.value)); }
    if (f.age) {
      if (!src.year) gaps.push('home age');
      else parts.push(src.year + ' > 1800 AND ' + src.year + ' <= ' + (YEAR - (+f.age)));
    }
    if (f.acres) { if (!src.acresSql) gaps.push('lot size'); else parts.push(src.acresSql(+f.acres)); }
    if (f.occ === 'yes') { if (!src.occ) gaps.push('owner-occupied'); else parts.push('(' + src.occ + ')'); }
    if (f.roof) gaps.push('roof or permit age');
    return { where: parts.join(' AND '), gaps: gaps };
  }

  function arcParams(lat, lon, meters, extra) {
    var p = {
      f: 'json', geometry: lon + ',' + lat, geometryType: 'esriGeometryPoint', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', distance: String(Math.round(meters)), units: 'esriSRUnit_Meter'
    };
    Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
    return p;
  }
  function arcGet(url, params) {
    var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch(url + '?' + q).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (j.error) throw new Error(j.error.message || 'query failed');
      return j;
    });
  }
  function arcCount(url, lat, lon, meters, where) {
    return arcGet(url, arcParams(lat, lon, meters, { where: where || '1=1', returnCountOnly: 'true' })).then(function (j) {
      if (typeof j.count !== 'number') throw new Error('no count');
      return j.count;
    });
  }

  function piiKey(k) {
    var s = String(k || '').toLowerCase().replace(/[\s_-]/g, '');
    if (s === 'owneroccupied' || s === 'ownerocc') return false;
    return !!PII[s] || /ownername|owneraddr|phone|email/.test(s);
  }
  function boolOrNull(v) {
    if (v === true || v === false) return v;
    if (v == null || v === '') return null;
    var s = String(v).toLowerCase();
    if (s === 'yes' || s === 'y' || s === 'true' || s === '1' || s === 'owner' || s === 'owner-occupied') return true;
    if (s === 'no' || s === 'n' || s === 'false' || s === '0') return false;
    return null;
  }
  function lgRow(p) {
    var o = {};
    Object.keys(p || {}).forEach(function (k) { if (!piiKey(k)) o[k] = p[k]; });
    return {
      address: clean(o.address || o.street || o.situs || ''),
      city: clean(o.city || ''),
      zip: clean(o.zip || o.zipcode || ''),
      lat: num(o.lat), lon: num(o.lon),
      value: num(o.value != null ? o.value : (o.market_value != null ? o.market_value : o.marketValue)),
      year: yearOrNull(o.year_built != null ? o.year_built : (o.yearBuilt != null ? o.yearBuilt : o.yr_blt)),
      acres: pos(o.lot_acres != null ? o.lot_acres : (o.acres != null ? o.acres : o.lot_size_acres)),
      ownerOcc: boolOrNull(o.owner_occupied != null ? o.owner_occupied : o.ownerOccupied),
      roofYear: yearOrNull(o.roof_year != null ? o.roof_year : o.roofYear),
      permitYear: yearOrNull(o.permit_year != null ? o.permit_year : o.permitYear),
      source: 'LandGlide file on this phone'
    };
  }
  function lgLoad() { try { return JSON.parse(localStorage.getItem(LG_KEY) || 'null'); } catch (e) { return null; } }
  function lgSave(rows) { localStorage.setItem(LG_KEY, JSON.stringify({ loaded: Date.now(), rows: rows })); }
  function lgIn(rows, lat, lon, meters) {
    return (rows || []).filter(function (r) { return isFinite(r.lat) && isFinite(r.lon) && havM(lat, lon, r.lat, r.lon) <= meters + 1; });
  }
  function fileGaps(rows, f) {
    var g = [];
    if (f.value && !rows.some(function (r) { return r.value != null; })) g.push('home value');
    if (f.age && !rows.some(function (r) { return r.year > 1800; })) g.push('home age');
    if (f.acres && !rows.some(function (r) { return r.acres > 0; })) g.push('lot size');
    if (f.occ === 'yes' && !rows.some(function (r) { return r.ownerOcc === true || r.ownerOcc === false; })) g.push('owner-occupied');
    if (f.roof && !rows.some(function (r) { return r.roofYear > 1800 || r.permitYear > 1800; })) g.push('roof or permit age');
    return g;
  }
  function rowMatch(r, f) {
    if (f.value && !(r.value >= +f.value)) return false;
    if (f.age && !(r.year > 1800 && r.year <= YEAR - (+f.age))) return false;
    if (f.acres && !(r.acres >= +f.acres)) return false;
    if (f.occ === 'yes' && r.ownerOcc !== true) return false;
    if (f.roof) {
      var ry = r.roofYear || r.permitYear;
      if (!(ry > 1800 && ry <= YEAR - (+f.roof))) return false;
    }
    return true;
  }

  function acs(lat, lon) {
    return new Promise(function (res) {
      var cb = 'varroAcs' + Date.now() + Math.floor(Math.random() * 1000), s = document.createElement('script'), done = false;
      function fin(v) { if (done) return; done = true; try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); res(v); }
      window[cb] = function (j) {
        var t = ((((j || {}).result || {}).geographies || {})['Census Tracts'] || [])[0];
        if (!t || !t.TRACT) { fin(null); return; }
        var url = 'https://api.census.gov/data/2023/acs/acs5?get=NAME,B25001_001E,B25077_001E,B25035_001E,B25003_001E,B25003_002E&for=tract:' +
          encodeURIComponent(t.TRACT) + '&in=state:' + encodeURIComponent(t.STATE) + '%20county:' + encodeURIComponent(t.COUNTY);
        fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (rows) {
          if (!rows || rows.length < 2) { fin(null); return; }
          var h = rows[0], v = rows[1], o = { name: v[0] };
          h.forEach(function (k, i) { o[k] = v[i]; });
          fin(o);
        }).catch(function () { fin(null); });
      };
      s.onerror = function () { fin(null); };
      setTimeout(function () { fin(null); }, 8000);
      s.src = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=' + lon + '&y=' + lat +
        '&benchmark=Public_AR_Current&vintage=Current_Current&format=jsonp&callback=' + cb;
      document.head.appendChild(s);
    });
  }
  function acsNum(v) { var n = num(v); return n != null && n >= 0 ? n : null; }

  var CSS = '#trv{position:fixed;inset:0;z-index:1500;background:var(--bg,#F7F3EA);display:none;flex-direction:column}#trv.on{display:flex}' +
    '#trv .wh{position:sticky;top:0;z-index:2;background:rgba(255,255,255,.96);border-bottom:1px solid var(--ln,#e5e7eb);padding:calc(8px + env(safe-area-inset-top)) 12px 10px}' +
    '#trv .wt{display:flex;align-items:center;gap:8px}#trv .wt b{flex:1;font-size:18px;color:#0A2748}' +
    '#trv .bd{flex:1;overflow:auto;padding:12px 12px calc(var(--nav,64px) + env(safe-area-inset-bottom) + 16px)}' +
    '#trv label{display:block;font-size:12px;font-weight:700;color:#64748b;margin:8px 0 4px}' +
    '#trv input,#trv select{width:100%;box-sizing:border-box;min-height:48px;border:1px solid #e5e7eb;border-radius:12px;padding:0 12px;font-size:16px;background:#fff}' +
    '#trv .go{width:100%;min-height:48px;margin-top:10px;border:0;border-radius:12px;background:#0A2748;color:#fff;font-weight:800;font-size:16px}' +
    '#trv .go:disabled{opacity:.6}#trv .row2{display:flex;gap:8px}#trv .row2>*{flex:1}' +
    '#tr_mapw{height:32vh;min-height:200px;max-height:280px;border-radius:14px;overflow:hidden;margin:10px 0;border:1px solid #e5e7eb;background:#dde3ea}' +
    '#tr_map{height:100%;width:100%}' +
    '#trv .cd{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:12px;margin:10px 0}' +
    '#tr_count{font-size:34px;font-weight:800;color:#0A2748;line-height:1.1}#tr_count.na{font-size:22px}' +
    '#trv .mu{color:#64748b;font-size:13px;line-height:1.4}#trv h4{margin:0 0 6px;font-size:14px;color:#0A2748}' +
    '#trv .src{border-top:1px solid #f1f5f9;padding:8px 0;font-size:14px}#trv .src b{color:#0A2748}' +
    '#trv .alt{background:#F4EFE4;color:#0A2748}#trv .sug{display:none;background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin-top:6px;overflow:hidden}' +
    '#trv .sug button{display:block;width:100%;text-align:left;border:0;border-top:1px solid #f1f5f9;background:#fff;padding:10px 12px;font:inherit}' +
    '#trv .sug button:first-child{border-top:0}#trv .sug b{display:block}#trv .sug small{color:#64748b}' +
    '#tr_saved button{display:block;width:100%;text-align:left;margin-top:6px}';

  var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  var root = document.createElement('div'); root.id = 'trv'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Territory');
  root.innerHTML = '<div class="wh"><div class="wt"><b>Territory</b><button class="ic" type="button" id="tr_x" aria-label="Close">&times;</button></div></div>' +
    '<div class="bd"><p class="mu">Draw a circle from a ZIP, a city, or a point. The count is from public appraisal parcels when the county publishes them. Filters that the feed does not include stay on <b>data unavailable</b>.</p>' +
    '<form id="tr_f"><label for="tr_q">ZIP, city, or lat, lon</label><input id="tr_q" type="search" inputmode="search" enterkeyhint="search" placeholder="75098, Wylie, or 33.01, -96.54" autocomplete="off">' +
    '<div id="tr_sug" class="sug" role="listbox"></div>' +
    '<div class="row2"><div><label for="tr_mi">Radius</label><select id="tr_mi"><option value="0.5">0.5 mi</option><option value="1" selected>1 mi</option><option value="2">2 mi</option><option value="3">3 mi</option><option value="5">5 mi</option><option value="10">10 mi</option></select></div>' +
    '<div><label for="tr_name">Save as</label><input id="tr_name" type="text" placeholder="Wylie 1 mi" maxlength="80"></div></div>' +
    '<button class="go" id="tr_go" type="submit">Map it</button></form>' +
    '<div id="tr_mapw"><div id="tr_map"></div></div>' +
    '<div class="cd"><div id="tr_count" class="na">Map a territory</div><div class="mu" id="tr_sub">No count yet.</div><div id="tr_lines"></div></div>' +
    '<div class="cd"><h4>Filters</h4><p class="mu">Each filter stacks. The count changes only when the data can answer it.</p>' +
    '<label for="tr_val">Home value</label><select id="tr_val"><option value="">Any</option><option value="200000">$200k+</option><option value="300000">$300k+</option><option value="400000">$400k+</option><option value="500000">$500k+</option></select>' +
    '<label for="tr_age">Home age</label><select id="tr_age"><option value="">Any</option><option value="10">10+ years</option><option value="20">20+ years</option><option value="30">30+ years</option><option value="40">40+ years</option></select>' +
    '<label for="tr_ac">Lot size</label><select id="tr_ac"><option value="">Any</option><option value="0.25">0.25+ acres</option><option value="0.5">0.5+ acres</option><option value="1">1+ acres</option></select>' +
    '<label for="tr_occ">Owner-occupied</label><select id="tr_occ"><option value="">Any</option><option value="yes">Owner-occupied (homestead)</option></select>' +
    '<label for="tr_roof">Roof or permit age</label><select id="tr_roof"><option value="">Any</option><option value="15">15+ years</option><option value="20">20+ years</option></select>' +
    '<p class="mu" id="tr_roofnote">Roof and permit age are not in the free county feeds. They count only from a LandGlide file loaded on this phone.</p></div>' +
    '<div class="cd"><h4>Census context</h4><div class="mu" id="tr_acs">Map a territory to load the Census tract at the center. This is an area statistic, not a property count.</div></div>' +
    '<div class="row2"><button class="go alt" type="button" id="tr_save">Save territory</button><button class="go" type="button" id="tr_csv">Export knock list</button></div>' +
    '<p class="mu" id="tr_expnote"></p>' +
    '<div class="cd"><h4>LandGlide file</h4><p class="mu">Optional. Stays on this phone. JSON with a <b>rows</b> array: address, city, zip, lat, lon, value, year_built, lot_acres, owner_occupied, roof_year, permit_year. Owner names, phones, and emails are dropped and are never exported.</p>' +
    '<input id="tr_file" type="file" accept=".json,application/json"><p class="mu" id="tr_lg"></p><button class="go alt" type="button" id="tr_lgclear">Remove LandGlide file</button></div>' +
    '<div class="cd"><h4>Saved on this phone</h4><div id="tr_saved"></div></div>' +
    '<p class="mu">Feeds: Collin CAD, Dallas CAD, Tarrant CAD, USA Structures residential footprints, Census ACS 2023 5-year. Other counties: data unavailable for parcel filters until a LandGlide file is loaded.</p></div>';
  document.body.appendChild(root);

  var $ = function (i) { return document.getElementById(i); };
  var map = null, circle = null, dots = null, seq = 0;
  var state = { center: null, label: '', miles: 1, filters: blankFilters(), hits: [], struct: null, acs: null, plan: null, filtered: null, rows: null, lg: lgLoad() };

  function filtersFromUi() {
    return { value: $('tr_val').value, age: $('tr_age').value, acres: $('tr_ac').value, occ: $('tr_occ').value, roof: $('tr_roof').value };
  }
  function setMsg(countHtml, sub, lines) {
    var el = $('tr_count');
    el.innerHTML = countHtml;
    el.classList.toggle('na', /unavailable|Map a/i.test(countHtml.replace(/<[^>]+>/g, '')));
    $('tr_sub').innerHTML = sub || '';
    $('tr_lines').innerHTML = lines || '';
  }
  function lgNote() {
    var d = state.lg;
    $('tr_lg').textContent = d && d.rows ? (d.rows.length + ' LandGlide rows on this phone. Owner names are not stored.') : 'No LandGlide file on this phone.';
  }
  function savedList() {
    var L = []; try { L = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); } catch (e) { L = []; }
    $('tr_saved').innerHTML = L.length ? L.map(function (s, i) {
      return '<button type="button" class="go alt" data-i="' + i + '"><b>' + esc(s.name) + '</b><span class="mu" style="display:block">' + esc(s.summary || '') + '</span></button>';
    }).join('') : '<p class="mu">None saved yet.</p>';
    $('tr_saved').querySelectorAll('[data-i]').forEach(function (b) {
      b.onclick = function () { var s = L[+b.dataset.i]; if (!s) return; $('tr_q').value = s.query || ''; $('tr_mi').value = String(s.miles || 1); $('tr_name').value = s.name || '';
        $('tr_val').value = (s.filters && s.filters.value) || ''; $('tr_age').value = (s.filters && s.filters.age) || ''; $('tr_ac').value = (s.filters && s.filters.acres) || '';
        $('tr_occ').value = (s.filters && s.filters.occ) || ''; $('tr_roof').value = (s.filters && s.filters.roof) || ''; mapIt(); };
    });
  }

  function ensureMap() {
    if (map || !window.L) return !!map;
    map = L.map('tr_map', { zoomControl: false, minZoom: 4, attributionControl: true }).setView([33.015, -96.539], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    dots = L.layerGroup().addTo(map);
    map.on('click', function (e) {
      $('tr_q').value = e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5);
      mapIt();
    });
    return true;
  }
  function draw(lat, lon, meters) {
    if (!ensureMap()) return;
    if (circle) map.removeLayer(circle);
    dots.clearLayers();
    circle = L.circle([lat, lon], { radius: meters, color: '#0A2748', weight: 2, fillColor: '#B78A2A', fillOpacity: 0.18 }).addTo(map);
    map.fitBounds(circle.getBounds(), { padding: [16, 16] });
  }
  function plot(rows) {
    if (!map || !dots) return;
    dots.clearLayers();
    (rows || []).forEach(function (r) {
      if (!isFinite(r.lat) || !isFinite(r.lon)) return;
      L.circleMarker([r.lat, r.lon], { radius: 4, color: '#0A2748', weight: 1, fillColor: '#B78A2A', fillOpacity: 0.9 })
        .bindPopup('<b>' + esc(r.address || 'Parcel') + '</b><br>' + esc([r.city, r.zip].filter(Boolean).join(' ')) + '<br>' + esc(r.source)).addTo(dots);
    });
  }

  function resolve(q) {
    var m = String(q).trim().match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (m) return Promise.resolve({ lat: +m[1], lon: +m[2], label: q.trim() });
    if (!(window.AddrSearch && AddrSearch.searchAll)) return Promise.reject(new Error('Search is not ready'));
    return AddrSearch.searchAll(q).then(function (r) {
      if (!r || !r.length) throw new Error('No Texas match for "' + q + '"');
      return { lat: r[0].lat, lon: r[0].lon, label: r[0].label };
    });
  }

  function baseCounts(lat, lon, meters) {
    return Promise.all(SOURCES.map(function (src) {
      return arcCount(src.url, lat, lon, meters, '1=1').then(function (n) { return { source: src, ok: true, count: n }; }, function (e) { return { source: src, ok: false, error: e.message || 'failed' }; });
    })).then(function (hits) {
      return arcCount(STRUCT, lat, lon, meters, "OCC_CLS='Residential'").then(function (n) { return { hits: hits, struct: { ok: true, count: n } }; }, function (e) { return { hits: hits, struct: { ok: false, error: e.message || 'failed' } }; });
    });
  }

  function countyFiltered(lat, lon, meters, filters, hits) {
    var present = hits.filter(function (h) { return h.ok && h.count > 0; });
    if (!present.length) return Promise.resolve({ mode: 'none', parts: [] });
    var parts = present.map(function (h) { var w = whereFor(h.source, filters); return { hit: h, where: w.where, gaps: w.gaps }; });
    var gaps = [];
    parts.forEach(function (p) { p.gaps.forEach(function (g) { if (gaps.indexOf(g) < 0) gaps.push(g); }); });
    if (gaps.length) {
      return Promise.all(parts.map(function (p) {
        if (p.gaps.length) return Promise.resolve(Object.assign({ count: null }, p));
        return arcCount(p.hit.source.url, lat, lon, meters, p.where).then(function (n) { return Object.assign({ count: n }, p); }, function () { return Object.assign({ count: null, failed: true }, p); });
      })).then(function (done) { return { mode: 'gap', gaps: gaps, parts: done }; });
    }
    return Promise.all(parts.map(function (p) {
      return arcCount(p.hit.source.url, lat, lon, meters, p.where).then(function (n) { return Object.assign({ count: n }, p); }, function (e) { return Object.assign({ count: null, failed: true, error: e.message }, p); });
    })).then(function (done) {
      if (done.some(function (p) { return p.count == null; })) return { mode: 'gap', gaps: ['a county feed did not answer'], parts: done };
      return { mode: 'county', parts: done, total: done.reduce(function (s, p) { return s + p.count; }, 0) };
    });
  }

  function lgFiltered(lat, lon, meters, filters) {
    var file = state.lg && state.lg.rows ? state.lg.rows : [];
    var inside = lgIn(file, lat, lon, meters);
    if (!file.length) return { mode: 'none', inside: [], match: [] };
    var gaps = fileGaps(inside.length ? inside : file, filters);
    if (anyFilter(filters) && gaps.length) return { mode: 'gap', gaps: gaps, inside: inside, match: [] };
    var match = inside.filter(function (r) { return rowMatch(r, filters); });
    return { mode: 'file', inside: inside, match: match };
  }

  function render(my) {
    if (my != null && my !== seq) return;
    var f = state.filters, lines = '', sub = '', big = 'Data unavailable';
    var present = state.hits.filter(function (h) { return h.ok && h.count > 0; });
    var errored = state.hits.filter(function (h) { return !h.ok; });
    state.hits.forEach(function (h) {
      if (!h.ok) lines += '<div class="src"><b>' + esc(h.source.name) + '</b><div class="mu">Data unavailable (' + esc(h.error) + ').</div></div>';
      else if (h.count > 0) lines += '<div class="src"><b>' + esc(h.source.name) + '</b> · ' + fmt(h.count) + ' parcels in the circle<div class="mu">' + esc(h.source.detail) + '</div></div>';
    });
    if (state.struct && state.struct.ok) lines += '<div class="src"><b>Residential footprints</b> · ' + fmt(state.struct.count) + '<div class="mu">USA Structures (FEMA / ORNL). Building outlines, not appraisal parcels, value, age, or occupancy.</div></div>';
    else if (state.struct) lines += '<div class="src"><b>Residential footprints</b><div class="mu">Data unavailable (' + esc(state.struct.error) + ').</div></div>';

    var lg = lgFiltered(state.center.lat, state.center.lon, milesM(state.miles), f);
    var plan = state.plan;
    if (!anyFilter(f)) {
      if (present.length) {
        var sum = present.reduce(function (s, h) { return s + h.count; }, 0);
        big = fmt(sum);
        sub = 'Appraisal parcels inside ' + state.miles + ' mi of ' + esc(state.label) + '. ' + present.map(function (h) { return h.source.name; }).join(' + ') + '.';
        state.exportMode = 'county';
      } else if (state.struct && state.struct.ok) {
        big = fmt(state.struct.count);
        sub = 'Residential building footprints inside the circle. Parcel value, age, lot size, and owner-occupied are data unavailable for this spot — Collin, Dallas, and Tarrant returned no parcels' + (errored.length ? ' (a feed also failed)' : '') + '.';
        state.exportMode = 'none';
      } else {
        big = 'Data unavailable';
        sub = 'No parcel feed and no footprint count returned for this circle.';
        state.exportMode = 'none';
      }
    } else if (plan && plan.mode === 'county') {
      big = fmt(plan.total);
      sub = 'Parcels matching every filter. ' + plan.parts.map(function (p) { return p.hit.source.name + ' ' + fmt(p.count); }).join(' · ') + '.';
      lines += plan.parts.map(function (p) { return '<div class="src"><b>' + esc(p.hit.source.name) + ' filtered</b> · ' + fmt(p.count) + '</div>'; }).join('');
      state.exportMode = 'county';
    } else if (plan && plan.mode === 'gap') {
      big = 'Data unavailable';
      sub = 'Stacked count needs ' + esc(plan.gaps.join(', ')) + ' from every county that has parcels in this circle. That field is not in at least one of those feeds, so the combined number is not shown.';
      if (plan.parts) lines += plan.parts.map(function (p) {
        if (p.gaps && p.gaps.length) return '<div class="src"><b>' + esc(p.hit.source.name) + '</b><div class="mu">Data unavailable for ' + esc(p.gaps.join(', ')) + '.</div></div>';
        if (p.count == null) return '<div class="src"><b>' + esc(p.hit.source.name) + '</b><div class="mu">Data unavailable (the feed did not answer).</div></div>';
        return '<div class="src"><b>' + esc(p.hit.source.name) + ' with the filters it can answer</b> · ' + fmt(p.count) + '<div class="mu">Not included in a combined total.</div></div>';
      }).join('');
      state.exportMode = 'none';
    } else if (!present.length) {
      big = 'Data unavailable';
      sub = 'Parcel filters need a county feed or a LandGlide file. This circle has no Collin, Dallas, or Tarrant parcels' + (state.struct && state.struct.ok ? '. Footprints above are not filtered.' : '.');
      state.exportMode = 'none';
    }

    if (f.roof || (plan && plan.mode === 'gap' && lg.mode === 'file')) {
      if (lg.mode === 'file') {
        big = fmt(lg.match.length);
        sub = 'LandGlide file on this phone: ' + fmt(lg.match.length) + ' of ' + fmt(lg.inside.length) + ' rows inside the circle match. This is not every property in the circle.';
        state.exportMode = 'lg';
        state.lgMatch = lg.match;
      } else if (lg.mode === 'gap') {
        if (!(plan && plan.mode === 'county')) {
          big = 'Data unavailable';
          sub = 'LandGlide file is missing ' + esc(lg.gaps.join(', ')) + ' on the rows in this circle.';
          state.exportMode = 'none';
        }
      } else if (f.roof && !(plan && plan.mode === 'county' && plan.gaps && plan.gaps.length)) {
        big = 'Data unavailable';
        sub = 'Roof or permit age is not in the free county feeds. Load a LandGlide file that includes roof_year or permit_year.';
        state.exportMode = f.roof ? 'none' : state.exportMode;
      }
    } else if (lg.mode === 'file' && !anyFilter(f)) {
      lines += '<div class="src"><b>LandGlide file</b> · ' + fmt(lg.inside.length) + ' rows inside the circle<div class="mu">On this phone only. Not added into the county total.</div></div>';
    } else if (lg.mode === 'file') {
      lines += '<div class="src"><b>LandGlide file, same filters</b> · ' + fmt(lg.match.length) + ' of ' + fmt(lg.inside.length) + '<div class="mu">Separate from the county count.</div></div>';
    } else if (lg.mode === 'gap' && state.lg && state.lg.rows) {
      lines += '<div class="src"><b>LandGlide file</b><div class="mu">Data unavailable for ' + esc(lg.gaps.join(', ')) + '.</div></div>';
    }
    if (f.roof && state.exportMode === 'county') {
      big = 'Data unavailable';
      sub = 'Roof or permit age is not in the county feeds, so the stacked county count is not shown.';
      state.exportMode = lg.mode === 'file' ? 'lg' : 'none';
      if (lg.mode === 'file') { big = fmt(lg.match.length); sub = 'LandGlide file on this phone: ' + fmt(lg.match.length) + ' rows match, including roof or permit age. County parcels are not in this number.'; state.lgMatch = lg.match; }
    }

    setMsg(big, sub, lines);
    $('tr_expnote').textContent = state.exportMode === 'none' ? 'Knock list stays off while the filtered count is data unavailable.' : 'CSV is addresses and the fields the feed actually has. No owner names, phones, or emails.';
    $('tr_csv').disabled = state.exportMode === 'none';
    state.big = big;
  }

  function mapIt() {
    var q = $('tr_q').value.trim();
    if (!q) return;
    var my = ++seq;
    state.miles = +$('tr_mi').value || 1;
    state.filters = filtersFromUi();
    state.rows = null;
    $('tr_go').disabled = true;
    setMsg('Looking up…', 'Finding the point, then asking the county feeds.', '');
    $('tr_acs').textContent = 'Loading Census tract context…';
    resolve(q).then(function (c) {
      if (my !== seq) return;
      if (c.lat < 25 || c.lat > 37 || c.lon < -107 || c.lon > -93) throw new Error('That point is outside Texas');
      state.center = c; state.label = c.label;
      if (!$('tr_name').value.trim()) $('tr_name').value = c.label.split(',')[0] + ' ' + state.miles + ' mi';
      draw(c.lat, c.lon, milesM(state.miles));
      return baseCounts(c.lat, c.lon, milesM(state.miles));
    }).then(function (pack) {
      if (my !== seq || !pack) return;
      state.hits = pack.hits; state.struct = pack.struct;
      return countyFiltered(state.center.lat, state.center.lon, milesM(state.miles), state.filters, state.hits);
    }).then(function (plan) {
      if (my !== seq || !plan) return;
      state.plan = plan;
      render(my);
      $('tr_go').disabled = false;
      acs(state.center.lat, state.center.lon).then(function (a) { if (my !== seq) return; showAcs(a); });
      maybeDots(my);
    }).catch(function (e) {
      if (my !== seq) return;
      $('tr_go').disabled = false;
      setMsg('Data unavailable', esc(e.message || 'Lookup failed') + '. Nothing was counted.', '');
    });
  }

  function showAcs(a) {
    if (!a) { $('tr_acs').textContent = 'Census context: data unavailable for this point.'; return; }
    var units = acsNum(a.B25001_001E), val = acsNum(a.B25077_001E), yr = acsNum(a.B25035_001E), occ = acsNum(a.B25003_001E), own = acsNum(a.B25003_002E);
    var bits = ['<b>' + esc(a.name || 'Census tract') + '</b> (ACS 2023 5-year, tract at the center — not a count of parcels in the circle).'];
    bits.push(units == null ? 'Housing units: data unavailable.' : ('Housing units in the tract: ' + fmt(units) + '.'));
    bits.push(val == null ? 'Median home value: data unavailable.' : ('Median home value: $' + fmt(val) + '.'));
    bits.push(yr == null ? 'Median year built: data unavailable.' : ('Median year built: ' + Math.round(yr) + '.'));
    bits.push(occ && own != null ? ('Owner-occupied: ' + Math.round(own / occ * 100) + '% of occupied units.') : 'Owner-occupied share: data unavailable.');
    $('tr_acs').innerHTML = bits.join(' ');
  }

  function refreshFilters() {
    if (!state.center) return;
    var my = ++seq;
    state.filters = filtersFromUi();
    state.rows = null;
    state.miles = +$('tr_mi').value || state.miles;
    setMsg('Updating…', 'Asking the feeds again with these filters.', '');
    countyFiltered(state.center.lat, state.center.lon, milesM(state.miles), state.filters, state.hits).then(function (plan) {
      if (my !== seq) return;
      state.plan = plan;
      render(my);
      maybeDots(my);
    }).catch(function () { if (my === seq) render(my); });
  }

  function centroidOf(g) {
    var ring = g && g.rings && g.rings[0];
    if (!ring || !ring.length) return null;
    var x = 0, y = 0;
    ring.forEach(function (p) { x += p[0]; y += p[1]; });
    return { x: x / ring.length, y: y / ring.length };
  }
  function fetchSource(src, lat, lon, meters, where) {
    var out = [], offset = 0;
    function page() {
      if (out.length >= ROW_CAP) return Promise.resolve(out.slice(0, ROW_CAP));
      return arcGet(src.url, arcParams(lat, lon, meters, {
        where: where, outFields: src.outFields, returnGeometry: 'false', returnCentroid: 'true', outSR: '4326',
        resultOffset: String(offset), resultRecordCount: '200'
      })).then(function (j) {
        var feats = j.features || [];
        if (!feats.length) return out;
        var needGeom = feats.some(function (f) { return !f.centroid; });
        var geomP = needGeom ? arcGet(src.url, arcParams(lat, lon, meters, {
          where: where, outFields: src.outFields, returnGeometry: 'true', outSR: '4326', geometryPrecision: '5',
          resultOffset: String(offset), resultRecordCount: '200'
        })).then(function (g) { return g.features || []; }).catch(function () { return []; }) : Promise.resolve([]);
        return geomP.then(function (geoms) {
          feats.forEach(function (f, i) {
            var c = f.centroid || (geoms[i] && centroidOf(geoms[i].geometry));
            out.push(src.row(f.attributes || {}, c));
          });
          offset += feats.length;
          if (feats.length < 200 || out.length >= ROW_CAP) return out.slice(0, ROW_CAP);
          return page();
        });
      });
    }
    return page();
  }

  function maybeDots(my) {
    if (state.exportMode !== 'county' || !state.plan || state.plan.mode !== 'county' && anyFilter(state.filters)) return;
    if (state.plan.mode === 'county' && state.plan.total > 400) return;
    var jobs = (state.plan.parts || []).filter(function (p) { return p.count > 0 && p.count <= 400; });
    if (!anyFilter(state.filters)) {
      jobs = state.hits.filter(function (h) { return h.ok && h.count > 0 && h.count <= 400; }).map(function (h) { return { hit: h, where: '1=1' }; });
    }
    Promise.all(jobs.map(function (p) { return fetchSource(p.hit.source, state.center.lat, state.center.lon, milesM(state.miles), p.where); }))
      .then(function (groups) { if (my !== seq) return; plot([].concat.apply([], groups)); })
      .catch(function () {});
  }

  function exportList() {
    if (!state.center || state.exportMode === 'none') return;
    $('tr_csv').disabled = true;
    $('tr_expnote').textContent = 'Building the knock list…';
    var done = function (rows, note) {
      state.rows = rows;
      var capped = rows.length >= ROW_CAP;
      var head = ['address', 'city', 'zip', 'lat', 'lon', 'market_value', 'year_built', 'lot_acres', 'owner_occupied', 'roof_year', 'permit_year', 'source'];
      var body = rows.map(function (r) {
        return [r.address, r.city, r.zip, r.lat == null ? '' : r.lat.toFixed(6), r.lon == null ? '' : r.lon.toFixed(6),
          r.value == null ? '' : Math.round(r.value), r.year == null ? '' : r.year, r.acres == null ? '' : r.acres,
          r.ownerOcc == null ? '' : (r.ownerOcc ? 'yes' : 'no'), r.roofYear == null ? '' : r.roofYear, r.permitYear == null ? '' : r.permitYear, r.source];
      });
      var csv = [head].concat(body).map(function (a) { return a.map(sq).join(','); }).join('\n');
      var name = 'varro-territory-' + (state.label || 'list').replace(/[^\w]+/g, '-').slice(0, 40) + '.csv';
      if (window.FVshare) window.FVshare(name, 'text/csv', csv);
      else {
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click();
      }
      plot(rows.filter(function (r) { return isFinite(r.lat); }).slice(0, 400));
      $('tr_csv').disabled = false;
      $('tr_expnote').textContent = rows.length + ' rows exported. ' + (capped ? 'The list is capped at ' + ROW_CAP + ' so the phone stays usable. The count above is the full feed total. ' : '') + (note || '') + 'No owner names, phones, or emails.';
    };
    if (state.exportMode === 'lg') { done(state.lgMatch || [], 'Source: LandGlide file on this phone.'); return; }
    var parts = state.plan && state.plan.parts ? state.plan.parts : state.hits.filter(function (h) { return h.ok && h.count > 0; }).map(function (h) { return { hit: h, where: '1=1' }; });
    Promise.all(parts.map(function (p) { return fetchSource(p.hit.source, state.center.lat, state.center.lon, milesM(state.miles), p.where); }))
      .then(function (groups) { done([].concat.apply([], groups), 'Source: ' + parts.map(function (p) { return p.hit.source.name; }).join(', ') + '.'); })
      .catch(function (e) { $('tr_csv').disabled = false; $('tr_expnote').textContent = 'Knock list: data unavailable (' + (e.message || 'the feed did not answer') + ').'; });
  }

  function saveTerr() {
    if (!state.center) { $('tr_expnote').textContent = 'Map a territory before saving.'; return; }
    var rec = {
      id: Date.now(), name: $('tr_name').value.trim() || state.label, query: $('tr_q').value.trim(),
      lat: state.center.lat, lon: state.center.lon, miles: state.miles, filters: state.filters,
      summary: state.big + ' · ' + state.miles + ' mi · ' + new Date().toLocaleDateString('en-US'), savedAt: Date.now()
    };
    var L = []; try { L = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); } catch (e) { L = []; }
    L.unshift(rec); L = L.slice(0, 30);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(L)); } catch (e) { $('tr_expnote').textContent = 'This phone is out of space. Export the list, then remove an old territory.'; return; }
    savedList();
    $('tr_expnote').textContent = 'Saved on this phone. The parcel list is not stored — Map it again to refresh the count.';
  }

  var sugN = 0, sugT = null;
  $('tr_q').addEventListener('input', function () {
    var q = this.value.trim(), box = $('tr_sug'), my = ++sugN;
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
          b.onclick = function () { sugN++; box.style.display = 'none'; $('tr_q').value = x.label; mapIt(); };
          box.appendChild(b);
        });
        box.style.display = 'block';
      }).catch(function () { if (my === sugN) box.style.display = 'none'; });
    }, 280);
  });
  $('tr_f').onsubmit = function (e) { e.preventDefault(); sugN++; $('tr_sug').style.display = 'none'; mapIt(); };
  ['tr_val', 'tr_age', 'tr_ac', 'tr_occ', 'tr_roof'].forEach(function (id) { $(id).onchange = function () { refreshFilters(); }; });
  $('tr_mi').onchange = function () { if (state.center) mapIt(); };
  $('tr_csv').onclick = exportList;
  $('tr_save').onclick = saveTerr;
  $('tr_file').onchange = function () {
    var f = this.files && this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var j = JSON.parse(rd.result);
        var raw = j.rows || j.props || (Array.isArray(j) ? j : null);
        if (!raw) throw new Error('Use a JSON object with a rows array');
        var rows = raw.map(lgRow).filter(function (r) { return isFinite(r.lat) && isFinite(r.lon); });
        if (!rows.length) throw new Error('No rows with lat and lon');
        lgSave(rows); state.lg = lgLoad(); lgNote();
        $('tr_expnote').textContent = rows.length + ' rows kept on this phone. Owner names, phones, and emails were not stored.';
        if (state.center) refreshFilters();
      } catch (e) { $('tr_lg').textContent = 'Could not load: ' + e.message; }
    };
    rd.readAsText(f); this.value = '';
  };
  $('tr_lgclear').onclick = function () {
    localStorage.removeItem(LG_KEY); state.lg = null; lgNote();
    if (state.center) refreshFilters();
  };

  function open() {
    root.classList.add('on'); document.body.style.overflow = 'hidden';
    if (window.FVmark) FVmark('terr');
    (function w(i) { if (ensureMap()) { map.invalidateSize(); } else if (i < 40) setTimeout(function () { w(i + 1); }, 200); })(0);
    lgNote(); savedList();
  }
  function close() { root.classList.remove('on'); document.body.style.overflow = ''; }
  $('tr_x').onclick = function () { close(); if (window.FVnav) FVnav('map'); };
  window.TRV = { open: open, close: close };
})();

/* Node checks for storm alert card rules. Run: node storm-alerts-logic.test.js */
var assert = require('assert');
global.window = global;
require('./storm-alerts-logic.js');
var L = global.StormAlertLogic;

function feat(p, geom) {
  return { type: 'Feature', geometry: geom || null, properties: p };
}
var square = { type: 'Polygon', coordinates: [[[-97.2, 32.6], [-96.6, 32.6], [-96.6, 33.1], [-97.2, 33.1], [-97.2, 32.6]]] };

var svr = L.categorize({
  event: 'Severe Thunderstorm Warning',
  headline: 'Severe Thunderstorm Warning issued November 3 at 11:25AM CST',
  parameters: { maxWindGust: ['60 MPH'], hailThreat: ['RADAR INDICATED'], windThreat: ['RADAR INDICATED'], maxHailSize: ['0.00'] }
});
assert.deepStrictEqual(svr.cats.slice().sort(), ['hail', 'thunderstorm', 'wind']);
assert.strictEqual(svr.kind, 'thunderstorm');
assert.strictEqual(svr.hailSize, null);
assert.strictEqual(svr.windGust, '60 MPH');

var tor = L.categorize({ event: 'Tornado Warning', headline: 'Tornado Warning issued November 3', parameters: {} });
assert.deepStrictEqual(tor.cats, ['tornado']);
assert.strictEqual(tor.kind, 'tornado');

var wind = L.categorize({ event: 'Wind Advisory', headline: 'Wind Advisory issued November 3', parameters: {} });
assert.deepStrictEqual(wind.cats, ['wind']);
assert.strictEqual(wind.kind, 'wind');

var frost = L.categorize({ event: 'Frost Advisory', headline: 'Frost Advisory', parameters: {} });
assert.deepStrictEqual(frost.cats, []);

var now = Date.parse('2026-11-06T18:00:00Z');
var grouped = L.groupAlerts([
  feat({
    id: 'cancel-1', event: 'Severe Thunderstorm Warning', messageType: 'Cancel', status: 'Actual',
    headline: 'The Severe Thunderstorm Warning has been cancelled.',
    sent: '2026-11-03T17:40:00Z', ends: '2026-11-03T18:00:00Z', areaDesc: 'Panola, TX',
    parameters: { VTEC: ['/O.CAN.KSHV.SV.W.0302.000000T0000Z-261103T1800Z/'], maxWindGust: ['60 MPH'], windThreat: ['RADAR INDICATED'] }
  }, square),
  feat({
    id: 'update-1', event: 'Severe Thunderstorm Warning', messageType: 'Update', status: 'Actual',
    headline: 'Severe Thunderstorm Warning issued November 3 at 11:25AM CST until November 3 at 12:00PM CST by NWS Shreveport LA',
    sent: '2026-11-03T17:25:00Z', ends: '2026-11-03T18:00:00Z', areaDesc: 'Panola, TX',
    parameters: { VTEC: ['/O.CON.KSHV.SV.W.0302.000000T0000Z-261103T1800Z/'], maxWindGust: ['60 MPH'], hailThreat: ['RADAR INDICATED'], windThreat: ['RADAR INDICATED'] }
  }, square)
], now);
assert.strictEqual(grouped.length, 1);
assert.strictEqual(grouped[0].status, 'closed');
assert.ok(/Severe Thunderstorm Warning issued/.test(grouped[0].headline));
assert.ok(/cancelled/.test(grouped[0].headline));
assert.strictEqual(grouped[0].title, 'Severe Thunderstorm Warning in Panola, TX');
assert.ok(grouped[0].cats.indexOf('hail') >= 0 && grouped[0].cats.indexOf('wind') >= 0);

var live = L.groupAlerts([
  feat({
    id: 'live-tor', event: 'Tornado Watch', messageType: 'Alert', status: 'Actual',
    headline: 'Tornado Watch issued until later today',
    sent: '2026-11-06T16:00:00Z', ends: '2026-11-06T22:00:00Z', areaDesc: 'Hood, TX',
    parameters: { VTEC: ['/O.NEW.KFWD.TO.A.0001.000000T0000Z-261107T0000Z/'] }
  }, square)
], now);
assert.strictEqual(live.length, 1);
assert.strictEqual(live[0].status, 'live');
assert.strictEqual(live[0].live, true);

var testSkip = L.groupAlerts([
  feat({ id: 't', event: 'Tornado Warning', status: 'Test', headline: 'Test', sent: '2026-11-06T16:00:00Z', ends: '2026-11-06T22:00:00Z', parameters: {} })
], now);
assert.strictEqual(testSkip.length, 0);

var named = L.namedHail([{ d: '2026-04-27', lat: 32.89, lon: -96.41, nm: 'Rockwall / Dallas', gm: 2.75 }], 'ar');
assert.strictEqual(named[0].title, 'Hail · Rockwall / Dallas');
assert.strictEqual(named[0].kind, 'hail');
assert.strictEqual(named[0].inches, '2.75"');
assert.strictEqual(named[0].status, 'closed');
assert.ok(/Largest hail on file: 2.75"/.test(L.describeEvent(named[0])));

var boxIn = { w: -96.7, s: 32.7, e: -96.3, n: 33.0 };
var boxOut = { w: -100.2, s: 29.2, e: -99.6, n: 29.8 };
assert.strictEqual(L.eventInView(named[0], boxIn), true);
assert.strictEqual(L.eventInView(named[0], boxOut), false);
assert.strictEqual(L.eventInView(live[0], boxIn), true);

var sw = L.swathEvents({ d: { '2026-04-27': [1, square], '2026-05-01': [1, { type: 'Polygon', coordinates: [[[-100.2, 29.2], [-99.6, 29.2], [-99.6, 29.8], [-100.2, 29.8], [-100.2, 29.2]]] }] } });
var vis = L.visibleEvents(named, sw, [], 'hail', boxIn);
assert.ok(vis.some(function (e) { return e.source === 'hail-area'; }));
assert.ok(!vis.some(function (e) { return e.id === 'swath:2026-04-27'; }));
assert.ok(!vis.some(function (e) { return e.id === 'swath:2026-05-01'; }));
var visFar = L.visibleEvents(named, sw, [], 'hail', boxOut);
assert.strictEqual(visFar.length, 1);
assert.strictEqual(visFar[0].id, 'swath:2026-05-01');
assert.ok(/Radar saw 1"\+ hail/.test(L.describeEvent(visFar[0])));

assert.strictEqual(L.placeTitle({ city: 'Wylie', county: 'Collin', state: 'Texas' }, { w: -96.6, s: 32.95, e: -96.45, n: 33.08 }), 'Wylie');
assert.strictEqual(L.placeTitle({ city: 'McKinney', county: 'Collin', state: 'Texas' }, { w: -97.1, s: 32.7, e: -96.2, n: 33.4 }), 'Collin County');
assert.strictEqual(L.placeTitle({ city: 'Dallas', county: 'Dallas', state: 'Texas' }, { w: -98.4, s: 31.6, e: -95.8, n: 33.7 }), 'this area');
assert.strictEqual(L.placeTitle({ city: 'Durant', county: 'Bryan', state: 'Oklahoma' }, { w: -96.5, s: 33.9, e: -96.3, n: 34.05 }), 'this area');
assert.strictEqual(L.placeTitle(null, boxIn), 'this area');

var inside = L.distToEvent(live[0], { lat: 32.9, lon: -96.9 });
assert.strictEqual(inside.inside, true);
assert.strictEqual(L.distText(inside), 'here');
var away = L.distText(L.distToEvent(named[0], { lat: 33.015, lon: -96.539 }));
assert.ok(/mi away$/.test(away), away);

assert.strictEqual(L.daysAgoLabel('2026-11-03', '2026-11-06'), '3d');
assert.strictEqual(L.daysAgoLabel('2026-11-06', '2026-11-06'), 'today');
assert.strictEqual(L.agoFromMs(now - 2 * 3600000, now), '2h');

assert.strictEqual(L.feedWaiting('wind', { active: 'load', recent: 'ok', swath: 'ok' }, false), true);
assert.strictEqual(L.feedWaiting('wind', { active: 'ok', recent: 'ok', swath: 'load' }, false), false);
assert.strictEqual(L.feedWaiting('hail', { active: 'ok', recent: 'ok', swath: 'load' }, false), true);
assert.ok(/data unavailable/.test(L.feedNote('wind', { active: 'err', recent: 'ok', swath: 'ok' }, false)));
assert.ok(/Radar hail areas: data unavailable/.test(L.feedNote('hail', { active: 'ok', recent: 'ok', swath: 'err' }, false)));
assert.strictEqual(L.feedNote('wind', { active: 'ok', recent: 'ok', swath: 'err' }, false), '');
assert.strictEqual(L.listMode({ inViewCount: 2, waiting: true, note: 'x' }), 'cards');
assert.strictEqual(L.listMode({ inViewCount: 0, waiting: true, note: '' }), 'loading');
assert.strictEqual(L.listMode({ inViewCount: 0, waiting: false, note: 'National Weather Service alerts: data unavailable.' }), 'unavailable');
assert.strictEqual(L.listMode({ inViewCount: 0, waiting: false, note: '' }), 'empty');

assert.strictEqual(L.inches(2.5), '2.5"');
assert.strictEqual(L.inches(0), null);
assert.strictEqual(L.markerCat({ kind: 'tornado', cats: ['tornado', 'hail'] }), 'tornado');
assert.strictEqual(L.markerCat({ kind: 'hail', cats: ['hail'], source: 'hail-area' }), 'hail');
var snow = L.categorize({ event: 'Winter Storm Warning', headline: 'Winter Storm Warning issued for Dallas', parameters: {} });
assert.strictEqual(snow.kind, 'snow');
assert.deepStrictEqual(snow.cats, ['snow']);
assert.strictEqual(L.kindColor('snow'), '#7c3aed');
assert.strictEqual(L.kindColor('thunderstorm'), '#d97706');
assert.strictEqual(L.kindColor('hail'), '#1d4ed8');
assert.strictEqual(L.kindColor('wind'), '#0f766e');
assert.strictEqual(L.kindColor('tornado'), '#dc2626');

console.log('storm-alerts-logic: ' + 28 + ' checks passed');

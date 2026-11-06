/* One place for source and outlook notes. Everyday screens keep a short Sources link. */
(function () {
  var CSS = '#srcv{position:fixed;inset:0;z-index:4200;background:#F7F3EA;display:none;flex-direction:column;color:#0A2748;font:16px/1.45 system-ui,-apple-system,sans-serif}' +
    '#srcv.on{display:flex}#srcv .wh{background:rgba(255,255,255,.96);border-bottom:1px solid #e7d7b0;padding:calc(8px + env(safe-area-inset-top)) 12px 10px}' +
    '#srcv .wt{display:flex;align-items:center;gap:8px}#srcv .wt b{flex:1;font-size:18px}' +
    '#srcv .bd{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:8px 12px calc(20px + env(safe-area-inset-bottom))}' +
    '#srcv .cd{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:14px 16px;margin:12px 0}' +
    '#srcv h2{margin:0 0 8px;font-size:17px}#srcv p{margin:0 0 10px;color:#334155}#srcv p:last-child{margin-bottom:0}' +
    '#srcv ul{margin:0;padding-left:18px;color:#334155}#srcv li{margin:8px 0}' +
    '#srcv .note{color:#64748b;font-size:14px}' +
    '.src-link{display:inline-block;margin:4px 2px 8px;padding:0;border:0;background:transparent;color:#0A2748;font:700 14px/1.3 system-ui,-apple-system,sans-serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer}';
  var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  var root = document.createElement('div');
  root.id = 'srcv';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Sources');
  root.innerHTML = '<div class="wh"><div class="wt"><b>Sources</b><button class="ic" type="button" id="src_x" aria-label="Close">&times;</button></div></div>' +
    '<div class="bd">' +
    '<div class="cd"><h2>Forecast</h2>' +
    '<p>The forecast on Weather is from Open-Meteo. Times are Central (CT). Temperature is °F. Wind is mph.</p>' +
    '<p>Storm warnings and the alerts on the map come from the National Weather Service.</p></div>' +
    '<div class="cd"><h2>Hail outlook</h2>' +
    '<p>The level on Weather is Elevated, Limited, Lower, or Data unavailable.</p>' +
    '<ul>' +
    '<li><b>Elevated</b> — SPC hail probability 15% or higher on day 1 or 2, or an Open-Meteo day coded 96 or 99 (thunderstorm with hail).</li>' +
    '<li><b>Limited</b> — SPC hail area of 5% and under 15%, or an Open-Meteo day coded 95 (thunderstorm, hail not in the code).</li>' +
    '<li><b>Lower</b> — SPC hail outlook under 5%, and Open-Meteo has no thunderstorm or hail code in the next 7 days.</li>' +
    '<li><b>Data unavailable</b> — that feed did not answer. A missing feed is never filled in. If only one feed answers, the level uses that feed alone.</li>' +
    '</ul>' +
    '<p class="note">SPC percentages are the chance of 1&quot; or larger hail within 25 miles of a point (NOAA Storm Prediction Center). They are not a promise for one house, and “less than 5%” is not 0%. Day 3 has no SPC hail layer. A Day 3 severe category, when shown, is not a hail percent. Open-Meteo codes describe the daily forecast, not a measured stone.</p></div>' +
    '<div class="cd"><h2>Hail dates</h2>' +
    '<p>Hail dates use NWS and CoCoRaHS ground reports already in this app. The file does not tag each older point as SPC or NCEI. Radar rows are MRMS MESH swaths in this app, from October 2020.</p>' +
    '<p class="note" id="src_note_hail"></p></div>' +
    '<div class="cd"><h2>Wind, tornado, and flood reports</h2>' +
    '<p>These are NWS local storm reports compiled by the Iowa Environmental Mesonet for the Fort Worth office (FWD). Hail reports from that feed are not repeated in the Wind and tornado list. A report is a spotter or station report near the point, not damage confirmed at the house.</p>' +
    '<p class="note" id="src_note_iem"></p></div>' +
    '<div class="cd"><h2>Map alerts</h2>' +
    '<p>Distances on the alert sheet are from the map center. Live alerts are National Weather Service watches and warnings. Closed hail is this map’s published hail history.</p></div>' +
    '<div class="cd"><h2>When a feed does not answer</h2>' +
    '<p>The screen says data unavailable. Nothing is filled in.</p></div>' +
    '</div>';
  document.body.appendChild(root);
  function open() { root.classList.add('on'); }
  function close() { root.classList.remove('on'); }
  document.getElementById('src_x').onclick = close;
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-sources]');
    if (!b) return;
    e.preventDefault();
    open();
  });
  function note(key, text) {
    var el = document.getElementById('src_note_' + key);
    if (el) el.textContent = text || '';
  }
  window.Sources = { open: open, close: close, note: note };
})();

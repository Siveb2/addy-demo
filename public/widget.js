/* Addy Voice widget — talks to /api/call and /api/status (serverless proxies).
   The agent API key never reaches the browser. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var fab = $('avOpen'), panel = $('avPanel'), closeBtn = $('avClose');
  var idle = $('avIdle'), live = $('avLive'), log = $('avLog');
  var callBtn = $('avCall'), endBtn = $('avEnd');
  var phoneEl = $('avPhone'), noteEl = $('avNote');
  var timerEl = $('avTimer'), livePhone = $('avLivePhone'), wave = $('avWave');

  /* ---------- waveform ---------- */
  var BARS = 34, bars = [];
  for (var i = 0; i < BARS; i++) { var b = document.createElement('b'); wave.appendChild(b); bars.push(b); }
  var anim = null, speaking = false;
  function animate() {
    var t = 0;
    (function frame() {
      t += 0.09;
      for (var i = 0; i < bars.length; i++) {
        var h = 3;
        if (speaking) {
          var s = Math.sin(t * 1.6 + i * 0.45) * Math.sin(t * 0.7 + i * 0.19);
          h = 4 + Math.abs(s) * 20 + Math.random() * 3;
        }
        bars[i].style.height = h.toFixed(1) + 'px';
      }
      anim = requestAnimationFrame(frame);
    })();
  }
  function stopAnim() { if (anim) cancelAnimationFrame(anim); anim = null; speaking = false; bars.forEach(function (b) { b.style.height = '3px'; }); }

  /* ---------- panel ---------- */
  function open() {
    panel.hidden = false; fab.hidden = true;
    setTimeout(function () { (phoneEl.value ? callBtn : phoneEl).focus(); }, 60);
  }
  function close() { panel.hidden = true; fab.hidden = false; fab.focus(); }
  fab.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) close();
  });

  /* remember the number between reloads */
  try {
    var saved = localStorage.getItem('addy_demo_phone');
    if (saved) phoneEl.value = saved;
  } catch (_) {}

  /* ---------- log ---------- */
  function ev(icon, title, sub, cls) {
    var d = document.createElement('div');
    d.className = 'av-ev' + (cls ? ' ' + cls : '');
    var i = document.createElement('i'); i.textContent = icon;
    var t = document.createElement('div');
    var b = document.createElement('b'); b.textContent = title; t.appendChild(b);
    if (sub) { var em = document.createElement('em'); em.textContent = sub; t.appendChild(em); }
    d.appendChild(i); d.appendChild(t); log.appendChild(d);
    $('avBody').scrollTop = $('avBody').scrollHeight;
    return d;
  }

  /* ---------- call state ---------- */
  var poll = null, tick = null, sec = 0, outboundId = null, done = false;

  function setBusy(on) {
    callBtn.disabled = on; endBtn.disabled = !on;
    callBtn.textContent = on ? 'Call in progress' : (done ? 'Call again' : 'Start the call');
  }

  function startTimer() {
    sec = 0; timerEl.textContent = '0:00';
    tick = setInterval(function () {
      sec++;
      timerEl.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    }, 1000);
  }

  function cleanup() {
    if (poll) { clearInterval(poll); poll = null; }
    if (tick) { clearInterval(tick); tick = null; }
    stopAnim();
  }

  function finish(msg, cls) {
    cleanup(); done = true; setBusy(false);
    ev(cls === 'err' ? '!' : '✓', msg, null, cls || 'ok');
  }

  /* ---------- start ---------- */
  callBtn.addEventListener('click', function () {
    var phone = (phoneEl.value || '').trim();
    if (!phone) { phoneEl.focus(); ev('!', 'Enter a phone number first', null, 'err'); return; }
    try { localStorage.setItem('addy_demo_phone', phone); } catch (_) {}

    done = false; outboundId = null;
    idle.hidden = true; live.hidden = false; log.innerHTML = '';
    livePhone.textContent = phone;
    setBusy(true); startTimer(); animate();

    ev('→', 'Placing call', phone, 'on');

    fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phone, note: (noteEl.value || '').trim() })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); })
      .then(function (res) {
        if (!res.ok) {
          var reason = (res.body && (res.body.reason || res.body.detail || res.body.error)) || ('HTTP ' + res.status);
          finish('Could not place the call', 'err');
          ev('!', String(reason), null, 'err');
          return;
        }
        outboundId = res.body.outbound_id || res.body.id || null;
        speaking = true;
        ev('✓', 'Dialing', res.body.agent_name ? ('Agent: ' + res.body.agent_name) : null, 'ok');
        if (outboundId) startPolling();
        else ev('·', 'Call placed', 'No status id returned — watch your phone');
      })
      .catch(function (e) {
        finish('Network error', 'err');
        ev('!', String(e && e.message || e), null, 'err');
      });
  });

  /* ---------- poll status ---------- */
  var lastStatus = null;
  function startPolling() {
    poll = setInterval(function () {
      fetch('/api/status?id=' + encodeURIComponent(outboundId))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j) return;
          var s = j.status || j.state;
          if (s && s !== lastStatus) {
            lastStatus = s;
            if (s === 'connected' || s === 'in_progress') { speaking = true; ev('●', 'Connected', null, 'on'); }
            else if (s === 'dialing' || s === 'ringing') { ev('·', 'Ringing'); }
            else if (s === 'ended' || s === 'completed' || s === 'failed') {
              speaking = false;
              finish(s === 'failed' ? 'Call failed' : 'Call ended', s === 'failed' ? 'err' : 'ok');
              if (j.summary) ev('✓', 'Summary', j.summary, 'ok');
            }
          }
        })
        .catch(function () { /* transient — keep polling */ });
    }, 3000);
  }

  /* ---------- end ---------- */
  endBtn.addEventListener('click', function () {
    speaking = false;
    finish('Ended from the dashboard', 'ok');
  });
})();

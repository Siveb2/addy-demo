/* Addy demo platform — browser voice call via LiveKit.
   Talks to the public share endpoints on the agent backend:
     GET  {API}/share/{key}/meta
     POST {API}/share/{key}/token   -> { token, url }
   Both are public (the key is the credential), so no server proxy is needed. */
(function () {
  'use strict';

  var CFG = window.ADDY_CONFIG || {};
  var API = (CFG.apiUrl || '').replace(/\/+$/, '');
  var KEY = CFG.callKey || '';
  var ENV = CFG.env || 'prod';

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- demo leads ---------------- */
  var LEADS = [
    {
      id: 'l1', initials: 'SM', name: 'Sarah Mitchell',
      meta: 'Loan 4471 · Conventional Purchase',
      need: 'July bank statement + LOE for $4,200 deposit',
      status: ['Awaiting borrower', 'w'],
      facts: [['Amount', '$625,000'], ['LTV', '80.0%'], ['DTI', '38.2%'], ['FICO', '744']],
      ask: ['July bank statement — Chase ····4421', 'Letter explaining the $4,200 deposit on 07/12']
    },
    {
      id: 'l2', initials: 'DK', name: 'David Kim',
      meta: 'Loan 4482 · FHA Purchase',
      need: 'Updated paystubs — last 30 days',
      status: ['Awaiting borrower', 'w'],
      facts: [['Amount', '$412,000'], ['LTV', '96.5%'], ['DTI', '41.8%'], ['FICO', '689']],
      ask: ['Two most recent paystubs', 'Confirm employer contact for VOE']
    },
    {
      id: 'l3', initials: 'RA', name: 'Rosa Alvarez',
      meta: 'Loan 4455 · Conventional Refi',
      need: 'Homeowner\'s insurance declaration page',
      status: ['Needs call', 'v'],
      facts: [['Amount', '$338,500'], ['LTV', '72.1%'], ['DTI', '33.4%'], ['FICO', '771']],
      ask: ['Insurance declaration page', 'Confirm mailing address on file']
    },
    {
      id: 'l4', initials: 'JT', name: 'James Thornton',
      meta: 'Loan 4490 · Jumbo Purchase',
      need: 'Gift letter + donor bank statement',
      status: ['Awaiting borrower', 'w'],
      facts: [['Amount', '$1,240,000'], ['LTV', '78.0%'], ['DTI', '36.0%'], ['FICO', '802']],
      ask: ['Signed gift letter', 'Donor bank statement showing the transfer']
    }
  ];

  var current = LEADS[0];

  /* ---------------- render leads ---------------- */
  function renderRows() {
    var wrap = $('leadRows');
    wrap.innerHTML = '';
    LEADS.forEach(function (l) {
      var row = document.createElement('div');
      row.className = 'row' + (l.id === current.id ? ' on' : '');
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.innerHTML =
        '<span class="r-av">' + l.initials + '</span>' +
        '<div><p class="r-n">' + l.name + '</p><p class="r-m">' + l.meta + '</p></div>' +
        '<p class="r-need">' + l.need + '</p>' +
        '<span class="chip ' + l.status[1] + '">' + l.status[0] + '</span>';
      row.addEventListener('click', function () { select(l); });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(l); }
      });
      wrap.appendChild(row);
    });
  }

  function select(l) {
    if (connected) return;           // don't switch mid-call
    current = l;
    renderRows();
    renderSelected();
  }

  function renderSelected() {
    $('selAv').textContent = current.initials;
    $('selName').textContent = current.name;
    $('selMeta').textContent = current.meta;

    var g = $('selGrid'); g.innerHTML = '';
    current.facts.forEach(function (f) {
      var c = document.createElement('div');
      c.className = 'sel-cell';
      c.innerHTML = '<span class="k">' + f[0] + '</span><span class="v">' + f[1] + '</span>';
      g.appendChild(c);
    });

    var ul = $('askList'); ul.innerHTML = '';
    current.ask.forEach(function (a) {
      var li = document.createElement('li'); li.textContent = a; ul.appendChild(li);
    });
  }

  /* ---------------- waveform ---------------- */
  var BARS = 40, bars = [], wave = $('wave');
  for (var i = 0; i < BARS; i++) { var b = document.createElement('b'); wave.appendChild(b); bars.push(b); }

  var audioCtx = null, analyser = null, raf = null, freq = null;

  function startMeter(stream) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.75;
      src.connect(analyser);
      freq = new Uint8Array(analyser.frequencyBinCount);
      loop();
    } catch (e) { fakeWave(); }
  }

  function loop() {
    analyser.getByteFrequencyData(freq);
    for (var i = 0; i < bars.length; i++) {
      var v = freq[Math.floor(i * freq.length / bars.length)] / 255;
      bars[i].style.height = (3 + v * 30).toFixed(1) + 'px';
    }
    raf = requestAnimationFrame(loop);
  }

  function fakeWave() {
    var t = 0;
    (function frame() {
      t += 0.09;
      for (var i = 0; i < bars.length; i++) {
        var s = Math.sin(t * 1.5 + i * 0.4) * Math.sin(t * 0.6 + i * 0.2);
        bars[i].style.height = (4 + Math.abs(s) * 18).toFixed(1) + 'px';
      }
      raf = requestAnimationFrame(frame);
    })();
  }

  function stopMeter() {
    if (raf) cancelAnimationFrame(raf); raf = null;
    if (audioCtx) { try { audioCtx.close(); } catch (_) {} audioCtx = null; }
    analyser = null;
    bars.forEach(function (b) { b.style.height = '3px'; });
  }

  /* ---------------- log ---------------- */
  function ev(icon, title, sub, cls) {
    var d = document.createElement('div');
    d.className = 'ev' + (cls ? ' ' + cls : '');
    var i = document.createElement('i'); i.textContent = icon;
    var t = document.createElement('div');
    var b = document.createElement('b'); b.textContent = title; t.appendChild(b);
    if (sub) { var em = document.createElement('em'); em.textContent = sub; t.appendChild(em); }
    d.appendChild(i); d.appendChild(t);
    $('log').appendChild(d);
    $('sideBody').scrollTop = $('sideBody').scrollHeight;
  }

  function badge(text, cls) {
    var el = $('sideBadge');
    el.textContent = text;
    el.className = 'side-badge' + (cls ? ' ' + cls : '');
  }

  /* ---------------- call ---------------- */
  var room = null, connected = false, tick = null, sec = 0;
  var startBtn = $('btnStart'), endBtn = $('btnEnd');

  function timer(on) {
    if (on) {
      sec = 0; $('callTimer').textContent = '0:00';
      tick = setInterval(function () {
        sec++;
        $('callTimer').textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
      }, 1000);
    } else if (tick) { clearInterval(tick); tick = null; }
  }

  function setStatus(text, idle) {
    $('callStatus').textContent = text;
    $('callDot').className = 'call-dot' + (idle ? ' idle' : '');
  }

  startBtn.addEventListener('click', start);
  endBtn.addEventListener('click', function () { stop('Ended by you'); });

  async function start() {
    if (connected) return;

    if (!API || !KEY) {
      ev('!', 'Not configured', 'Set apiUrl and callKey in config.js', 'err');
      badge('Setup needed', 'err');
      return;
    }
    if (!window.LivekitClient) {
      ev('!', 'Voice library did not load', 'Check your network / ad blocker', 'err');
      return;
    }

    startBtn.disabled = true; endBtn.disabled = false;
    $('log').innerHTML = '';
    $('callCard').hidden = false;
    setStatus('Connecting…', true);
    badge('Connecting', '');
    ev('→', 'Starting call', current.name, 'on');

    try {
      var r = await fetch(API + '/share/' + encodeURIComponent(KEY) + '/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env: ENV })
      });

      if (!r.ok) {
        var msg = r.status === 404 ? 'Link not available — check callKey'
          : r.status === 402 ? 'Quota exceeded on the agent account'
          : r.status === 429 ? 'All lines busy — try again in a moment'
          : 'Backend returned ' + r.status;
        throw new Error(msg);
      }

      var data = await r.json();
      if (!data.token || !data.url) throw new Error('Backend did not return a token');

      var LK = window.LivekitClient;
      room = new LK.Room({ adaptiveStream: true, dynacast: true });

      room.on(LK.RoomEvent.TrackSubscribed, function (track) {
        if (track.kind === 'audio') {
          var el = track.attach();
          el.autoplay = true;
          el.style.display = 'none';
          document.body.appendChild(el);
        }
      });

      room.on(LK.RoomEvent.ParticipantConnected, function () {
        setStatus('Addy is on the line', false);
        badge('Live', 'live');
        ev('●', 'Addy joined', null, 'ok');
      });

      room.on(LK.RoomEvent.Disconnected, function () { stop('Call ended'); });

      await room.connect(data.url, data.token);
      await room.localParticipant.setMicrophoneEnabled(true);

      connected = true;
      timer(true);
      setStatus('Connected', false);
      badge('Live', 'live');
      ev('✓', 'Microphone live', 'Speak normally', 'ok');

      var pub = room.localParticipant.getTrackPublication(LK.Track.Source.Microphone);
      var mediaTrack = pub && pub.track && pub.track.mediaStreamTrack;
      if (mediaTrack) startMeter(new MediaStream([mediaTrack]));
      else fakeWave();

    } catch (e) {
      var text = String(e && e.message || e);
      if (/permission|NotAllowed/i.test(text)) text = 'Microphone permission denied';
      ev('!', 'Could not start the call', text, 'err');
      badge('Failed', 'err');
      setStatus('Not connected', true);
      startBtn.disabled = false; endBtn.disabled = true;
      connected = false;
    }
  }

  function stop(reason) {
    if (room) { try { room.disconnect(); } catch (_) {} room = null; }
    if (connected) ev('✓', reason || 'Call ended', sec ? (sec + 's') : null, 'ok');
    connected = false;
    timer(false); stopMeter();
    setStatus('Not connected', true);
    badge('Ready', '');
    startBtn.disabled = false; endBtn.disabled = true;
  }

  window.addEventListener('beforeunload', function () { if (room) try { room.disconnect(); } catch (_) {} });

  /* ---------------- boot ---------------- */
  renderRows();
  renderSelected();

  if (API && KEY) {
    fetch(API + '/share/' + encodeURIComponent(KEY) + '/meta')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { if (m && m.name) $('sideBadge').title = 'Agent: ' + m.name; })
      .catch(function () {});
  } else {
    badge('Setup needed', 'err');
  }
})();

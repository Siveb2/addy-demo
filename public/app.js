/* Addy demo platform — browser voice call via LiveKit.
   Reaches the agent's public share endpoints through /api/share, a same-origin
   proxy, so the browser never makes a cross-origin request and the backend
   needs no CORS allowlist entry for this deployment. */
(function () {
  'use strict';

  var CFG = window.ADDY_CONFIG || {};
  var API = (CFG.apiUrl || '').replace(/\/+$/, '');
  var FALLBACK_KEY = CFG.callKey || '';
  var ENV = CFG.env || 'prod';

  var $ = function (id) { return document.getElementById(id); };

  /* Endpoint builder.
     On a deployment with serverless functions we go through /api/share — the
     page's OWN origin — so there is no CORS preflight and nothing to allowlist
     on the backend. On a plain static server (file:// or python -m http.server)
     there are no functions, so fall back to calling the backend directly; that
     path does need the origin allowlisted. */
  var USE_PROXY = location.protocol === 'http:' || location.protocol === 'https:';
  function ep(path, key) {
    if (USE_PROXY) {
      return '/api/share?path=' + path
        + '&api=' + encodeURIComponent(API)
        + '&key=' + encodeURIComponent(key)
        + '&env=' + encodeURIComponent(ENV);
    }
    return API + '/share/' + encodeURIComponent(key) + '/' + path;
  }

  /* ================= demo data ================= */
  var LEADS = [
    {
      id: 'l1', initials: 'SM', name: 'Sarah Mitchell',
      meta: 'Loan 4471 · Conventional Purchase',
      need: 'July bank statement + LOE for $4,200 deposit',
      status: ['Awaiting borrower', 'w'],
      callKey: 'f705df7553814fc9be562ab804f7e54c',
      facts: [['Amount', '$625,000'], ['LTV', '80.0%'], ['DTI', '38.2%'], ['FICO', '744']],
      ask: ['July bank statement — Chase ····4421', 'Letter explaining the $4,200 deposit on 07/12'],
      checklist: [
        ['done', 'Verification of employment', 'Received 09/08 · matched to AUS findings'],
        ['done', "Homeowner's insurance binder", 'Received 09/09 · verified'],
        ['done', 'Credit report', 'Pulled 09/02 · FICO 744, no derogatory items'],
        ['open', 'Bank statement — July 2026', 'Chase checking ····4421. Two most recent months required.'],
        ['open', 'Letter of explanation — large deposit', '$4,200 deposit on 07/12. Source and documentation required.'],
        ['wait', 'Final AUS resubmission', 'Blocked until the two items above clear'],
        ['wait', 'Closing disclosure', 'Issue 3 business days before closing']
      ],
      guidelines: [
        ['Max LTV', '97%', 'Fannie Mae · 1-unit principal residence, fixed rate'],
        ['This loan', '80.0%', 'Within guideline · 17 pts of headroom'],
        ['Max DTI', '45%', 'Fannie Mae · with DU Approve/Eligible'],
        ['This loan', '38.2%', 'Within guideline'],
        ['Min FICO', '620', 'Conventional conforming'],
        ['Large deposit', '> 50% of monthly income', 'Requires documented source · B3-4.2-02']
      ]
    },
    {
      id: 'l2', initials: 'DK', name: 'David Kim',
      meta: 'Loan 4482 · FHA Purchase',
      need: 'Updated paystubs — last 30 days',
      status: ['Awaiting borrower', 'w'],
      callKey: '',
      facts: [['Amount', '$412,000'], ['LTV', '96.5%'], ['DTI', '41.8%'], ['FICO', '689']],
      ask: ['Two most recent paystubs', 'Confirm employer contact for VOE'],
      checklist: [
        ['done', 'FHA case number assigned', 'Assigned 09/01'],
        ['done', 'Appraisal received', 'Value supports purchase price'],
        ['open', 'Paystubs — last 30 days', 'Two most recent consecutive periods'],
        ['open', 'Verbal VOE', 'Employer phone number needs confirming'],
        ['wait', 'MIP disclosure', 'Pending final figures']
      ],
      guidelines: [
        ['Max LTV', '96.5%', 'FHA · minimum 3.5% down, FICO ≥ 580'],
        ['This loan', '96.5%', 'At guideline maximum'],
        ['Max DTI', '43%', 'FHA · manual underwrite without compensating factors'],
        ['This loan', '41.8%', 'Within guideline · limited headroom'],
        ['Min FICO', '580', 'FHA · for 3.5% down payment']
      ]
    },
    {
      id: 'l3', initials: 'RA', name: 'Rosa Alvarez',
      meta: 'Loan 4455 · Conventional Refi',
      need: "Homeowner's insurance declaration page",
      status: ['Needs call', 'v'],
      callKey: 'd6930306a370469b99acec6678f55f1f',
      facts: [['Amount', '$338,500'], ['LTV', '72.1%'], ['DTI', '33.4%'], ['FICO', '771']],
      ask: ['Insurance declaration page', 'Confirm mailing address on file'],
      checklist: [
        ['done', 'Payoff statement received', 'Current servicer · good through 10/15'],
        ['done', 'Title commitment', 'Clear · no liens beyond the existing mortgage'],
        ['done', 'Income documentation', 'W-2 and two most recent paystubs verified'],
        ['open', "Homeowner's insurance declaration page", 'Current policy, showing the new lender as mortgagee'],
        ['open', 'Mailing address confirmation', 'File address differs from the credit report'],
        ['wait', 'Final CD and closing package', 'Ready once the two items above clear']
      ],
      guidelines: [
        ['Max LTV', '80%', 'Fannie Mae · no cash-out refinance, 1-unit'],
        ['This loan', '72.1%', 'Within guideline · comfortable headroom'],
        ['Max DTI', '45%', 'Fannie Mae · with DU Approve/Eligible'],
        ['This loan', '33.4%', 'Well within guideline'],
        ['Min FICO', '620', 'Conventional conforming'],
        ['Insurance', 'Required at closing', 'Dec page must name the new lender · B7-3']
      ]
    },
    {
      id: 'l4', initials: 'JT', name: 'James Thornton',
      meta: 'Loan 4490 · Jumbo Purchase',
      need: 'Gift letter + donor bank statement',
      status: ['Awaiting borrower', 'w'],
      callKey: '',
      facts: [['Amount', '$1,240,000'], ['LTV', '78.0%'], ['DTI', '36.0%'], ['FICO', '802']],
      ask: ['Signed gift letter', 'Donor bank statement showing the transfer'],
      checklist: [
        ['done', 'Asset verification — primary accounts', 'Reserves exceed 12 months PITI'],
        ['done', 'Two years tax returns', 'Received and reviewed'],
        ['open', 'Gift letter', 'Signed by donor, stating no repayment expected'],
        ['open', 'Donor bank statement', 'Showing the funds and the transfer out'],
        ['wait', 'Second appraisal', 'Required over $1M on this product']
      ],
      guidelines: [
        ['Max LTV', '80%', 'Jumbo · 1-unit primary, portfolio product'],
        ['This loan', '78.0%', 'Within guideline'],
        ['Max DTI', '43%', 'Jumbo · portfolio overlay'],
        ['This loan', '36.0%', 'Within guideline'],
        ['Min FICO', '720', 'Jumbo · portfolio overlay'],
        ['Reserves', '12 months PITI', 'Required over $1M']
      ]
    }
  ];

  var current = LEADS[0];
  var activeTab = 'voice';

  /* ---------------- render leads ---------------- */
  function renderRows() {
    var wrap = $('leadRows');
    wrap.innerHTML = '';
    LEADS.forEach(function (l) {
      var row = document.createElement('div');
      row.className = 'row' + (l.id === current.id ? ' on' : '');
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      var agentTag = l.callKey
        ? '<span class="agent-tag" title="This file has a live voice agent">\u25CF Agent ready</span>' : '';
      row.innerHTML =
        '<span class="r-av">' + l.initials + '</span>' +
        '<div><p class="r-n">' + l.name + agentTag + '</p><p class="r-m">' + l.meta + '</p></div>' +
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
    renderTab();
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
  }

  /* ================= tabs ================= */
  var tabs = document.querySelectorAll('.side-tab');
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      if (connected) return;
      activeTab = t.dataset.tab;
      tabs.forEach(function (x) {
        var on = x === t;
        x.setAttribute('aria-selected', on ? 'true' : 'false');
        x.tabIndex = on ? 0 : -1;
      });
      renderTab();
    });
  });

  function renderTab() {
    $('paneVoice').hidden = activeTab !== 'voice';
    $('paneChecklist').hidden = activeTab !== 'checklist';
    $('paneGuidelines').hidden = activeTab !== 'guidelines';
    $('sideFoot').hidden = activeTab !== 'voice';
    if (activeTab === 'voice') renderVoicePane();
    if (activeTab === 'checklist') renderChecklist();
    if (activeTab === 'guidelines') renderGuidelines();
  }

  function renderVoicePane() {
    var ul = $('askList'); ul.innerHTML = '';
    current.ask.forEach(function (a) {
      var li = document.createElement('li'); li.textContent = a; ul.appendChild(li);
    });
    $('noAgent').hidden = !!current.callKey;
    startBtn.disabled = !current.callKey || connected;
    startBtn.title = current.callKey ? '' : 'No voice agent configured for this file';
  }

  function renderChecklist() {
    var wrap = $('checkList'); wrap.innerHTML = '';
    var counts = { done: 0, open: 0, wait: 0 };
    current.checklist.forEach(function (c) { counts[c[0]]++; });
    $('checkSummary').innerHTML =
      '<span class="cs done">' + counts.done + ' cleared</span>' +
      '<span class="cs open">' + counts.open + ' outstanding</span>' +
      '<span class="cs wait">' + counts.wait + ' blocked</span>';
    current.checklist.forEach(function (c) {
      var mark = c[0] === 'done' ? '\u2713' : (c[0] === 'open' ? '!' : '\u00B7');
      var d2 = document.createElement('div');
      d2.className = 'ci ' + c[0];
      d2.innerHTML = '<span class="ci-m">' + mark + '</span>' +
        '<div><p class="ci-t">' + c[1] + '</p><p class="ci-d">' + c[2] + '</p></div>';
      wrap.appendChild(d2);
    });
  }

  function renderGuidelines() {
    var wrap = $('guideList'); wrap.innerHTML = '';
    $('guideFor').textContent = current.meta;
    current.guidelines.forEach(function (g) {
      var isThis = /^This loan$/i.test(g[0]);
      var d2 = document.createElement('div');
      d2.className = 'gi' + (isThis ? ' this' : '');
      d2.innerHTML =
        '<div class="gi-top"><span class="gi-k">' + g[0] + '</span><span class="gi-v">' + g[1] + '</span></div>' +
        '<p class="gi-s">' + g[2] + '</p>';
      wrap.appendChild(d2);
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

    var key = current.callKey || FALLBACK_KEY;
    if (!API || !key) {
      ev('!', 'No agent for this file', 'Add a callKey in app.js', 'err');
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
      var r = await fetch(ep('token', key), {
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
    endBtn.disabled = true;
    startBtn.disabled = !current.callKey;
  }

  window.addEventListener('beforeunload', function () { if (room) try { room.disconnect(); } catch (_) {} });

  /* ---------------- boot ---------------- */
  renderRows();
  renderSelected();
  renderTab();

  var bootKey = current.callKey || FALLBACK_KEY;
  if (API && bootKey) {
    fetch(ep('meta', bootKey))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { if (m && m.name) $('sideBadge').title = 'Agent: ' + m.name; })
      .catch(function () {});
  }
})();

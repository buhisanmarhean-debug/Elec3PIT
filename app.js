/* SafeHome — shared script, loaded by every page.
   Pages share their data through localStorage, so readings, the log, the alarm
   state and your contacts carry over when you move between pages. */
(() => {
  'use strict';

  // Thresholds (gas level 0-1000, must match the ESP32 sketch)
  const WARN = 500, DANGER = 700, MAX = 1000, ARC_LEN = 251.3;

  const $ = id => document.getElementById(id);
  const txt = (id, t) => { const e = $(id); if (e) e.textContent = t; };
  const timeStr = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  const classify = v => v >= DANGER ? 'danger' : v >= WARN ? 'warn' : 'safe';
  const STATES = {
    safe:   { pill: '● Safe range', icon: '✅', title: 'All clear',       sub: 'No smoke or gas detected',     tag: 'safe' },
    warn:   { pill: '● Elevated',   icon: '⚠️', title: 'Elevated levels', sub: 'Ventilate and check the area', tag: 'warn' },
    danger: { pill: '● Danger',     icon: '🚨', title: 'Smoke detected!', sub: 'Inspect the area immediately', tag: 'danger' },
  };

  // ---- shared state (persisted) ------------------------------------------
  let readings = store.get('readings', []);
  let state    = store.get('state', 'safe');
  let muted    = store.get('muted', false);
  let forceSpike = false;

  // ---- activity log ------------------------------------------------------
  function logRow(e) {
    const el = document.createElement('div'); el.className = 'log-item';
    const tag = document.createElement('span'); tag.className = 'tag ' + e.tag;
    const t = document.createElement('time'); t.textContent = e.t;
    const m = document.createElement('span'); m.textContent = e.msg;
    el.append(tag, t, m);
    return el;
  }
  function addLog(msg, tag = 'info') {
    const e = { t: timeStr(), msg, tag };
    const log = store.get('log', []);
    log.unshift(e); log.length = Math.min(log.length, 60);
    store.set('log', log);
    if ($('log')) $('log').prepend(logRow(e));
  }
  if (!store.get('log', []).length) addLog('System initialized');
  if ($('log')) store.get('log', []).forEach(e => $('log').append(logRow(e)));

  // ---- toast -------------------------------------------------------------
  let toastTimer;
  function toast(msg) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4500);
  }

  // ---- drawing -----------------------------------------------------------
  function drawSpark() {
    const box = $('spark'); if (!box) return;
    const w = 300, h = 70, n = 30, pts = readings.slice(-n);
    if (pts.length < 2) return;
    const step = w / (n - 1), off = n - pts.length;
    const xy = pts.map((v, i) => [(i + off) * step, h - (v / MAX) * (h - 6) - 3]);
    const line = xy.map(p => p.join(',')).join(' ');
    const dY = h - (DANGER / MAX) * (h - 6) - 3;
    box.innerHTML = `
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--state)" stop-opacity=".35"/><stop offset="1" stop-color="var(--state)" stop-opacity="0"/>
      </linearGradient></defs>
      <line x1="0" x2="${w}" y1="${dY}" y2="${dY}" stroke="var(--danger)" stroke-dasharray="4 4" opacity=".5"/>
      <polygon points="${xy[0][0]},${h} ${line} ${xy.at(-1)[0]},${h}" fill="url(#g)"/>
      <polyline points="${line}" fill="none" stroke="var(--state)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  function paint() {
    document.body.dataset.state = state;
    const info = STATES[state];
    txt('pill', info.pill); txt('alertIcon', info.icon); txt('alertTitle', info.title); txt('alertSub', info.sub);
    if ($('strip')) $('strip').hidden = state !== 'danger';
    if ($('muteBtn')) $('muteBtn').style.display = (state === 'danger' && !muted) ? '' : 'none';

    const v = readings.at(-1);
    if (v === undefined) return;
    txt('ppm', v);
    if ($('arc')) $('arc').style.strokeDashoffset = ARC_LEN * (1 - Math.min(v, MAX) / MAX);
    if ($('min')) {
      txt('min', Math.min(...readings));
      txt('max', Math.max(...readings));
      txt('avg', Math.round(readings.reduce((a, b) => a + b, 0) / readings.length));
    }
    drawSpark();
  }

  function render(v) {
    readings.push(v);
    if (readings.length > 200) readings.shift();
    store.set('readings', readings);

    const s = classify(v);
    if (s !== state) {                         // only react (and log) on a state change
      state = s; store.set('state', s);
      muted = false; store.set('muted', false);
      addLog(`${STATES[s].title} — level ${v}`, STATES[s].tag);
      if (s === 'danger') autoAlert();
    }
    paint();
    txt('updated', timeStr());
  }

  // Browsers block silent sending, so on danger we prompt for a one-tap alert
  function autoAlert() {
    toast('🚨 Smoke detected! Open Contacts and alert your people');
    addLog('Ready to alert contacts — open Contacts and tap send', 'danger');
  }

  // ---- sensors panel -----------------------------------------------------
  const SENSORS = [['mq2', 'MQ-2', 'Smoke · LPG'], ['mq7', 'MQ-7', 'Carbon monoxide'], ['mq135', 'MQ-135', 'Air quality']];
  if ($('sensorList')) {
    $('sensorList').innerHTML = SENSORS.map(([k, name, what]) =>
      `<div class="sensor"><div><b>${name}</b><small>${what}</small></div><div class="val" id="v-${k}">–</div><div class="bar"><i id="b-${k}"></i></div></div>`
    ).join('');
  }
  function showSensors(r) {
    if (!$('sensorList')) return;
    store.set('lastSensors', r);
    SENSORS.forEach(([k]) => {
      const v = Math.max(0, Math.min(MAX, r[k] ?? 0));
      $('b-' + k).style.width = (v / MAX * 100) + '%';
      $('b-' + k).style.background = `var(--${classify(v)})`;
      $('v-' + k).textContent = r.warmup ? '…' : Math.round(v);
    });
  }

  function setConn(m, left) {
    $('conn').classList.toggle('off', m === 'offline');
    $('connText').textContent = { demo: 'Demo mode', connecting: 'Connecting…', online: 'ESP32 online', offline: 'ESP32 offline', warmup: `Warming up ${left ?? ''}s` }[m];
    txt('mode', m === 'demo' ? 'Demo data' : 'Live');
  }

  // ---- data source -------------------------------------------------------
  // Live mode: http://<ESP32_IP>/data -> {mq2, mq7, mq135, warmup, warmupLeft}  (levels 0-1000)
  // Demo mode (no IP set): simulated readings
  async function readSensor() {
    const espIp = store.get('espIp', '');
    if (espIp) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2500);
      try {
        const r = await fetch(`http://${espIp}/data`, { signal: ctl.signal });
        if (!r.ok) throw new Error(r.status);
        return await r.json();
      } finally { clearTimeout(timer); }
    }
    const jitter = () => Math.round((Math.random() - 0.5) * 30);
    let v;
    if (forceSpike) { forceSpike = false; v = 760 + Math.floor(Math.random() * 120); }
    else {
      const last = readings.at(-1) ?? 120;
      v = last + (Math.random() - 0.5) * 60 + (120 - last) * 0.1;           // drift toward baseline
      if (Math.random() > 0.96) v = 740 + Math.random() * 120;               // rare spike
      v = Math.round(Math.max(40, Math.min(980, v)));
    }
    return { mq2: v, mq7: Math.max(0, Math.round(v * 0.55) + jitter()), mq135: Math.max(0, Math.round(v * 0.4) + jitter()) };
  }

  async function tick() {
    const espIp = store.get('espIp', '');
    try {
      const r = await readSensor();
      setConn(espIp ? (r.warmup ? 'warmup' : 'online') : 'demo', r.warmupLeft);
      showSensors(r);
      if (r.warmup) return;                                   // don't judge readings while sensors warm up
      render(Math.max(r.mq2, r.mq7, r.mq135));
    } catch { setConn('offline'); }
  }

  // ---- actions (Home page) ----------------------------------------------
  if ($('muteBtn')) $('muteBtn').onclick = () => {
    muted = true; store.set('muted', true); paint();
    addLog('Alarm silenced by user', 'info');
    const ip = store.get('espIp', '');
    if (ip) fetch(`http://${ip}/mute`).catch(() => addLog('Could not reach ESP32 to silence buzzer', 'warn'));
  };
  if ($('testBtn')) $('testBtn').onclick = () => {
    addLog('Sensor test started', 'info');
    const ip = store.get('espIp', '');
    if (ip) fetch(`http://${ip}/test`).catch(() => addLog('Could not reach ESP32', 'warn'));
    else forceSpike = true;
    setTimeout(tick, 300);
  };

  // ---- ESP32 connection (Sensors page) ----------------------------------
  if ($('espIp')) {
    $('espIp').value = store.get('espIp', '');
    $('connectBtn').onclick = () => {
      const ip = $('espIp').value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      $('espIp').value = ip;
      store.set('espIp', ip);
      readings = []; store.set('readings', readings);
      addLog(ip ? `Connecting to ESP32 at ${ip}` : 'Switched to demo mode', 'info');
      setConn(ip ? 'connecting' : 'demo');
      tick();
    };
  }

  // ---- alert message & helpers ------------------------------------------
  const alertMsg = () =>
    `🚨 SafeHome ALERT: smoke/gas detected at home — gas level ${readings.at(-1) ?? '?'}/1000 at ${new Date().toLocaleTimeString()}. Please check immediately.`;
  const cleanPhone = p => p.replace(/[^\d+]/g, '');
  const validPhone = p => p.replace(/\D/g, '').length >= 7;
  const copyMsg = msg => {
    try { return navigator.clipboard.writeText(msg).then(() => true, () => false); } catch { return Promise.resolve(false); }
  };

  // ---- contacts (Contacts page) -----------------------------------------
  if ($('contacts')) {
    let contacts = store.get('contacts', []);
    let editIndex = -1;                       // -1 = adding, otherwise index of the contact being edited

    function resetForm() {
      editIndex = -1;
      $('cName').value = $('cPhone').value = $('cMsgr').value = '';
      $('addContact').textContent = '+ Add contact';
      $('cancelEdit').style.display = 'none';
    }
    function startEdit(i) {
      const c = contacts[i];
      editIndex = i;
      $('cName').value = c.name;
      $('cPhone').value = c.phone || '';
      $('cMsgr').value = c.messenger || '';
      $('addContact').textContent = '💾 Save changes';
      $('cancelEdit').style.display = '';
      $('cName').focus();
    }

    function openSms(list) {
      const nums = list.map(c => cleanPhone(c.phone)).join(',');
      addLog(`SMS opened for ${list.map(c => c.name).join(', ')}`, 'info');
      const sep = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? '&' : '?';   // iPhone "&body=", Android "?body="
      location.href = `sms:${nums}${sep}body=${encodeURIComponent(alertMsg())}`;
    }
    function openMessenger(c) {
      const msg = alertMsg();
      copyMsg(msg).then(ok => toast(ok ? 'Message copied — if the chat opens empty, just paste it' : 'If the chat opens empty, type your alert'));
      window.open(c.messenger ? `https://m.me/${encodeURIComponent(c.messenger)}?text=${encodeURIComponent(msg)}` : 'https://www.messenger.com/', '_blank');
      addLog(`Messenger opened for ${c.name}`, 'info');
    }

    function renderContacts() {
      const box = $('contacts');
      box.innerHTML = '';
      txt('contactCount', contacts.length);
      if (!contacts.length) { box.innerHTML = '<div class="empty">No contacts yet — add family or neighbours</div>'; return; }
      contacts.forEach((c, i) => {
        const row = document.createElement('div'); row.className = 'contact';
        const info = document.createElement('div'); info.className = 'cinfo';
        const n = document.createElement('b'); n.textContent = c.name;
        const p = document.createElement('span'); p.textContent = [c.phone, c.messenger && '@' + c.messenger].filter(Boolean).join(' · ');
        info.append(n, p);
        const mk = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'chip ' + cls; b.textContent = label; b.onclick = fn; return b; };
        row.append(info);
        if (validPhone(c.phone)) row.append(mk('SMS', '', () => openSms([c])));
        row.append(
          mk('Messenger', '', () => openMessenger(c)),
          mk('✎', '', () => startEdit(i)),
          mk('✕', 'x', () => {
            contacts.splice(i, 1); store.set('contacts', contacts);
            if (editIndex === i) resetForm(); else if (editIndex > i) editIndex--;
            renderContacts();
          })
        );
        box.append(row);
      });
    }

    $('addContact').onclick = () => {
      const name = $('cName').value.trim();
      const phone = $('cPhone').value.trim();
      const messenger = $('cMsgr').value.trim().replace(/^.*(?:m\.me|messenger\.com\/t|facebook\.com)\//, '').replace(/[@\/]/g, '');
      if (!name || (!validPhone(phone) && !messenger)) { toast('Enter a name and a phone number or Messenger username'); return; }
      const entry = { name, phone: validPhone(phone) ? phone : '', messenger };
      if (editIndex >= 0) { contacts[editIndex] = entry; addLog(`Contact updated: ${name}`, 'info'); toast('Contact updated'); }
      else { contacts.push(entry); addLog(`Contact added: ${name}`, 'info'); }
      store.set('contacts', contacts);
      resetForm();
      renderContacts();
    };
    $('cancelEdit').onclick = resetForm;

    $('smsAll').onclick = () => {
      const list = contacts.filter(c => validPhone(c.phone));
      if (!list.length) { toast('Add a contact with a phone number first'); return; }
      openSms(list);
    };
    $('shareBtn').onclick = async () => {
      const msg = alertMsg();
      if (navigator.share) {                  // phone share sheet: pick Messenger, SMS, etc.
        try { await navigator.share({ title: 'SafeHome Alert', text: msg }); addLog('Alert shared', 'info'); } catch {}
      } else {
        toast((await copyMsg(msg)) ? 'Alert message copied — paste it into Messenger' : 'Sharing is not supported here');
      }
    };
    renderContacts();
  }

  // ---- alert strip & theme (every page) ---------------------------------
  if ($('strip')) $('strip').onclick = () => { location.href = 'contacts.html'; };

  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $('themeBtn').textContent = t === 'dark' ? '🌙' : '☀️';
  }
  applyTheme(document.documentElement.dataset.theme || 'dark');
  $('themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('theme', next); } catch {}
  };

  // ---- start -------------------------------------------------------------
  setConn(store.get('espIp', '') ? 'connecting' : 'demo');
  const last = store.get('lastSensors', null);
  if (last && store.get('espIp', '')) showSensors(last);
  paint();
  tick();
  setInterval(tick, 3000);
})();
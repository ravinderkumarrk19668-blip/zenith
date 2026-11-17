(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');

  const S = {
    phase: 'connecting',
    mult: 1,
    flyStart: 0,
    points: [],
    balance: 0,
    name: '',
    bet: 0,
    cashed: null,
    seedHash: '',
    countdown: 0,
    crashPoint: null,
  };

  // ---------- Local demo engine (no server) ----------
  // The whole game runs in the browser (see demo-engine.js), so this page works as a static site.
  let game = null;
  let csrf = '';
  let stopRetry = false;

  function connect() {
    $('who').textContent = 'Demo player';
    game = ZRDemo.create(handle);
  }
  const send = (o) => { if (game) game.send(o); };

  function handle(d) {
    switch (d.type) {
      case 'init':
        S.phase = d.phase; S.mult = d.mult; S.seedHash = d.seedHash;
        S.points = [];
        if (d.phase === 'flying') S.flyStart = performance.now() - Math.log(d.mult) / 0.12 * 1000;
        $('fRound').textContent = d.roundId;
        $('fHash').textContent = d.seedHash;
        renderHistory(d.history);
        renderBets(d.bets);
        $('amount').min = d.minBet; $('amount').max = d.maxBet;
        S.minBet = d.minBet; S.maxBet = d.maxBet;
        break;
      case 'you':
        S.balance = d.balance; S.name = d.name; S.bet = d.bet; S.cashed = d.cashed;
        $('balance').textContent = d.balance.toFixed(2);
        if (d.cashed) setMsg(`Cashed out at ${d.cashed.toFixed(2)}× — won ${Number(d.payout).toFixed(2)} coins`, 'ok');
        break;
      case 'round':
        S.phase = d.phase;
        if (d.phase === 'betting') {
          S.mult = 1; S.points = []; S.crashPoint = null;
          $('fRound').textContent = d.roundId;
          $('fHash').textContent = d.seedHash;
          $('fSeed').textContent = '-';
          $('fCheck').textContent = '';
          setMsg('Place your bet!', '');
        } else if (d.phase === 'flying') {
          S.flyStart = performance.now();
          S.points = [{ t: 0, m: 1 }];
        }
        break;
      case 'countdown': S.countdown = d.left; break;
      case 'tick':
        S.mult = d.mult;
        S.points.push({ t: (performance.now() - S.flyStart) / 1000, m: d.mult });
        break;
      case 'crash':
        S.phase = 'crashed'; S.mult = d.crashPoint; S.crashPoint = d.crashPoint;
        renderHistory(d.history);
        $('fSeed').textContent = d.serverSeed;
        verify(d.serverSeed, d.seedHash);
        if (S.bet > 0 && S.cashed === null) setMsg(`Crashed at ${d.crashPoint.toFixed(2)}× — bet lost.`, 'err');
        break;
      case 'bets': renderBets(d.bets); break;
      case 'error': setMsg(d.message, 'err'); break;
      case 'kicked':
        stopRetry = true;
        setMsg('This account was opened in another tab. Reload to play here.', 'err');
        break;
      case 'authfail':
        setMsg('Login expired. Reloading…', 'err');
        setTimeout(() => location.reload(), 1000);
        break;
    }
    updateUI();
  }

  // ---------- UI ----------
  function setMsg(t, cls) { const m = $('msg'); m.textContent = t; m.className = 'msg ' + (cls || ''); }

  function renderHistory(h) {
    $('history').innerHTML = h.map((v) => {
      const c = v < 2 ? 'low' : v < 10 ? 'mid' : 'high';
      return `<span class="chip ${c}">${v.toFixed(2)}×</span>`;
    }).join('');
  }

  function renderBets(list) {
    const tb = document.querySelector('#bets tbody');
    tb.innerHTML = '';
    list.forEach((b) => {
      const tr = document.createElement('tr');
      if (b.name === S.name) tr.className = 'me';
      const n = document.createElement('td'); n.textContent = b.name;
      const a = document.createElement('td'); a.textContent = Number(b.amount).toFixed(2);
      const c = document.createElement('td');
      if (b.cashed) { c.textContent = Number(b.cashed).toFixed(2) + '×'; c.className = 'win'; } else c.textContent = '-';
      tr.append(n, a, c); tb.appendChild(tr);
    });
  }

  async function verify(seed, hash) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      $('fCheck').textContent = hex === hash ? '✓ Seed matches the hash published before the round.' : '✗ Hash mismatch!';
    } catch (_) { /* crypto.subtle needs https or localhost */ }
  }

  function updateUI() {
    const btn = $('action');
    const ov = $('overlay');
    ov.className = 'overlay';
    btn.className = 'primary';

    if (S.phase === 'betting') {
      ov.classList.add('wait');
      ov.textContent = `Next flight in ${S.countdown.toFixed(1)}s`;
      if (S.bet > 0) { btn.textContent = `Bet placed: ${S.bet.toFixed(2)}`; btn.disabled = true; }
      else if (S.balance < (S.minBet || 0.1)) { btn.textContent = 'Reset demo balance'; btn.disabled = false; }
      else { btn.textContent = 'Place bet'; btn.disabled = false; }
    } else if (S.phase === 'flying') {
      ov.textContent = S.mult.toFixed(2) + '×';
      if (S.bet > 0 && S.cashed === null) {
        btn.classList.add('cash');
        btn.textContent = `Cash out ${(S.bet * S.mult).toFixed(2)}`;
        btn.disabled = false;
      } else { btn.textContent = 'Round in progress'; btn.disabled = true; }
    } else if (S.phase === 'crashed') {
      ov.classList.add('crashed');
      ov.textContent = `Crashed @ ${(S.crashPoint ?? S.mult).toFixed(2)}×`;
      btn.textContent = 'Next round soon…'; btn.disabled = true;
    } else {
      ov.classList.add('wait'); ov.textContent = 'Connecting…';
      btn.textContent = 'Connecting…'; btn.disabled = true;
    }
  }

  $('action').addEventListener('click', () => {
    if (S.phase === 'betting') {
      if (S.balance < (S.minBet || 0.1)) { send({ type: 'reset' }); return; }
      send({
        type: 'bet',
        amount: parseFloat($('amount').value),
        auto: parseFloat($('auto').value) || 0,
      });
    } else if (S.phase === 'flying') {
      send({ type: 'cashout' });
    }
  });

  document.querySelectorAll('.quick button').forEach((b) =>
    b.addEventListener('click', () => {
      const el = $('amount');
      let v = parseFloat(el.value) || 0;
      if (b.dataset.mul) v *= parseFloat(b.dataset.mul);
      if (b.dataset.add) v += parseFloat(b.dataset.add);
      const lo = S.minBet || 0.1, hi = S.maxBet || 100;
      el.value = Math.max(lo, Math.min(hi, Math.round(v * 100) / 100));
    }));

  $('reset').addEventListener('click', () => send({ type: 'reset' }));

  // ---------- Canvas ----------
  function drawRocket(x, y, angle, crashed) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (crashed) {
      ctx.fillStyle = '#fb7185';
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI * 2 * i) / 10;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * 34, Math.sin(a) * 34);
        ctx.lineTo(Math.cos(a + 0.25) * 14, Math.sin(a + 0.25) * 14);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    // flame
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-38 - Math.random() * 10, 0); ctx.lineTo(-18, 6); ctx.lineTo(-18, -6); ctx.fill();
    // body
    ctx.fillStyle = '#e8e8ff';
    ctx.beginPath();
    ctx.moveTo(26, 0);
    ctx.quadraticCurveTo(8, -13, -18, -9);
    ctx.lineTo(-18, 9);
    ctx.quadraticCurveTo(8, 13, 26, 0);
    ctx.fill();
    // fins
    ctx.fillStyle = '#a855f7';
    ctx.beginPath(); ctx.moveTo(-8, -9); ctx.lineTo(-20, -20); ctx.lineTo(-18, -8); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-8, 9); ctx.lineTo(-20, 20); ctx.lineTo(-18, 8); ctx.fill();
    // window
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath(); ctx.arc(6, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function render() {
    const W = canvas.width, H = canvas.height, pad = 50;
    ctx.clearRect(0, 0, W, H);

    // grid
    ctx.strokeStyle = 'rgba(138,138,176,.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = pad + ((H - 2 * pad) * i) / 5;
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - 20, y); ctx.stroke();
    }

    if ((S.phase === 'flying' || S.phase === 'crashed') && S.points.length > 1) {
      const last = S.points[S.points.length - 1];
      const tMax = Math.max(8, last.t * 1.1);
      const mMax = Math.max(2, last.m * 1.15);
      const X = (t) => pad + (t / tMax) * (W - pad - 40);
      const Y = (m) => H - pad - ((m - 1) / (mMax - 1)) * (H - 2 * pad);

      // fill
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(34,211,238,.28)');
      grad.addColorStop(1, 'rgba(168,85,247,0)');
      ctx.beginPath();
      ctx.moveTo(X(0), Y(1));
      S.points.forEach((p) => ctx.lineTo(X(p.t), Y(p.m)));
      ctx.lineTo(X(last.t), H - pad);
      ctx.lineTo(X(0), H - pad);
      ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();

      // line
      ctx.beginPath();
      S.points.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.m)) : ctx.moveTo(X(p.t), Y(p.m))));
      ctx.strokeStyle = S.phase === 'crashed' ? '#fb7185' : '#22d3ee';
      ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.stroke();

      const prev = S.points[Math.max(0, S.points.length - 4)];
      const ang = Math.atan2(Y(last.m) - Y(prev.m), X(last.t) - X(prev.t));
      drawRocket(X(last.t), Y(last.m), ang, S.phase === 'crashed');
    }

    updateUI();
    requestAnimationFrame(render);
  }

  connect();
  render();
})();

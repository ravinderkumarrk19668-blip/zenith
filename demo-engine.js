/* Zenith Rush DEMO engine (play money only).
 *
 * Runs the whole crash game inside the browser, so the site is a plain static page
 * (this is what makes it deployable on Vercel). It sends the same messages the old
 * WebSocket server sent, so game.js works almost unchanged.
 *
 * There is no wallet, no deposit, no withdrawal and no real money anywhere in this file.
 * The balance is "demo coins" kept in this browser's localStorage.
 * The other pilots in the table are simulated by this script.
 */
(function (global) {
  'use strict';

  var BET_TIME = 6;          // seconds for the betting phase
  var CRASH_PAUSE = 4;       // seconds the crash is shown before the next round
  var GROWTH = 0.12;         // multiplier = e^(GROWTH * seconds)
  var MIN_BET = 0.1;
  var MAX_BET = 100;
  var HISTORY_SIZE = 15;
  var HOUSE_EDGE_MOD = 25;   // 1 in 25 rounds crash at 1.00x
  var START_BALANCE = 1000;  // demo coins
  var STORE_KEY = 'zr_demo_balance_v1';
  var BOT_NAMES = ['Nova', 'Orbit', 'Comet', 'Pulsar', 'Quasar', 'Vega', 'Atlas', 'Lyra'];

  function r2(v) { return Math.round(v * 100) / 100; }

  function loadBalance() {
    try {
      var v = parseFloat(global.localStorage.getItem(STORE_KEY));
      if (isFinite(v) && v >= 0) return v;
    } catch (e) { /* storage is optional */ }
    return START_BALANCE;
  }
  function saveBalance(v) {
    try { global.localStorage.setItem(STORE_KEY, String(v)); } catch (e) { /* ignore */ }
  }

  function randomHex(bytes) {
    var a = new Uint8Array(bytes);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(a);
    else for (var i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function toHex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function sha256Hex(str) {
    return global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(toHex);
  }
  function hmacHex(key, msg) {
    var enc = new TextEncoder();
    return global.crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then(function (k) { return global.crypto.subtle.sign('HMAC', k, enc.encode(msg)); })
      .then(toHex);
  }

  /** Crash point from 13 hex digits (52 bits). Same formula the original server used. */
  function crashFromHex(hex) {
    var n = BigInt('0x' + hex.slice(0, 13));
    var E = 1n << 52n;
    if (n % BigInt(HOUSE_EDGE_MOD) === 0n) return 1;
    return Number((100n * E - n) / (E - n)) / 100;
  }

  function create(onMessage) {
    var emit = function (d) { onMessage(d); };
    var balance = loadBalance();
    var me = { bet: 0, auto: 0, cashed: null, payout: 0 };
    var bots = BOT_NAMES.map(function (n) { return { name: n, bet: 0, target: 0, cashed: null }; });
    var game = { phase: 'loading', roundId: 0, seed: '', seedHash: '', crash: 1, start: 0, mult: 1, history: [] };
    var botTimers = [];
    var loop = null;

    function now() { return Date.now() / 1000; }

    function betsList() {
      var list = [];
      if (me.bet > 0) list.push({ name: 'You', amount: me.bet, cashed: me.cashed });
      bots.forEach(function (b) { if (b.bet > 0) list.push({ name: b.name, amount: b.bet, cashed: b.cashed }); });
      return list;
    }
    function sendYou() {
      emit({ type: 'you', name: 'You', balance: balance, bet: me.bet, cashed: me.cashed, payout: me.payout });
    }
    function sendBets() { emit({ type: 'bets', bets: betsList() }); }

    function scheduleBots() {
      botTimers.forEach(clearTimeout);
      botTimers = [];
      var amounts = [0.5, 1, 2, 3, 5, 10, 20];
      bots.forEach(function (b) {
        if (Math.random() > 0.65) return;
        botTimers.push(setTimeout(function () {
          if (game.phase !== 'betting' || b.bet > 0) return;
          b.bet = amounts[Math.floor(Math.random() * amounts.length)];
          b.target = Math.max(1.1, Math.min(30, 0.97 / (1 - Math.random())));
          b.cashed = null;
          sendBets();
        }, 300 + Math.random() * 4500));
      });
    }

    function newRound(first) {
      game.phase = 'loading';
      game.roundId++;
      game.seed = randomHex(16);

      var ready;
      if (global.crypto && global.crypto.subtle) {
        ready = sha256Hex(game.seed).then(function (hash) {
          game.seedHash = hash;
          return hmacHex(game.seed, String(game.roundId));
        }).then(function (h) { game.crash = crashFromHex(h); });
      } else {
        // Very old browser or an insecure page: still playable, but without the seed check.
        game.seedHash = '';
        game.crash = crashFromHex(randomHex(7));
        ready = Promise.resolve();
      }

      return ready.catch(function () {
        game.seedHash = '';
        game.crash = crashFromHex(randomHex(7));
      }).then(function () {
        game.phase = 'betting';
        game.start = now();
        game.mult = 1;
        me.bet = 0; me.auto = 0; me.cashed = null; me.payout = 0;
        bots.forEach(function (b) { b.bet = 0; b.target = 0; b.cashed = null; });

        if (first) {
          emit({
            type: 'init', phase: 'betting', mult: 1, roundId: game.roundId, seedHash: game.seedHash,
            history: game.history, bets: [], minBet: MIN_BET, maxBet: MAX_BET
          });
        }
        emit({ type: 'round', phase: 'betting', roundId: game.roundId, seedHash: game.seedHash });
        sendBets();
        sendYou();
        scheduleBots();
      });
    }

    function cashOutMe(x100) {
      if (me.bet <= 0 || me.cashed !== null) return;
      var payout = r2(me.bet * x100 / 100);
      balance = r2(balance + payout);
      me.cashed = x100 / 100;
      me.payout = payout;
      saveBalance(balance);
      sendYou();
      sendBets();
    }

    function tick() {
      var t = now();

      if (game.phase === 'betting') {
        var left = BET_TIME - (t - game.start);
        if (left <= 0) {
          game.phase = 'flying';
          game.start = t;
          emit({ type: 'round', phase: 'flying', roundId: game.roundId });
        } else {
          emit({ type: 'countdown', left: Math.round(left * 10) / 10 });
        }
        return;
      }

      if (game.phase === 'flying') {
        var mult = Math.floor(100 * Math.exp(GROWTH * (t - game.start))) / 100;

        if (mult >= game.crash) {
          game.phase = 'crashed';
          game.start = t;
          game.mult = game.crash;
          game.history.unshift(game.crash);
          game.history = game.history.slice(0, HISTORY_SIZE);
          emit({
            type: 'crash', crashPoint: game.crash, serverSeed: game.seed, seedHash: game.seedHash,
            roundId: game.roundId, history: game.history
          });
          return;
        }

        game.mult = mult;
        if (me.bet > 0 && me.cashed === null && me.auto > 1 && mult >= me.auto) {
          cashOutMe(Math.round(me.auto * 100));
        }
        var changed = false;
        bots.forEach(function (b) {
          if (b.bet > 0 && b.cashed === null && mult >= b.target) {
            b.cashed = Math.floor(b.target * 100) / 100;
            changed = true;
          }
        });
        if (changed) sendBets();
        emit({ type: 'tick', mult: mult });
        return;
      }

      if (game.phase === 'crashed' && t - game.start >= CRASH_PAUSE) {
        newRound(false);
      }
    }

    function send(msg) {
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'bet') {
        if (game.phase !== 'betting' || me.bet > 0) {
          return emit({ type: 'error', message: 'Bets are closed or already placed.' });
        }
        var amount = r2(parseFloat(msg.amount));
        if (!isFinite(amount) || amount < MIN_BET || amount > MAX_BET) {
          return emit({ type: 'error', message: 'Bet must be ' + MIN_BET + ' - ' + MAX_BET + ' coins.' });
        }
        if (amount > balance) {
          return emit({ type: 'error', message: 'Not enough demo coins. Press "Reset balance".' });
        }
        balance = r2(balance - amount);
        me.bet = amount;
        me.auto = parseFloat(msg.auto) > 1 ? parseFloat(msg.auto) : 0;
        me.cashed = null;
        me.payout = 0;
        saveBalance(balance);
        sendYou();
        sendBets();
      } else if (msg.type === 'cashout') {
        if (game.phase === 'flying') cashOutMe(Math.round(game.mult * 100));
      } else if (msg.type === 'reset') {
        if (me.bet > 0 && me.cashed === null && game.phase !== 'crashed') {
          return emit({ type: 'error', message: 'Finish your current bet first.' });
        }
        balance = START_BALANCE;
        saveBalance(balance);
        sendYou();
      } else if (msg.type === 'refresh') {
        sendYou();
      }
    }

    newRound(true).then(function () { loop = setInterval(tick, 100); });

    return {
      send: send,
      stop: function () { if (loop) clearInterval(loop); botTimers.forEach(clearTimeout); },
      _crashFromHex: crashFromHex
    };
  }

  global.ZRDemo = { create: create, _crashFromHex: crashFromHex };
})(window);

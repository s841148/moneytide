// 錢潮 MoneyTide © 2026 麥麥的遊戲工廠 保留所有權利 All rights reserved. 詳見 LICENSE
// 網路連線（M7）：瀏覽器點對點連線（WebRTC，透過 PeerJS 的免費公開服務配對）。
// 房主的電腦是權威：保存遊戲狀態、執行 AI；玩家只把動作傳給房主，房主檢查後廣播給所有人。
// 因為引擎是「同樣的種子 + 同樣的動作 = 同樣的結果」，大家只要依序套用動作就會一致；
// 每個動作附上檢查碼，對不上時再整份重新同步。
window.MT = window.MT || {};

(function () {
  const PEER_SRC = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const PREFIX = 'moneytide-v1-';
  const PROTO = 1; // 連線協定版本，房主與玩家必須相同
  const CHUNK = 48000; // 大訊息切塊傳送，避免超過資料通道的單筆上限
  const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const PING_MS = 3000; // 心跳間隔
  const HOST_TIMEOUT = 10000; // 房主：玩家這麼久沒回應就當作斷線
  const CLIENT_TIMEOUT = 12000; // 玩家：這麼久沒收到房主心跳就當作房主離線

  const N = MT.Net = {
    mode: null, // null（單機）| 'host' | 'client'
    code: null,
    status: 'idle', // idle | connecting | open | closed | error
    started: false,
    peer: null,
    clients: {}, // 房主：連線 id → { conn, name, seat, online }
    conn: null, // 玩家：連到房主的連線
    mySeat: null,
    lobby: null,
  };

  let peerLoading = null;
  function loadPeer() {
    if (window.Peer) return Promise.resolve();
    if (peerLoading) return peerLoading;
    peerLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PEER_SRC;
      s.onload = () => resolve();
      s.onerror = () => { peerLoading = null; reject(new Error('load')); };
      document.head.appendChild(s);
    });
    return peerLoading;
  }

  function randomCode() {
    let c = '';
    for (let i = 0; i < 5; i++) c += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    return c;
  }

  function changed() { if (MT.UI && MT.UI.onNet) MT.UI.onNet(); }
  function notify(key, params, cls) { if (MT.UI) MT.UI.toast(MT.Gloss.esc(MT.t(key, params)), cls || 'err-toast', 3500); }

  // ── 傳送（大訊息切塊）──
  let chunkSeq = 0;
  function sendTo(conn, msg) {
    if (!conn || !conn.open) return;
    const s = JSON.stringify(msg);
    if (s.length <= CHUNK) { conn.send(s); return; }
    const id = ++chunkSeq;
    const n = Math.ceil(s.length / CHUNK);
    for (let i = 0; i < n; i++) conn.send(JSON.stringify({ t: 'chunk', id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }
  const pieces = {};
  function receive(raw, handler, conn) {
    let msg;
    try { msg = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return; }
    if (msg.t === 'chunk') {
      const k = (conn ? conn.peer : '') + ':' + msg.id;
      const box = pieces[k] || (pieces[k] = []);
      box[msg.i] = msg.d;
      if (box.filter((x) => x != null).length === msg.n) {
        delete pieces[k];
        receive(box.join(''), handler, conn);
      }
      return;
    }
    handler(msg, conn);
  }

  function broadcast(msg) { Object.values(N.clients).forEach((c) => { if (c.online) sendTo(c.conn, msg); }); }

  // ════ 房主 ════
  N.host = function () {
    N.leave();
    N.mode = 'host';
    N.status = 'connecting';
    changed();
    loadPeer().then(() => makeHostPeer(randomCode())).catch(() => { N.status = 'error'; notify('net_err_load'); changed(); });
  };

  function makeHostPeer(code) {
    const peer = new window.Peer(PREFIX + code, { debug: 1 });
    N.peer = peer;
    N.code = code;
    peer.on('open', () => { N.status = 'open'; changed(); });
    clearInterval(N.beat);
    // 心跳：關掉分頁時連線不一定會立刻通知，所以定期確認玩家還在
    N.beat = setInterval(() => {
      const now = Date.now();
      Object.values(N.clients).forEach((c) => {
        if (!c.online) return;
        if (now - c.last > HOST_TIMEOUT) hostOnClose(c.conn);
        else sendTo(c.conn, { t: 'ping' });
      });
    }, PING_MS);
    peer.on('connection', (conn) => {
      conn.on('data', (d) => receive(d, hostOnData, conn));
      conn.on('close', () => hostOnClose(conn));
      conn.on('error', () => hostOnClose(conn));
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') { peer.destroy(); makeHostPeer(randomCode()); return; }
      if (err.type === 'peer-unavailable') return; // 某個玩家斷線，不影響房間
      N.status = 'error';
      notify('net_err_generic', { msg: err.type || '' });
      changed();
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
  }

  // 大廳座位：依開局設定，kinds = human（房主本機）/ ai / net（網路玩家）
  function lobbySeats() {
    const s = MT.UI.setup;
    const seats = [];
    for (let i = 0; i < s.count; i++) {
      const owner = Object.values(N.clients).find((c) => c.seat === i && c.online);
      seats.push({ kind: s.kinds[i], name: owner ? owner.name : s.names[i], style: s.styles[i], taken: !!owner });
    }
    return seats;
  }

  N.lobbyMessage = function () {
    const s = MT.UI.setup;
    return {
      t: 'lobby', code: N.code, seats: lobbySeats(),
      settings: { difficulty: s.difficulty, victory: s.victory, length: s.length, customRounds: s.customRounds, roleMode: s.roleMode, aiLevel: s.aiLevel },
      spectators: Object.values(N.clients).filter((c) => c.online && c.seat == null).map((c) => c.name),
    };
  };

  N.pushLobby = function () {
    if (N.mode !== 'host' || N.started) return;
    Object.values(N.clients).forEach((c) => { if (c.online) sendTo(c.conn, Object.assign(N.lobbyMessage(), { you: c.seat })); });
  };

  function freeNetSeat() {
    const s = MT.UI.setup;
    for (let i = 0; i < s.count; i++) {
      if (s.kinds[i] === 'net' && !Object.values(N.clients).some((c) => c.seat === i && c.online)) return i;
    }
    return null;
  }

  function hostOnData(msg, conn) {
    const g = MT.UI.game;
    if (N.clients[conn.peer]) N.clients[conn.peer].last = Date.now();
    if (msg.t === 'pong') return;
    if (msg.t === 'hello') {
      if (msg.proto !== PROTO) { sendTo(conn, { t: 'reject', error: 'net_err_version' }); setTimeout(() => conn.close(), 300); return; }
      const name = String(msg.name || '').slice(0, 12) || MT.t('net_guest');
      if (N.started && g) {
        // 遊戲進行中：同名玩家回來就交還座位，否則當觀眾
        const back = Object.entries(N.clients).find(([, c]) => !c.online && c.name === name && c.seat != null);
        let seat = null;
        if (back) { seat = back[1].seat; delete N.clients[back[0]]; }
        N.clients[conn.peer] = { conn, name, seat, online: true, last: Date.now() };
        sendTo(conn, { t: 'welcome', seat, state: g });
        if (seat != null && g.players[seat].ai && g.players[seat].ai.standIn) MT.UI.netHostAct({ type: 'SET_AI', seat, ai: null });
        notify(seat != null ? 'net_rejoined' : 'net_spectator_join', { name }, 'term-toast');
      } else {
        const seat = freeNetSeat();
        N.clients[conn.peer] = { conn, name, seat, online: true, last: Date.now() };
        notify('net_joined', { name }, 'term-toast');
        MT.Audio.play('chime');
        N.pushLobby();
      }
      changed();
      return;
    }
    const c = N.clients[conn.peer];
    if (!c) return;
    if (msg.t === 'act') {
      if (!g || !N.started || g.phase === 'gameover') return;
      const a = msg.action || {};
      if (a.type === 'SET_AI') return; // 只有房主可以切換電腦代打
      const actor = MT.AI.actorOf(g);
      if (c.seat == null || !actor || actor.id !== c.seat || actor.ai) { sendTo(conn, { t: 'reject', error: 'err_not_your_turn' }); return; }
      MT.UI.netHostAct(a, conn);
      return;
    }
    if (msg.t === 'needsync' && g) { sendTo(conn, { t: 'sync', state: g }); return; }
    if (msg.t === 'emote') { N.emote(msg.e, c.seat, c.name); }
  }

  function hostOnClose(conn) {
    const c = N.clients[conn.peer];
    if (!c || !c.online) return;
    c.online = false;
    notify('net_left', { name: c.name }, 'term-toast');
    if (N.started && MT.UI.game && c.seat != null && MT.UI.game.phase !== 'gameover') {
      // 斷線：電腦暫時代打，保留座位等他回來
      MT.UI.netHostAct({ type: 'SET_AI', seat: c.seat, ai: { style: 'conservative', level: 'normal', standIn: true } });
    } else {
      delete N.clients[conn.peer];
      N.pushLobby();
    }
    changed();
  }

  // 房主開局：網路座位沒人坐的改成電腦；把座位對應記下來，再把初始狀態送給每個人
  N.startGame = function (state) {
    N.started = true;
    Object.values(N.clients).forEach((c) => {
      if (c.online) sendTo(c.conn, { t: 'start', seat: c.seat, state });
    });
  };

  // 房主每做完一個動作就廣播（附檢查碼）
  N.broadcastAct = function (action, g) {
    broadcast({ t: 'act', action, check: { len: g.log.length, rng: g.rng } });
  };

  N.sendReject = function (conn, error) { sendTo(conn, { t: 'reject', error }); };

  // 回到大廳（遊戲結束後再玩一局）
  N.backToLobby = function () {
    N.started = false;
    Object.entries(N.clients).forEach(([k, c]) => { if (!c.online) delete N.clients[k]; });
    Object.values(N.clients).forEach((c) => { c.seat = null; });
    Object.values(N.clients).forEach((c) => { c.seat = freeNetSeat(); });
    N.pushLobby();
  };

  // ════ 玩家 ════
  N.join = function (code, name) {
    N.leave();
    code = String(code || '').trim().toUpperCase();
    if (code.length !== 5) { notify('net_err_code'); return; }
    N.mode = 'client';
    N.code = code;
    N.status = 'connecting';
    N.myName = name;
    changed();
    loadPeer().then(() => {
      const peer = new window.Peer(undefined, { debug: 1 });
      N.peer = peer;
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true });
        N.conn = conn;
        conn.on('open', () => {
          N.status = 'open';
          N.lastPing = Date.now();
          sendTo(conn, { t: 'hello', name, proto: PROTO });
          clearInterval(N.beat);
          N.beat = setInterval(() => {
            if (N.mode === 'client' && N.status === 'open' && Date.now() - N.lastPing > CLIENT_TIMEOUT) {
              N.status = 'closed';
              notify('net_host_left');
              changed();
            }
          }, PING_MS);
          changed();
        });
        conn.on('data', (d) => receive(d, clientOnData, conn));
        conn.on('close', () => { if (N.mode === 'client') { N.status = 'closed'; notify('net_host_left'); changed(); } });
      });
      peer.on('error', (err) => {
        N.status = 'error';
        notify(err.type === 'peer-unavailable' ? 'net_err_noroom' : 'net_err_generic', { msg: err.type || '' });
        changed();
      });
    }).catch(() => { N.status = 'error'; notify('net_err_load'); changed(); });
  };

  function clientOnData(msg) {
    N.lastPing = Date.now();
    switch (msg.t) {
      case 'ping': N.send({ t: 'pong' }); break;
      case 'lobby':
        N.lobby = msg;
        N.mySeat = msg.you;
        N.started = false;
        if (MT.UI.game) MT.UI.netBackToLobby(); else changed();
        break;
      case 'welcome':
      case 'start':
        N.mySeat = msg.seat;
        N.started = true;
        if (msg.state) MT.UI.netLoad(msg.state);
        else changed();
        break;
      case 'act': MT.UI.netApply(msg.action, msg.check); break;
      case 'sync': MT.UI.netLoad(msg.state, true); break;
      case 'reject': notify(msg.error); break;
      case 'emote': showEmote(msg.seat, msg.e, msg.name); break;
      default: break;
    }
  }

  N.send = function (msg) { sendTo(N.conn, msg); };

  // ── 表情 ──
  const EMOTES = ['👍', '😱', '😂', '🤔', '🎉', '💸'];
  N.EMOTES = EMOTES;
  N.emote = function (e, seat, name) {
    if (EMOTES.indexOf(e) < 0) return;
    if (N.mode === 'client') { N.send({ t: 'emote', e }); return; }
    if (N.mode === 'host') {
      const mySeat = seat === undefined ? MT.UI.hostSeat() : seat;
      const who = name || (MT.UI.game && mySeat != null ? MT.UI.game.players[mySeat].name : MT.t('net_host'));
      broadcast({ t: 'emote', seat: mySeat, e, name: who });
      showEmote(mySeat, e, who);
    }
  };
  function showEmote(seat, e, name) {
    MT.Audio.play('tick');
    const card = seat != null ? document.querySelector('.pcard[data-id="' + seat + '"]') : null;
    const r = card ? card.getBoundingClientRect() : { left: window.innerWidth / 2, width: 0, top: 120 };
    const el = document.createElement('div');
    el.className = 'fx-emote';
    el.innerHTML = '<span>' + e + '</span><small>' + MT.Gloss.esc(name || '') + '</small>';
    el.style.left = (r.left + r.width / 2) + 'px';
    el.style.top = (r.top + 10) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  // ── 離開 ──
  N.leave = function () {
    clearInterval(N.beat);
    if (N.peer) { try { N.peer.destroy(); } catch (e) { /* ignore */ } }
    Object.assign(N, { mode: null, code: null, status: 'idle', started: false, peer: null, clients: {}, conn: null, mySeat: null, lobby: null });
  };

  N.onlineCount = function () { return Object.values(N.clients).filter((c) => c.online).length; };
  N.seatOwner = function (seat) { return Object.values(N.clients).find((c) => c.seat === seat && c.online) || Object.values(N.clients).find((c) => c.seat === seat); };
  N.isRemoteSeat = function (seat) { return !!N.seatOwner(seat); };
})();

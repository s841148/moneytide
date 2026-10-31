// 錢潮 MoneyTide © 2026 麥麥的遊戲工廠 保留所有權利 All rights reserved. 詳見 LICENSE
// 畫面：開局設定、棋盤、回合操作、財報、市場、季報、結算。
// 每次動作後整個重繪，狀態一律來自 MT.Engine。
window.MT = window.MT || {};

(function () {
  const E = MT.Engine;
  const C = E.Calc;
  const M = MT.Macro;
  const D = MT.DATA;
  const t = MT.t;
  const L = MT.L;
  const esc = MT.Gloss.esc;
  const rich = MT.Gloss.rich;
  const fmt = MT.fmtMoney;
  const SAVE_KEY = 'mt_save';

  const UI = MT.UI = {
    game: null,
    viewPlayer: null,
    rightTab: 'statement',
    lastReport: null,
    setup: {
      count: 2, names: ['', '', '', ''], difficulty: 'easy', victory: 'freedom', length: 'medium', customRounds: 32, roleMode: 'random', seed: '', retire: 'on',
      kinds: ['human', 'ai', 'ai', 'ai'], styles: ['value', 'momentum', 'conservative', 'macro'], aiLevel: 'normal', aiSpeed: 'normal',
    },
  };

  const $ = (sel) => document.querySelector(sel);

  function profOf(p) { return D.professions.find((x) => x.id === p.prof); }

  // 這個玩家是不是由「這台裝置」操作（單機：所有真人；連線房主：本機座位；連線玩家：自己的座位）
  function isMine(p) {
    if (!p || p.ai) return false;
    const N = MT.Net;
    if (N.mode === 'client') return p.id === N.mySeat;
    if (N.mode === 'host') return !N.isRemoteSeat(p.id);
    return true;
  }
  UI.isMine = isMine;
  UI.hostSeat = function () {
    const p = UI.game && UI.game.players.find(isMine);
    return p ? p.id : null;
  };
  function moneyCls(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : ''; }
  function pct(x, d) { return (x > 0 ? '+' : '') + (x * 100).toFixed(d == null ? 1 : d) + '%'; }
  function canTrade(g) { return g.phase === 'roll' || g.phase === 'action'; }

  // ── 共用元件 ──
  UI.toast = function (html, cls, ms) {
    const el = document.createElement('div');
    el.className = 'toast ' + (cls || '');
    el.innerHTML = html;
    const box = $('#toasts');
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild.remove();
    setTimeout(() => el.classList.add('out'), (ms || 3000) - 300);
    setTimeout(() => el.remove(), ms || 3000);
  };

  UI.modal = function (html, cls) {
    const m = $('#modal');
    m.innerHTML = '<div class="modal-card ' + (cls || '') + '"><button class="modal-x" data-action="close-modal" aria-label="close">✕</button>' + html + '</div>';
    m.hidden = false;
    UI.modalKind = cls || '';
  };

  UI.closeModal = function () {
    $('#modal').hidden = true;
    $('#modal').innerHTML = '';
    UI.modalKind = null;
    UI.orderId = null;
    if (UI.game) setTimeout(scheduleAI, 0); // 視窗關掉後，電腦繼續行動
  };

  function seg(name, options, value) {
    return '<div class="seg">' + options.map((o) => (
      '<button class="seg-btn' + (o.value === value ? ' on' : '') + '" data-action="setup" data-name="' + name + '" data-value="' + o.value + '">'
      + '<b>' + o.label + '</b>' + (o.desc ? '<small>' + o.desc + '</small>' : '') + '</button>'
    )).join('') + '</div>';
  }

  // 迷你走勢圖
  function spark(values, w, h) {
    if (!values || values.length < 2) return '<svg class="spark" width="' + w + '" height="' + h + '"></svg>';
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const span = max - min || 1;
    const pts = values.map((v, i) => ((i / (values.length - 1)) * (w - 2) + 1).toFixed(1) + ',' + (h - 1 - ((v - min) / span) * (h - 2)).toFixed(1)).join(' ');
    const up = values[values.length - 1] >= values[0];
    return '<svg class="spark ' + (up ? 'up' : 'down') + '" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><polyline points="' + pts + '" fill="none" stroke-width="1.6"/></svg>';
  }

  // ── 存檔 ──
  function saveGame() {
    if (MT.Net.mode === 'client') return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(UI.game)); } catch (e) { /* ignore */ }
  }
  function loadSave() {
    try {
      const s = E.migrate(JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'));
      return s && s.version === E.SAVE_VERSION && s.phase !== 'gameover' ? s : null;
    } catch (e) { return null; }
  }

  // ── 存檔匯出／匯入（換裝置接著玩）──
  // 代碼格式：MTZ1: + gzip 後的 base64（瀏覽器不支援壓縮時用 MTJ1: + 原始 JSON 的 base64）
  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function encodeSave(g) {
    // 紀錄只用到最近幾回合，代碼版只留最後 150 筆，讓代碼短到能用聊天軟體傳
    const cut = Math.max(0, g.log.length - 150);
    const json = JSON.stringify(Object.assign({}, g, { log: g.log.slice(cut), turnLogStart: Math.max(0, g.turnLogStart - cut) }));
    if (window.CompressionStream) {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
      return 'MTZ1:' + toB64(new Uint8Array(await new Response(stream).arrayBuffer()));
    }
    return 'MTJ1:' + toB64(new TextEncoder().encode(json));
  }
  async function decodeSave(text) {
    const s = String(text || '').trim();
    let json;
    if (s.charAt(0) === '{') json = s;
    else if (s.indexOf('MTZ1:') === 0) {
      const stream = new Blob([fromB64(s.slice(5).replace(/\s+/g, ''))]).stream().pipeThrough(new DecompressionStream('gzip'));
      json = await new Response(stream).text();
    } else if (s.indexOf('MTJ1:') === 0) json = new TextDecoder().decode(fromB64(s.slice(5).replace(/\s+/g, '')));
    else return null;
    const g = E.migrate(JSON.parse(json));
    const ok = g && g.version === E.SAVE_VERSION && Array.isArray(g.players) && g.config && g.macro && g.phase !== 'gameover';
    return ok ? g : null;
  }

  // ── 手動存檔欄位（存在這台裝置上，和自動存檔分開）──
  const SLOT_KEY = 'mt_slots';
  const SLOT_COUNT = 3;
  function readSlots() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(SLOT_KEY) || '[]') || []; } catch (e) { list = []; }
    while (list.length < SLOT_COUNT) list.push(null);
    return list.slice(0, SLOT_COUNT);
  }
  function writeSlots(list) {
    try { localStorage.setItem(SLOT_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  function slotGame(slot) {
    try {
      const g = E.migrate(JSON.parse(slot.data));
      return g && g.version === E.SAVE_VERSION && g.phase !== 'gameover' ? g : null;
    } catch (e) { return null; }
  }
  // inGame：遊戲中可以存到欄位；連線中不能讀取別的存檔
  function slotsHtml(inGame) {
    const canLoad = !MT.Net.mode;
    return '<div class="sv-slots">' + readSlots().map((slot, i) => {
      const info = slot
        ? '<b>' + t('sl_name', { n: i + 1 }) + '</b><small>' + esc(t('sv_info', { round: slot.round, total: slot.total, names: slot.names })) + '</small><small class="muted">' + esc(new Date(slot.time).toLocaleString(MT.lang === 'zh' ? 'zh-TW' : 'en-US')) + '</small>'
        : '<b>' + t('sl_name', { n: i + 1 }) + '</b><small class="muted">' + t('sl_empty') + '</small>';
      const btns = (inGame ? '<button class="btn sm primary" data-action="slot-save" data-i="' + i + '">💾 ' + t(slot ? 'sl_overwrite' : 'sl_save') + '</button>' : '')
        + (slot && canLoad ? '<button class="btn sm" data-action="slot-load" data-i="' + i + '">▶ ' + t('sl_load') + '</button>' : '')
        + (slot ? '<button class="btn sm ghost" data-action="slot-del" data-i="' + i + '" aria-label="delete">🗑️</button>' : '');
      return '<div class="sv-slot"><div class="sv-slot-info">' + info + '</div><div class="sv-slot-btns">' + btns + '</div></div>';
    }).join('') + '</div>';
  }

  function openSaveMenu() {
    const g = UI.game;
    UI.modal('<h2>💾 ' + t('sv_title') + '</h2>'
      + '<p class="small muted">' + t('sl_auto') + '</p>'
      + '<h3>' + t('sl_title') + '</h3>'
      + slotsHtml(true)
      + '<h3>' + t('sl_move') + '</h3>'
      + '<p>' + t('sv_desc') + '</p>'
      + '<p class="small muted">' + esc(t('sv_info', { round: g.round, total: g.config.rounds, names: g.players.map((p) => p.name).join('、') })) + '</p>'
      + '<div class="sv-btns"><button class="btn" data-action="save-download">⬇️ ' + t('sv_download') + '</button>'
      + '<button class="btn" data-action="save-copy">📋 ' + t('sv_copy') + '</button></div>'
      + '<p class="small muted">' + t('sv_how') + '</p>', 'small-modal');
  }

  function openImport() {
    const any = readSlots().some((x) => x);
    UI.modal('<h2>📂 ' + t(any ? 'sl_open_btn' : 'sv_import_title') + '</h2>'
      + (any ? '<h3>' + t('sl_title') + '</h3>' + slotsHtml(false) + '<h3>' + t('sl_from_file') + '</h3>' : '')
      + '<label class="sv-file">' + t('sv_file') + '<input type="file" accept=".json,.txt,application/json,text/plain" class="sv-file-input"></label>'
      + '<label class="sv-paste">' + t('sv_paste') + '<textarea class="sv-code" rows="5" placeholder="MTZ1:…"></textarea></label>'
      + '<div class="actions"><button class="btn primary" data-action="save-import">' + t('sv_load') + '</button></div>'
      + '<p class="small muted">' + t('sv_import_note') + '</p>', 'small-modal');
  }

  async function doImport(text) {
    let g = null;
    try { g = await decodeSave(text); } catch (e) { g = null; }
    if (!g) { UI.toast(esc(t('sv_bad')), 'err-toast', 4000); return; }
    UI.closeModal();
    resumeGame(g);
    saveGame();
    UI.toast(esc(t('sv_loaded')), '', 3000);
  }

  function resumeGame(g) {
    UI.game = g;
    UI.viewPlayer = null;
    UI.turnKey = null;
    UI.lastReport = g.report ? g.report.round : null;
    UI.seenLog = g.turnLogStart;
    renderGame();
    scheduleAI();
  }

  // ── 開局設定 ──
  function soundBtn() {
    const on = MT.Audio.settings.sfx || MT.Audio.settings.music;
    return '<button class="btn ghost sm" data-action="sound" aria-label="sound">' + (on ? '🔊' : '🔇') + '</button>';
  }

  function renderSetup() {
    const s = UI.setup;
    if (MT.Tutorial && MT.Tutorial.active()) MT.Tutorial.stop(false);
    MT.Audio.setMood('menu');
    clearTimeout(UI.aiTimer);
    UI.aiTimer = null;
    $('#game').hidden = true;
    $('#setup').hidden = false;
    const N = MT.Net;
    if (N.mode === 'client') { renderClientLobby(); return; }
    const hosting = N.mode === 'host';
    const names = [];
    const STY = MT.AI.STYLES;
    for (let i = 0; i < s.count; i++) {
      const ai = s.kinds[i] === 'ai';
      const net = s.kinds[i] === 'net';
      const owner = net && hosting ? N.seatOwner(i) : null;
      const ph = ai ? STY[s.styles[i]].icon + ' ' + L(STY[s.styles[i]].name) : net ? t('net_waiting_seat') : t('player_default', { n: i + 1 });
      const kinds = hosting && i > 0 ? ['human', 'net', 'ai'] : ['human', 'ai'];
      names.push('<div class="seat' + (ai ? ' is-ai' : '') + (net ? ' is-net' + (owner ? ' taken' : '') : '') + '">'
        + '<div class="seat-kind">'
        + kinds.map((k) => '<button class="chip' + (s.kinds[i] === k ? ' on' : '') + '" data-action="seat-kind" data-idx="' + i + '" data-val="' + k + '">' + t(k === 'net' ? 'net_kind_net' : 'setup_kind_' + k) + '</button>').join('')
        + '</div>'
        + (net
          ? '<div class="net-seat">' + (owner ? '🟢 <b>' + esc(owner.name) + '</b>' : '⏳ ' + t('net_waiting_seat')) + '</div>'
          : '<input class="name-input" data-idx="' + i + '" maxlength="12" placeholder="' + esc(ph) + '" value="' + esc(s.names[i]) + '">')
        + (ai
          ? '<select class="style-select" data-idx="' + i + '">' + Object.keys(STY).map((k) => '<option value="' + k + '"' + (s.styles[i] === k ? ' selected' : '') + '>' + STY[k].icon + ' ' + esc(L(STY[k].name)) + '</option>').join('') + '</select>'
            + '<small class="muted">' + esc(L(STY[s.styles[i]].desc)) + '</small>'
          : '')
        + '</div>');
    }
    const anyAI = s.kinds.slice(0, s.count).indexOf('ai') >= 0;
    const allAI = s.kinds.slice(0, s.count).every((k) => k === 'ai');
    const rounds = s.length === 'custom' ? s.customRounds : E.lengthRounds[s.length];
    const lenOpt = (v) => ({ value: v, label: t('len_' + v), desc: v === 'custom' ? '' : t('len_detail', { rounds: E.lengthRounds[v], years: E.lengthRounds[v] / 4 }) });
    const resume = hosting ? null : loadSave();

    $('#setup').innerHTML = ''
      + '<div class="setup-card">'
      + '<div class="hero" aria-hidden="true"><span>💰</span><span>📈</span><span>🏠</span><span>🌍</span><span>🏦</span><span>🪙</span></div>'
      + '<div class="setup-top"><div><h1>🌊 <span class="grad">' + t('title') + '</span></h1><p class="muted">' + t('subtitle') + '</p></div>'
      + '<div class="setup-top-btns"><button class="btn ghost" data-action="glossary">' + t('glossary_btn', { n: MT.Gloss.count(), total: MT.Gloss.total() }) + '</button>'
      + '<button class="btn ghost" data-action="ach">🏅 ' + MT.Ach.count() + '/' + MT.Ach.total() + '</button>'
      + soundBtn() + '<button class="btn ghost" data-action="settings" aria-label="settings">⚙️</button>'
      + '<button class="btn ghost" data-action="lang">🌐 ' + t('lang_toggle') + '</button></div></div>'
      + (hosting ? hostPanel() : '<button class="btn tutorial' + (MT.Tutorial.isDone() ? '' : ' first') + '" data-action="tutorial">🎓 ' + t('tut_start') + '<small>' + t(MT.Tutorial.isDone() ? 'tut_start_d2' : 'tut_start_d') + '</small></button>')
      + (resume ? '<button class="btn resume" data-action="resume">▶ ' + t('resume') + '</button>' : '')
      + (hosting ? '' : '<button class="btn ghost import-btn" data-action="save-import-open">📂 ' + t(readSlots().some((x) => x) ? 'sl_open_btn' : 'sv_import_btn') + '</button>')
      + (hosting ? '' : onlinePanel())
      + '<h3>' + t('setup_players') + '</h3>'
      + seg('count', [1, 2, 3, 4].map((n) => ({ value: String(n), label: n + ' 👤' })), String(s.count))
      + '<div class="names">' + names.join('') + '</div>'
      + '<p class="note">' + t('setup_ai_note') + (allAI ? '<br>' + t('setup_watch') : '') + '</p>'
      + (anyAI
        ? '<h3>' + t('setup_ai_level') + '</h3>'
          + seg('aiLevel', ['easy', 'normal', 'hard'].map((v) => ({ value: v, label: t('ai_' + v), desc: t('ai_' + v + '_d') })), s.aiLevel)
          + '<h3>' + t('setup_ai_speed') + '</h3>'
          + seg('aiSpeed', ['normal', 'fast'].map((v) => ({ value: v, label: t('speed_' + v) })), s.aiSpeed)
        : '')
      + '<h3>' + t('setup_difficulty') + '</h3>'
      + seg('difficulty', ['easy', 'medium', 'hard'].map((v) => ({ value: v, label: t('diff_' + v), desc: t('diff_' + v + '_d') })), s.difficulty)
      + '<h3>' + t('setup_victory') + '</h3>'
      + seg('victory', ['freedom', 'networth', 'bankrupt'].map((v) => ({ value: v, label: t('vic_' + v), desc: t('vic_' + v + '_d') })), s.victory)
      + '<h3>' + t('setup_length') + '</h3>'
      + seg('length', ['short', 'medium', 'long', 'custom'].map(lenOpt), s.length)
      + (s.length === 'custom'
        ? '<div class="custom-len"><input type="range" min="12" max="80" step="4" value="' + s.customRounds + '" data-action="custom-rounds"> <span>' + t('len_detail', { rounds, years: rounds / 4 }) + '</span></div>'
        : '')
      + '<h3>' + t('setup_retire') + '</h3>'
      + seg('retire', ['on', 'off'].map((v) => ({ value: v, label: t('retire_' + v), desc: v === 'on' ? t('retire_on_d', { round: E.retireRoundOf(rounds), early: E.earliestOf(rounds, E.retireRoundOf(rounds)) }) : t('retire_off_d') })), s.retire)
      + '<h3>' + t('setup_role') + '</h3>'
      + seg('roleMode', ['random', 'skill', 'equal'].map((v) => ({ value: v, label: t('role_' + v), desc: t('role_' + v + '_d') })), s.roleMode)
      + '<h3>' + t('setup_seed') + '</h3>'
      + '<input class="seed-input" placeholder="' + esc(t('setup_seed_ph')) + '" value="' + esc(s.seed) + '">'
      + '<button class="btn primary big" data-action="start"' + (hosting && N.status !== 'open' ? ' disabled' : '') + '>' + t(hosting ? 'net_start' : 'start') + ' ➜</button>'
      + copyrightFooter()
      + '</div>';
    if (hosting) N.pushLobby();
  }

  // 開局畫面底部的版權宣告與免責聲明
  function copyrightFooter() {
    return '<footer class="copyright"><strong>' + t('copyright') + '</strong><span>' + t('legal_note') + '</span></footer>';
  }

  // 單機開局畫面上的「網路連線對戰」面板
  function onlinePanel() {
    const N = MT.Net;
    const busy = N.mode === 'client' && N.status === 'connecting';
    return '<details class="online-panel"' + (UI.onlineOpen ? ' open' : '') + '><summary>' + t('net_title') + '</summary>'
      + '<p class="small muted">' + t('net_desc') + '</p>'
      + '<div class="online-row"><button class="btn primary" data-action="net-host">🏠 ' + t('net_host_btn') + '</button></div>'
      + '<div class="online-row"><input class="join-name" maxlength="12" placeholder="' + esc(t('net_name_ph')) + '" value="' + esc(UI.joinName || '') + '">'
      + '<input class="join-code" maxlength="5" placeholder="' + esc(t('net_code_ph')) + '" value="' + esc(UI.joinCode || '') + '">'
      + '<button class="btn" data-action="net-join"' + (busy ? ' disabled' : '') + '>🚪 ' + t('net_join_btn') + '</button></div>'
      + '<p class="small muted">' + t('net_note') + '</p></details>';
  }

  function statusText() {
    return t('net_status_' + MT.Net.status);
  }

  // 房主大廳：房間代碼與已加入的人
  function hostPanel() {
    const N = MT.Net;
    const spect = Object.values(N.clients).filter((c) => c.online && c.seat == null).map((c) => c.name);
    return '<div class="room-panel"><div class="room-top"><div><div class="small muted">' + t('net_room') + '</div>'
      + '<div class="room-code">' + (N.code || '·····') + '</div></div>'
      + '<div class="room-btns"><span class="net-status s-' + N.status + '">' + statusText() + '</span>'
      + '<button class="btn sm" data-action="net-copy"' + (N.code ? '' : ' disabled') + '>📋 ' + t('net_copy') + '</button>'
      + '<button class="btn sm ghost" data-action="net-leave">' + t('net_leave') + '</button></div></div>'
      + '<p class="small">' + t('net_share') + '</p>'
      + (spect.length ? '<p class="small muted">' + esc(t('net_spectators', { names: spect.join('、') })) + '</p>' : '')
      + '</div>';
  }

  // 玩家大廳：等房主開始
  function renderClientLobby() {
    const N = MT.Net;
    const lb = N.lobby;
    let html = '<div class="setup-card"><div class="setup-top"><div><h1>🌊 <span class="grad">' + t('title') + '</span></h1><p class="muted">' + t('net_title') + '</p></div>'
      + '<div class="setup-top-btns">' + soundBtn() + '<button class="btn ghost" data-action="lang">🌐 ' + t('lang_toggle') + '</button></div></div>'
      + '<div class="room-panel"><div class="room-top"><div><div class="small muted">' + t('net_room') + '</div><div class="room-code">' + esc(N.code || '') + '</div></div>'
      + '<div class="room-btns"><span class="net-status s-' + N.status + '">' + statusText() + '</span>'
      + '<button class="btn sm ghost" data-action="net-leave">' + t('net_leave') + '</button></div></div>';
    if (lb) {
      html += '<p class="lead">' + (N.mySeat != null ? t('net_you_seat', { n: N.mySeat + 1 }) : t('net_you_spec')) + '</p>'
        + '<p class="muted">' + t(MT.UI.game ? 'net_next_wait' : 'net_lobby_wait') + '</p>';
    }
    html += copyrightFooter() + '</div>';
    if (lb) {
      const STY = MT.AI.STYLES;
      html += '<h3>' + t('net_players') + '</h3><div class="names">' + lb.seats.map((seat, i) => {
        const label = seat.kind === 'ai' ? STY[seat.style].icon + ' ' + esc(L(STY[seat.style].name))
          : seat.kind === 'net' ? (seat.taken ? '🌐 ' + esc(seat.name) : '⏳ ' + t('net_waiting_seat'))
            : '🏠 ' + esc(seat.name || t('net_host'));
        return '<div class="seat' + (i === N.mySeat ? ' mine' : '') + '"><b>' + (i + 1) + '.</b> ' + label + (i === N.mySeat ? ' <span class="tag good">' + t('net_you') + '</span>' : '') + '</div>';
      }).join('') + '</div>';
      const st = lb.settings;
      html += '<h3>' + t('net_settings') + '</h3><p>' + t('diff_' + st.difficulty) + ' · ' + t('vic_' + st.victory) + ' · '
        + t('len_' + st.length) + ' · ' + t('role_' + st.roleMode) + '</p>';
      if (lb.spectators && lb.spectators.length) html += '<p class="small muted">' + esc(t('net_spectators', { names: lb.spectators.join('、') })) + '</p>';
    }
    $('#setup').innerHTML = html + '</div>';
  }

  function startGame() {
    const s = UI.setup;
    const players = [];
    const STY = MT.AI.STYLES;
    const hosting = MT.Net.mode === 'host';
    for (let i = 0; i < s.count; i++) {
      let ai = s.kinds[i] === 'ai' ? { style: s.styles[i], level: s.aiLevel } : null;
      let name = s.names[i].trim();
      if (s.kinds[i] === 'net') {
        // 網路座位：有人坐就用他的名字，沒人坐就由電腦代替
        const owner = hosting ? MT.Net.seatOwner(i) : null;
        if (owner) name = owner.name;
        else ai = { style: s.styles[i], level: s.aiLevel };
      }
      const fallback = ai ? L(STY[ai.style].name) : t('player_default', { n: i + 1 });
      players.push({ name: name || fallback, ai });
    }
    UI.aiSpeed = s.aiSpeed;
    UI.game = E.createGame({ players, difficulty: s.difficulty, victory: s.victory, length: s.length, customRounds: s.customRounds, roleMode: s.roleMode, seed: s.seed, retire: s.retire !== 'off' });
    UI.viewPlayer = null;
    UI.lastReport = null;
    UI.seenLog = 0;
    saveGame();
    if (hosting) MT.Net.startGame(UI.game);
    renderGame();
    scheduleAI();
  }

  // ── 上方列 ──
  function tilePos(i) {
    if (i <= 6) return [7, 7 - i];
    if (i <= 11) return [7 - (i - 6), 1];
    if (i <= 18) return [1, i - 11];
    return [i - 17, 7];
  }

  function renderTop() {
    const g = UI.game;
    const ri = E.roundInfo(g.round);
    const ph = D.phases[g.macro.phase];
    const recent = g.log.slice(-8).map((e) => esc(t(e.key, e.params))).join('<span class="sep">◆</span>');
    $('#topbar').innerHTML = ''
      + '<div class="brand">🌊 <span class="brand-name">' + t('title') + '</span></div>'
      + '<div class="round">' + t('round_label', ri) + ' <span class="muted">' + t('round_of', { round: g.round, total: g.config.rounds }) + '</span></div>'
      + '<button class="phase-chip" data-action="report" style="--ph:' + ph.color + '">' + ph.icon + ' ' + esc(L(ph.name)) + ' · ' + t('m_rate') + ' ' + g.macro.rate.toFixed(2) + '%</button>'
      + '<button class="btn ghost sm menu-btn" data-action="top-menu" aria-label="menu">' + ($('#topbar').classList.contains('open') ? '✕' : '☰') + '</button>'
      + '<div class="top-btns">'
      + '<button class="btn ghost sm" data-action="report">' + t('rp_btn') + '</button>'
      + '<button class="btn ghost sm" data-action="save-menu">💾 ' + t('sv_btn') + '</button>'
      + '<button class="btn ghost sm" data-action="glossary">' + t('glossary_btn', { n: MT.Gloss.count(), total: MT.Gloss.total() }) + '</button>'
      + '<button class="btn ghost sm" data-action="ach">🏅 ' + MT.Ach.count() + '/' + MT.Ach.total() + '</button>'
      + soundBtn()
      + '<button class="btn ghost sm" data-action="settings" aria-label="settings">⚙️</button>'
      + (MT.Net.mode ? '<span class="net-chip s-' + MT.Net.status + '">🌐 ' + esc(MT.Net.code || '') + (MT.Net.mode === 'host' ? ' · ' + t('net_online', { n: MT.Net.onlineCount() + 1 }) : '') + '</span>'
        + '<span class="emotes">' + MT.Net.EMOTES.map((e) => '<button class="emote" data-action="emote" data-e="' + e + '">' + e + '</button>').join('') + '</span>' : '')
      + '<button class="btn ghost sm" data-action="lang">🌐 ' + t('lang_toggle') + '</button>'
      + (MT.Net.mode === 'client'
        ? '<button class="btn ghost sm" data-action="net-leave">' + t('net_leave') + '</button>'
        : '<button class="btn ghost sm" data-action="new-game">' + t('new_game') + '</button>')
      + '</div>';
    const ticker = $('#ticker');
    if (ticker.dataset.len !== String(g.log.length) || ticker.dataset.lang !== MT.lang) {
      ticker.dataset.len = String(g.log.length);
      ticker.dataset.lang = MT.lang;
      ticker.innerHTML = '<span class="ticker-tag">LIVE</span><div class="ticker-track"><div class="ticker-move">' + recent + '<span class="sep">◆</span>' + recent + '</div></div>';
    }
  }

  function renderPlayers() {
    const g = UI.game;
    $('#players').innerHTML = g.players.map((p) => {
      const prof = profOf(p);
      const cf = C.cashflow(g, p);
      const fr = Math.min(1, C.freedom(g, p));
      const tags = (p.bankrupt ? '<span class="tag bad">' + t('bankrupt_tag') + '</span>' : '')
        + (p.free ? '<span class="tag good">' + t('free_tag') + '</span>' : '');
      return '<button class="pcard' + (p.id === g.current ? ' current' : '') + (p.id === viewId() ? ' viewing' : '') + (p.bankrupt ? ' out' : '') + '" data-action="view" data-id="' + p.id + '" style="--pc:' + p.color + '">'
        + '<div class="pcard-head"><span class="dot"></span><b>' + esc(p.name) + '</b>' + tags + (p.hand.length ? '<span class="hand-n">' + t('hand_count', { n: p.hand.length }) + '</span>' : '') + '</div>'
        + '<div class="muted small">' + prof.icon + ' ' + esc(L(prof.name)) + (p.skill ? ' · ✨' + esc(L(prof.skill.name)) : '') + '</div>'
        + '<div class="pcard-row"><span>' + t('cash') + '</span><b>' + fmt(p.cash) + '</b></div>'
        + '<div class="pcard-row"><span>' + t('monthly_cf') + '</span><b class="' + moneyCls(cf) + '">' + fmt(cf) + '</b></div>'
        + '<div class="pcard-row"><span>' + t('net_worth') + '</span><b>' + fmt(C.netWorth(g, p)) + '</b></div>'
        + '<div class="bar"><div style="width:' + (fr * 100).toFixed(1) + '%"></div></div>'
        + '</button>';
    }).join('');
  }

  // ── 棋盤 ──
  // 擲骰動畫進行中時，棋子顯示在動畫的位置
  function posOf(p) { return UI.anim && UI.anim.pid === p.id ? UI.anim.pos : p.pos; }

  function renderBoard() {
    const g = UI.game;
    const cur = g.players[g.current];
    let html = '';
    D.board.forEach((type, i) => {
      const tt = D.tileTypes[type];
      const [r, c] = tilePos(i);
      const tokens = g.players.filter((p) => posOf(p) === i && !p.bankrupt)
        .map((p) => '<span class="token' + (p.id === g.current ? ' me' : '') + '" style="--pc:' + p.color + '" title="' + esc(p.name) + '">' + profOf(p).icon + '</span>').join('');
      const hop = UI.anim && UI.anim.pos === i && !UI.anim.rolling;
      html += '<button class="tile t-' + tt.color + (posOf(cur) === i ? ' here' : '') + (hop ? ' hop' : '') + (i === 0 ? ' start' : '') + '" style="grid-row:' + r + ';grid-column:' + c + '" data-action="tile" data-type="' + type + '">'
        + '<span class="tile-icon">' + tt.icon + '</span><span class="tile-name">' + esc(L(tt.name)) + '</span>'
        + (tt.milestone ? '<span class="tile-soon">' + tt.milestone + '</span>' : '')
        + '<span class="tokens">' + tokens + '</span></button>';
    });
    html += '<div class="center" id="center"></div>';
    $('#board').innerHTML = html;
    renderCenter();
  }

  function dealCard(card, index, canPick, cash) {
    const mortgage = card.cost - card.down;
    const roi = card.down > 0 ? (card.cashflow * 12) / card.down : 0;
    return '<div class="card deal">'
      + '<div class="card-head"><span class="card-icon">' + card.icon + '</span><b>' + esc(L(card.name)) + '</b></div>'
      + '<div class="kv"><span>' + t('deal_cost') + '</span><b>' + fmt(card.cost) + '</b></div>'
      + '<div class="kv"><span>' + rich({ zh: '[[down_payment|頭期款]] / 投入', en: '[[down_payment|Down payment]] / cost' }) + '</span><b>' + fmt(card.down) + '</b></div>'
      + (mortgage > 0 ? '<div class="kv"><span>' + rich({ zh: '[[mortgage|貸款]]', en: '[[mortgage|Loan]]' }) + '</span><b>' + fmt(mortgage) + '</b></div>' : '')
      + '<div class="kv"><span>' + rich({ zh: '每月[[cashflow]]', en: 'Monthly [[cashflow]]' }) + '</span><b class="pos">+' + fmt(card.cashflow) + '</b></div>'
      + '<div class="kv"><span>' + t('deal_roi') + '</span><b>' + (roi * 100).toFixed(1) + '%</b></div>'
      + '<p class="tip">💡 ' + rich(card.tip) + '</p>'
      + (card.kind === 'realestate' && mortgage > 0 ? '<p class="small risk-note">' + rich(t('deal_float')) + '</p>' : '')
      + (card.kind === 'business' ? '<p class="small risk-note">' + rich(t('deal_biz_risk', { risk: (card.risk || 1).toFixed(1) })) + '</p>' : '')
      + (canPick ? '<button class="btn primary" data-action="choose" data-choice="buy" data-index="' + index + '"' + (cash < card.down ? ' data-short="1"' : '') + '>' + t('buy') + '</button>' : '')
      + '</div>';
  }

  function okBtn() {
    return '<div class="actions"><button class="btn primary" data-action="choose" data-choice="ok">' + t('ok') + '</button></div>';
  }

  function macroMini(m) {
    return '<div class="macro-mini">'
      + '<div><span>' + rich({ zh: '[[cpi|通膨]]', en: '[[cpi|Inflation]]' }) + '</span><b>' + m.cpi.toFixed(1) + '%</b><small>' + t('m_target') + '</small></div>'
      + '<div><span>' + rich({ zh: '[[gdp|GDP]] 成長', en: '[[gdp|GDP]] growth' }) + '</span><b>' + m.gdp.toFixed(1) + '%</b></div>'
      + '<div><span>' + rich({ zh: '[[unemployment|失業率]]', en: '[[unemployment|Unemployment]]' }) + '</span><b>' + m.unemp.toFixed(1) + '%</b></div>'
      + '<div><span>' + rich({ zh: '[[interest_rate|利率]]', en: '[[interest_rate|Rate]]' }) + '</span><b>' + m.rate.toFixed(2) + '%</b></div>'
      + '</div>';
  }

  function chainHtml(ch) {
    MT.Gloss.markExperienced(ch.steps.map((s) => s.p));
    return '<div class="chain"><div class="chain-title">' + ch.icon + ' ' + esc(L(ch.title)) + '</div><ol>'
      + ch.steps.map((s) => '<li>' + rich(s) + (s.p ? ' <span class="principle">' + rich('[[' + s.p + ']]') + '</span>' : '') + '</li>').join('')
      + '</ol></div>';
  }

  function strategyCardHtml(c, extra) {
    return '<div class="scard k-' + c.kind + '">'
      + '<div class="scard-head"><span class="card-icon">' + c.icon + '</span><div><b>' + esc(L(c.name)) + '</b>'
      + '<div class="small">' + t('kind_' + c.kind) + (c.illegal ? ' · <span class="illegal">' + t('illegal_tag') + '</span>' : '') + (c.auto ? ' · ' + t('hand_auto') : '') + '</div></div></div>'
      + '<p class="small">' + esc(L(c.desc)) + '</p>'
      + (extra || '') + '</div>';
  }

  // 交易提案內容（給對方看的摘要）
  function offerHtml(g, pend) {
    const from = g.players[pend.from];
    const to = g.players[pend.to];
    const d = pend.deal;
    if (d.loan) {
      const l = d.loan;
      const lender = l.dir === 'lend' ? from : to;
      const borrower = l.dir === 'lend' ? to : from;
      return '<p>' + esc(t('of_lend', { lender: lender.name, borrower: borrower.name, amount: { money: l.amount }, payment: { money: E.loanPayment(l.amount, l.months, l.rate) }, months: l.months, rate: (l.rate * 100).toFixed(1) + '%' })) + '</p>'
        + '<p class="small muted">' + rich(t('tr_loan_note')) + '</p>';
    }
    const side = (giver, recv, items) => {
      const parts = [];
      if (items.cash) parts.push('💵 ' + fmt(items.cash));
      if (items.asset) {
        const a = giver.assets.find((x) => x.id === items.asset);
        if (a) parts.push(a.icon + ' ' + esc(L(a.name)) + '（+' + fmt(a.cashflow) + t('per_month') + '）');
      }
      if (items.card) parts.push('🃏 ' + esc(L(E.getCard('strategy', items.card).name)));
      return parts.length ? '<div class="offer-side"><b>' + esc(t('of_give', { from: giver.name, to: recv.name })) + '</b> ' + parts.join('、') + '</div>' : '';
    };
    return side(from, to, d.give || {}) + side(to, from, d.get || {});
  }

  function handHtml(g, p) {
    const can = g.phase === 'roll' || g.phase === 'action';
    let html = '<div class="hand"><div class="hand-head"><b>' + t('hand_title', { n: p.hand.length, max: E.HAND_LIMIT }) + '</b>'
      + (g.players.filter((x) => !x.bankrupt).length > 1 && can ? '<button class="btn sm" data-action="trade-open">' + t('trade_btn') + '</button>' : '') + '</div>';
    if (!p.hand.length) return html + '<p class="small muted">' + t('hand_empty') + '</p></div>';
    html += '<div class="hand-cards">' + p.hand.map((id, i) => {
      const c = E.getCard('strategy', id);
      return '<button class="hcard k-' + c.kind + '" data-action="hand-card" data-index="' + i + '"' + (can ? '' : ' disabled') + '>'
        + '<span class="card-icon">' + c.icon + '</span><span>' + esc(L(c.name)) + '</span>'
        + '<small>' + t('kind_' + c.kind) + (c.auto ? ' · ' + t('hand_auto') : '') + '</small></button>';
    }).join('') + '</div>';
    return html + '</div>';
  }

  // ── 出牌視窗 ──
  UI.play = { index: null, target: {} };

  function openPlay(index) {
    const g = UI.game;
    const p = g.players[g.current];
    const id = p.hand[index];
    const c = E.getCard('strategy', id);
    UI.play = { index, target: UI.play.index === index ? UI.play.target : {} };
    const tg = UI.play.target;
    const can = (g.phase === 'roll' || g.phase === 'action') && !c.auto;
    let pick = '';
    const chip = (key, val, label, on) => '<button class="chip' + (on ? ' on' : '') + '" data-action="play-target" data-key="' + key + '" data-val="' + val + '">' + label + '</button>';
    const opponents = g.players.filter((x) => x !== p && !x.bankrupt);
    if (c.target === 'stock') {
      pick = '<h3>' + t('pick_stock') + '</h3><div class="chips">' + M.available(g).filter((i) => i.type === 'stock')
        .map((i) => chip('inst', i.id, i.icon + ' ' + esc(L(i.name)), tg.inst === i.id)).join('') + '</div>';
    } else if (c.target === 'sector') {
      const used = {};
      M.available(g).forEach((i) => { if (D.sectors[i.sector]) used[i.sector] = true; });
      pick = '<h3>' + t('pick_sector') + '</h3><div class="chips">' + Object.keys(used).map((s) => chip('sector', s, esc(L(D.sectors[s])), tg.sector === s)).join('') + '</div>';
    } else if (c.target === 'player' || c.target === 'asset') {
      pick = '<h3>' + t('pick_player') + '</h3><div class="chips">' + opponents.map((x) => chip('player', x.id, esc(x.name), tg.player === x.id)).join('') + '</div>';
      if (c.target === 'asset' && tg.player != null) {
        const t2 = g.players[tg.player];
        const list = t2.assets.filter((a) => a.kind !== 'loan');
        pick += '<h3>' + t('pick_asset') + '</h3>' + (list.length
          ? '<div class="chips">' + list.map((a) => chip('asset', a.id, a.icon + ' ' + esc(L(a.name)) + '（' + fmt(E.takeoverPrice(a)) + '）', tg.asset === a.id)).join('') + '</div>'
          : '<p class="small muted">' + t('no_target_asset') + '</p>');
        const a = list.find((x) => x.id === tg.asset);
        if (a) pick += '<p class="small">' + esc(t('takeover_cost', { amount: { money: E.takeoverPrice(a) } })) + '</p>';
      }
    }
    const ready = !c.target
      || (c.target === 'stock' && tg.inst) || (c.target === 'sector' && tg.sector)
      || (c.target === 'player' && tg.player != null) || (c.target === 'asset' && tg.asset);
    UI.modal('<h2>' + c.icon + ' ' + esc(L(c.name)) + '</h2>'
      + strategyCardHtml(c, '<p class="tip">' + t('card_lesson') + '：' + rich(c.lesson) + '</p>')
      + (can ? pick + '<div class="actions"><button class="btn primary" data-action="play-confirm"' + (ready ? '' : ' disabled') + '>' + t('play_confirm') + '</button></div>' : ''),
    'small-modal play-modal');
    MT.Gloss.flushUnlocks();
  }

  function showPlayResult(res) {
    const g = UI.game;
    const c = E.getCard('strategy', res.card);
    let body = '';
    if (res.caught) body += '<p class="note bad">' + esc(t('res_caught', { amount: { money: res.fine } })) + '</p>';
    if (res.blocked) body += '<p class="note bad">' + esc(t('res_blocked_' + res.blocked, { target: g.players[res.target].name })) + '</p>';
    if (!res.caught && !res.blocked) {
      if (res.inst) body += '<p>' + esc(t('res_stock', { inst: M.byId[res.inst].name, pct: Math.round(-res.pct * 100) + '%' })) + '</p>';
      if (res.profit) body += '<p class="note good">' + esc(t('res_profit', { amount: { money: res.profit } })) + '</p>';
      if (res.sector) body += '<p>' + esc(t('res_sector', { sector: D.sectors[res.sector] })) + '</p>';
      if (res.factor) body += '<p>' + esc(t('res_poach', { target: g.players[res.target].name, pct: Math.round(res.factor * 100) + '%' })) + '</p>';
      if (res.asset) body += '<p class="note good">' + esc(t('res_takeover', { target: g.players[res.target].name, asset: res.asset, amount: { money: res.pay } })) + '</p>';
      if (res.card === 'insider') {
        body += '<p class="note">' + esc(res.world ? t('res_world', { card: E.getCard('world', res.world).name }) : t('res_world_none')) + '</p><p class="small muted">' + t('res_secret') + '</p>';
      }
      if (res.card === 'research') {
        const ph = D.phases[res.phase];
        body += '<p class="note">' + esc(t('res_phase', { phase: ph.name })) + ' ' + ph.icon + '</p><p class="small">' + rich(ph.desc) + '</p><p class="small muted">' + t('res_secret') + '</p>';
      }
      if (res.card === 'hedge') body += '<p class="note good">' + t('res_hedge') + '</p>';
      if (res.impacts) {
        const imp = res.impacts.filter((x) => x.delta !== 0);
        body += '<div class="small"><b>' + t('res_impact') + '</b>：' + (imp.length
          ? imp.map((x) => esc(g.players[x.id].name) + ' <b class="' + moneyCls(x.delta) + '">' + fmt(x.delta) + '</b>').join('、') : t('news_none')) + '</div>';
      }
    }
    UI.modal('<h2>' + t('res_title') + '</h2><h3>' + c.icon + ' ' + esc(L(c.name)) + '</h3>' + body
      + '<p class="tip">' + t('card_lesson') + '：' + rich(c.lesson) + '</p>'
      + '<div class="actions"><button class="btn primary" data-action="close-modal">' + t('ok') + '</button></div>', 'small-modal');
    MT.Gloss.flushUnlocks();
  }

  // ── 自訂售價出售資產 ──
  UI.sell = null;

  function openSell(id) {
    const g = UI.game;
    const p = g.players[g.current];
    const a = p.assets.find((x) => x.id === id);
    if (!a) { UI.closeModal(); return; }
    if (!UI.sell || UI.sell.id !== id) UI.sell = { id, price: E.assetValue(a) };
    const v = E.assetValue(a);
    const chips = [0.85, 0.95, 1, 1.1, 1.2].map((r) => '<button class="chip" data-action="sell-pct" data-val="' + r + '">' + Math.round(r * 100) + '%</button>').join('');
    UI.modal('<h2>🏷️ ' + t('sell_title') + '：' + a.icon + ' ' + esc(L(a.name)) + '</h2>'
      + '<div class="sell-facts">'
      + '<div class="srow"><span>' + t('sell_value') + '</span><b>' + fmt(v) + '</b></div>'
      + '<div class="srow"><span>' + t('sell_cost') + '</span><b>' + fmt(a.cost) + '</b></div>'
      + (a.mortgage > 0 ? '<div class="srow"><span>' + rich(t('sell_mortgage')) + '</span><b>' + fmt(-a.mortgage) + '</b></div>' : '')
      + '</div>'
      + '<label class="sell-price">' + t('sell_price') + '<input type="number" min="10000" step="10000" class="sell-input" value="' + UI.sell.price + '"></label>'
      + '<div class="chips">' + chips + '</div>'
      + '<div class="sell-quote"></div>'
      + '<p class="small muted">' + rich(t('sell_note')) + '</p>'
      + '<div class="actions"><button class="btn primary" data-action="sell-confirm">' + t('sell_btn') + '</button></div>', 'small-modal');
    updateSellQuote();
    MT.Gloss.flushUnlocks();
  }

  // 開價變動時即時更新試算（不重畫整個視窗，避免輸入框失焦）
  function updateSellQuote() {
    const g = UI.game;
    const p = g.players[g.current];
    const a = UI.sell && p.assets.find((x) => x.id === UI.sell.id);
    const box = document.querySelector('.sell-quote');
    if (!a || !box) return;
    const price = Math.max(0, Math.round(Number(UI.sell.price) || 0));
    const q = E.saleQuote(a, price, g.round);
    const chance = E.saleChance(g, a, price);
    const cls = chance >= 0.7 ? 'pos' : chance >= 0.3 ? '' : 'neg';
    box.innerHTML = '<div class="srow"><span>' + t('sell_fee', { rate: Math.round(E.SALE_FEE[a.kind] * 100) }) + '</span><b>' + fmt(-q.fee) + '</b></div>'
      + (a.kind === 'realestate' ? '<div class="srow"><span>' + rich(t('sell_tax', { rate: Math.round(E.landTaxRate(a, g.round) * 100), q: g.round - (a.bought || 0) })) + '</span><b>' + fmt(-q.tax) + '</b></div>' : '')
      + '<div class="srow total"><span>' + t('sell_net') + '</span><b class="' + moneyCls(q.net) + '">' + fmt(q.net) + '</b></div>'
      + '<div class="srow"><span>' + rich(t('sell_gain')) + '</span><b class="' + moneyCls(q.gain) + '">' + fmt(q.gain) + '</b></div>'
      + '<div class="srow"><span>' + t('sell_chance') + '</span><b class="' + cls + '">' + Math.round(chance * 100) + '%</b></div>'
      + '<div class="bar"><div style="width:' + Math.round(chance * 100) + '%"></div></div>'
      + (a.cashflow > 0 ? '<p class="small muted">' + esc(t('sell_cashflow', { amount: { money: a.cashflow } })) + '</p>' : '')
      + (q.net < 0 ? '<p class="note">' + esc(t('sell_pay', { amount: { money: -q.net } })) + '</p>' : '');
    MT.Gloss.flushUnlocks();
  }

  // ── 玩家交易視窗 ──
  UI.tr = null;

  function openTrade() {
    const g = UI.game;
    const p = g.players[g.current];
    const others = g.players.filter((x) => x !== p && !x.bankrupt);
    if (!UI.tr || !others.some((x) => x.id === UI.tr.to)) {
      UI.tr = { to: others[0].id, mode: 'swap', give: { cash: 0, asset: '', card: '' }, get: { cash: 0, asset: '', card: '' }, loan: { dir: 'lend', amount: 100000, months: 12, rate: 0.01 } };
    }
    const tr = UI.tr;
    const to = g.players[tr.to];
    const sel = (side, key, list, val) => '<select data-tr="' + side + '.' + key + '"><option value="">' + t('tr_none') + '</option>'
      + list.map((o) => '<option value="' + o.v + '"' + (o.v === val ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('') + '</select>';
    const assetsOf = (x) => x.assets.filter((a) => a.kind !== 'loan').map((a) => ({ v: a.id, label: a.icon + ' ' + L(a.name) + '（+' + fmt(a.cashflow) + t('per_month') + '）' }));
    const cardsOf = (x) => x.hand.filter((id, i, arr) => arr.indexOf(id) === i).map((id) => ({ v: id, label: E.getCard('strategy', id).icon + ' ' + L(E.getCard('strategy', id).name) }));
    const sideHtml = (side, who, label) => '<div class="tr-side"><h3>' + label + '</h3>'
      + '<label>' + t('tr_cash') + '<input type="number" min="0" step="10000" data-tr="' + side + '.cash" value="' + (tr[side].cash || 0) + '"></label>'
      + '<label>' + t('tr_asset') + sel(side, 'asset', assetsOf(who), tr[side].asset) + '</label>'
      + '<label>' + t('tr_card') + sel(side, 'card', cardsOf(who), tr[side].card) + '</label></div>';

    let body;
    if (tr.mode === 'swap') {
      body = '<div class="tr-cols">' + sideHtml('give', p, t('tr_give')) + sideHtml('get', to, t('tr_get') + '（' + esc(to.name) + '）') + '</div>';
    } else {
      const l = tr.loan;
      const pay = E.loanPayment(l.amount, l.months, l.rate);
      body = '<div class="chips">'
        + ['lend', 'borrow'].map((d) => '<button class="chip' + (l.dir === d ? ' on' : '') + '" data-action="tr-set" data-key="loan.dir" data-val="' + d + '">' + t('tr_dir_' + d) + '</button>').join('') + '</div>'
        + '<div class="tr-cols"><label>' + t('tr_amount') + '<input type="number" min="10000" step="10000" data-tr="loan.amount" value="' + l.amount + '"></label>'
        + '<label>' + t('tr_months') + '<select data-tr="loan.months">' + [12, 24, 36].map((m) => '<option value="' + m + '"' + (l.months === m ? ' selected' : '') + '>' + m + '</option>').join('') + '</select></label>'
        + '<label>' + t('tr_rate') + '<select data-tr="loan.rate">' + [0.005, 0.01, 0.015, 0.02].map((r) => '<option value="' + r + '"' + (l.rate === r ? ' selected' : '') + '>' + (r * 100).toFixed(1) + '%</option>').join('') + '</select></label></div>'
        + '<p class="note">' + esc(t('tr_payment', { payment: { money: pay }, months: l.months, total: { money: pay * l.months }, interest: { money: pay * l.months - l.amount } })) + '</p>'
        + '<p class="small muted">' + rich(t('tr_loan_note')) + '</p>';
    }
    UI.modal('<h2>' + t('tr_title') + '</h2>'
      + '<h3>' + t('tr_partner') + '</h3><div class="chips">' + others.map((x) => '<button class="chip' + (x.id === tr.to ? ' on' : '') + '" data-action="tr-set" data-key="to" data-val="' + x.id + '">' + esc(x.name) + '</button>').join('') + '</div>'
      + '<div class="chips mode">' + ['swap', 'loan'].map((m) => '<button class="chip' + (tr.mode === m ? ' on' : '') + '" data-action="tr-set" data-key="mode" data-val="' + m + '">' + t('tr_' + m) + '</button>').join('') + '</div>'
      + body
      + '<div class="actions"><button class="btn primary" data-action="tr-send">' + t('tr_send') + '</button></div>', 'trade-modal');
    MT.Gloss.flushUnlocks();
  }

  function sendTrade() {
    const tr = UI.tr;
    const clean = (s) => ({ cash: Math.max(0, Math.round(Number(s.cash) || 0)), asset: s.asset || null, card: s.card || null });
    const deal = tr.mode === 'loan'
      ? { loan: { dir: tr.loan.dir, amount: Math.round(Number(tr.loan.amount) || 0), months: Number(tr.loan.months), rate: Number(tr.loan.rate) } }
      : { give: clean(tr.give), get: clean(tr.get) };
    UI.tr = null;
    UI.closeModal();
    act({ type: 'OFFER', to: tr.to, deal });
  }

  function renderPending(g, p) {
    const pend = g.pending;
    switch (pend.type) {
      case 'deal': {
        const cards = pend.cards.map((id) => E.getCard(pend.deck, id));
        const short = cards.every((c) => p.cash < c.down);
        return (cards.length > 1 ? '<p class="note">✨ ' + t('pick_one') + '</p>' : '')
          + '<div class="cards">' + cards.map((c, i) => dealCard(c, i, true, p.cash)).join('') + '</div>'
          + (short ? '<p class="note">🏦 ' + t('need_loan_hint') + '</p>' : '')
          + '<div class="actions"><button class="btn" data-action="choose" data-choice="pass">' + t('pass') + '</button>'
          + (pend.deck === 'big' && g.players.length > 1 ? '<button class="btn" data-action="choose" data-choice="auction">' + t('au_auction_btn') + '</button>' : '')
          + '</div>';
      }
      case 'doodad': {
        const card = E.getCard('doodad', pend.card);
        const cost = E.doodadCost(p, card);
        if (pend.insured) {
          const msg = pend.insured === 'policy'
            ? rich(t('claim_policy', { policy: t('pol_' + card.cover) }))
            : rich({ zh: '☂️ [[insurance|保險]]卡發動：這筆意外支出由保險公司支付，你不用付錢。', en: '☂️ [[insurance|Insurance]] card used: the insurer pays this accident, so you pay nothing.' });
          return '<div class="card doodad"><div class="card-head"><span class="card-icon">' + card.icon + '</span><b>' + esc(L(card.name)) + '</b></div>'
            + '<div class="big-num"><s class="muted">' + fmt(-cost.amount) + '</s> → NT$0</div>'
            + '<p class="note good">' + msg + '</p></div>' + okBtn();
        }
        const coverTip = card.cover ? '<p class="small muted">' + rich(t('claim_could', { policy: t('pol_' + card.cover) })) + '</p>' : '';
        return '<div class="card doodad"><div class="card-head"><span class="card-icon">' + card.icon + '</span><b>' + esc(L(card.name)) + '</b></div>'
          + '<div class="big-num neg">' + fmt(-cost.amount) + '</div>'
          + (p.skill === 'factory' ? '<p class="note">✨ −30%</p>' : '')
          + '<p class="tip">💡 ' + rich(card.tip) + '</p>' + coverTip + '</div>'
          + '<div class="actions"><button class="btn primary" data-action="choose" data-choice="pay">' + t('pay_now') + '</button>'
          + (card.installment
            ? '<button class="btn" data-action="choose" data-choice="installment">💳 ' + t('pay_install') + '<small>' + t('install_detail', { payment: { money: cost.payment }, months: card.installment.months, total: { money: cost.payment * card.installment.months } }) + '</small></button>'
            : '')
          + (cost.amount >= 3000 ? '<button class="btn warn" data-action="choose" data-choice="card">🔁 ' + t('card_btn') + '<small>' + t('card_detail', { min: { money: Math.max(1000, Math.round(cost.amount * 0.03)) }, apr: Math.round(E.CARD_APR * 100) }) + '</small></button>' : '')
          + '</div>' + (cost.amount >= 3000 ? '<p class="small muted">' + rich(t('card_note')) + '</p>' : '');
      }
      case 'life': {
        const card = E.getCard('life', pend.card);
        return '<div class="card life"><div class="card-head"><span class="card-icon">' + card.icon + '</span><b>' + esc(L(card.name)) + '</b></div>'
          + '<p>' + rich(card.desc) + '</p>'
          + (pend.note ? '<p class="note good">' + rich(t(pend.note, { policy: card.cover ? t('pol_' + card.cover) : '' })) + '</p>' : '')
          + (!pend.note && card.cover ? '<p class="small muted">' + rich(t('claim_could', { policy: t('pol_' + card.cover) })) + '</p>' : '')
          + '</div>' + okBtn();
      }
      case 'scamReveal': {
        const cards = pend.cards.map((id) => E.getCard(pend.deck, id));
        return cards.map((c) => '<div class="card scam"><div class="card-head"><span class="card-icon">🚨</span><b>' + t('scam_title') + '</b></div>'
          + '<p><b>' + c.icon + ' ' + esc(L(c.name)) + '</b></p>'
          + '<p class="note good">' + t('scam_dodged') + '</p>'
          + '<p>' + rich(c.reveal) + '</p></div>').join('') + okBtn();
      }
      case 'quiz':
      case 'quizResult': {
        const q = E.getCard('quiz', pend.q);
        const done = pend.type === 'quizResult';
        const opts = q.options.map((o, i) => {
          let cls = 'opt';
          if (done && i === q.answer) cls += ' right';
          else if (done && i === pend.picked) cls += ' wrong';
          return '<button class="' + cls + '"' + (done ? ' disabled' : ' data-action="choose" data-choice="answer" data-index="' + i + '"') + '>'
            + String.fromCharCode(65 + i) + '. ' + esc(L(o)) + '</button>';
        }).join('');
        let result = '';
        if (done) {
          const answer = String.fromCharCode(65 + q.answer) + '. ' + L(q.options[q.answer]);
          const msg = pend.correct
            ? t('quiz_right', { amount: { money: pend.reward } })
            : pend.reward > 0 ? t('quiz_wrong_teacher', { answer, amount: { money: pend.reward } }) : t('quiz_wrong', { answer });
          const cardMsg = pend.correct
            ? (pend.card ? t('quiz_card', { card: E.getCard('strategy', pend.card).name }) : t('quiz_card_full'))
            : '';
          result = '<p class="note ' + (pend.correct ? 'good' : 'bad') + '">' + esc(msg) + (cardMsg ? '<br>' + esc(cardMsg) : '') + '</p><p class="tip">💡 ' + rich(q.explain) + '</p>' + okBtn();
        }
        return '<div class="card quiz"><div class="card-head"><b>' + t('quiz_title') + '</b></div><p class="q">' + esc(L(q.q)) + '</p><div class="opts">' + opts + '</div>' + result + '</div>';
      }
      case 'news': {
        const card = E.getCard('market', pend.card);
        const affected = D.instruments.filter((i) => Object.keys(card.effect.shocks).some((k) => k === i.id || k === 'sector:' + i.sector || (k === 'tw' && i.ccy === 'TWD' && i.type !== 'deposit')))
          .filter((i) => M.isTradable(g, i.id));
        const impacts = pend.impacts.filter((x) => x.delta !== 0);
        return '<div class="card news"><div class="card-head"><span class="card-icon">' + card.icon + '</span><b>' + esc(L(card.name)) + '</b></div>'
          + '<div class="small muted">' + t('news_affected') + '：' + affected.map((i) => i.icon + ' ' + esc(L(i.name)) + ' <b class="' + moneyCls(g.market.intra[i.id] && g.market.intra[i.id].news) + '">' + pct((g.market.intra[i.id] && g.market.intra[i.id].news) || 0, 0) + '</b>').join('、') + '</div>'
          + '<p class="tip">💡 ' + rich(card.tip) + '</p>'
          + '<div class="small"><b>' + t('news_impact') + '</b>：' + (impacts.length
            ? impacts.map((x) => esc(g.players[x.id].name) + ' <b class="' + moneyCls(x.delta) + '">' + fmt(x.delta) + '</b>').join('、')
            : t('news_none')) + '</div>'
          + '</div>' + okBtn();
      }
      case 'cb':
        return '<div class="card cb"><div class="card-head"><b>' + t('cb_title') + '</b></div>'
          + macroMini(g.macro)
          + '<p>' + t('cb_ask', { amount: { money: E.CB_REWARD } }) + '</p>'
          + '<p class="small muted">' + rich({ zh: '提示：[[p_brake|通膨高於 2% → 傾向升息]]；[[p_accel|景氣差、失業高 → 傾向降息]]。', en: 'Hint: [[p_brake|inflation above 2% → likely hike]]; [[p_accel|weak growth, high unemployment → likely cut]].' }) + '</p>'
          + '<div class="actions"><button class="btn" data-action="choose" data-choice="hike">' + t('cb_hike') + '</button>'
          + '<button class="btn" data-action="choose" data-choice="hold">' + t('cb_hold') + '</button>'
          + '<button class="btn" data-action="choose" data-choice="cut">' + t('cb_cut') + '</button></div></div>';
      case 'cbResult': {
        const b = pend.before;
        const vals = { cpi: b.cpi.toFixed(1), gdp: b.gdp.toFixed(1), unemp: b.unemp.toFixed(1) };
        let why = t('cb_why_hold');
        if (pend.actual === 'hike') why = t(b.cpi > 2.2 ? 'cb_why_hike' : 'cb_why_hike_gdp', vals);
        if (pend.actual === 'cut') why = t(b.gdp < 2.5 || b.unemp > 4.5 ? 'cb_why_cut' : 'cb_why_cut_cpi', vals);
        const principle = pend.actual === 'hike' ? 'p_brake' : pend.actual === 'cut' ? 'p_accel' : 'p_cycle';
        return '<div class="card cb"><div class="card-head"><b>' + t('cb_title') + '</b></div>'
          + '<div class="big-num">' + esc(t('cb_result_' + pend.actual, { x: Math.abs(pend.decision).toFixed(2) })) + '</div>'
          + '<p class="note ' + (pend.correct ? 'good' : 'bad') + '">' + esc(pend.correct ? t('cb_right', { amount: { money: pend.reward } }) : t('cb_wrong')) + '</p>'
          + '<p class="tip">💡 ' + esc(why) + ' ' + rich('[[' + principle + ']]') + '</p>'
          + (pend.actual !== 'hold' ? '<p class="small muted">' + t('cb_effect') + '</p>' : '')
          + '</div>' + okBtn();
      }
      case 'geo': {
        const card = E.getCard('geo', pend.card);
        const impacts = pend.impacts.filter((x) => x.delta !== 0);
        return '<div class="card geo"><div class="card-head"><span class="card-icon">' + card.icon + '</span><div><div class="small muted">' + t('geo_title') + ' · ' + (card.real ? t('rp_real', { year: card.year }) : t('rp_fiction')) + '</div><b>' + esc(L(card.name)) + '</b></div></div>'
          + '<p>' + rich(card.trivia) + '</p>'
          + chainHtml({ icon: '💡', title: { zh: '為什麼市場會這樣反應？', en: 'Why does the market react this way?' }, steps: card.chain })
          + (card.effect.freeze ? '<p class="note bad">' + Object.keys(card.effect.freeze).map((id) => M.byId[id].icon + ' ' + esc(L(M.byId[id].name))).join('、') + '：' + t('frozen_until', { round: g.market.frozen[Object.keys(card.effect.freeze)[0]] }) + '</p>' : '')
          + '<div class="small"><b>' + t('news_impact') + '</b>：' + (impacts.length
            ? impacts.map((x) => esc(g.players[x.id].name) + ' <b class="' + moneyCls(x.delta) + '">' + fmt(x.delta) + '</b>').join('、')
            : t('news_none')) + '</div>'
          + '</div>' + okBtn();
      }
      case 'exchange': {
        const card = pend.card ? E.getCard('strategy', pend.card) : null;
        return '<div class="card"><div class="card-head"><span class="card-icon">🤝</span><b>' + t('exchange_title') + '</b></div>'
          + (card ? '<p class="note good">' + esc(t('exchange_got', { card: card.name })) + '</p>' + strategyCardHtml(card) : '<p class="note">' + t('exchange_full') + '</p>')
          + '<p class="small muted">' + t('exchange_hint') + '</p></div>' + okBtn();
      }
      case 'auction': {
        const card = E.getCard(pend.deck, pend.card);
        const bidder = g.players[pend.turn];
        const min = E.minBid(pend);
        const opts = [min, Math.ceil((min * 1.1) / 10000) * 10000, Math.ceil((min * 1.25) / 10000) * 10000]
          .filter((v, i, arr) => arr.indexOf(v) === i);
        const roi = (card.cashflow * 12) / min;
        return '<p class="note">' + t('au_title') + '</p>'
          + '<div class="cards">' + dealCard(card, 0, false, 0) + '</div>'
          + '<div class="au-box"><div><span class="muted small">' + t('au_current') + '</span><div class="big-num">' + fmt(pend.bid) + '</div>'
          + '<div class="small">' + (pend.leader != null ? esc(t('au_leader', { name: g.players[pend.leader].name })) : t('au_none')) + '</div></div>'
          + '<div class="au-turn" style="--pc:' + bidder.color + '"><span class="dot"></span>' + esc(t('au_turn', { name: bidder.name })) + '</div></div>'
          + '<p class="small">' + esc(t('au_roi', { roi: (roi * 100).toFixed(1) + '%' })) + ' · ' + rich(t('au_tip')) + '</p>'
          + '<div class="small muted">' + esc(t('od_cash', { cash: { money: bidder.cash } })) + '</div>'
          + '<div class="actions">' + opts.map((v) => '<button class="btn primary" data-action="choose" data-choice="bid" data-amount="' + v + '"' + (bidder.cash < v ? ' disabled' : '') + '>' + t('au_bid', { amount: { money: v } }) + '</button>').join('')
          + '<button class="btn" data-action="choose" data-choice="fold">' + t('au_fold') + '</button></div>';
      }
      case 'auctionResult': {
        const card = E.getCard(pend.deck, pend.card);
        return '<div class="card"><div class="card-head"><span class="card-icon">🔨</span><b>' + esc(L(card.name)) + '</b></div>'
          + (pend.winner != null
            ? '<p class="note good">' + esc(t('au_win', { name: g.players[pend.winner].name, amount: { money: pend.price } })) + '</p>'
              + '<p class="small">' + esc(t('au_roi', { roi: ((card.cashflow * 12 / pend.price) * 100).toFixed(1) + '%' })) + '</p>'
            : '<p class="note">' + t('au_nobody') + '</p>')
          + '</div>' + okBtn();
      }
      case 'offer': {
        const from = g.players[pend.from];
        const to = g.players[pend.to];
        return '<div class="card offer"><div class="card-head"><b>' + t('of_title') + '</b></div>'
          + '<p><b>' + esc(t('of_from', { from: from.name, to: to.name })) + '</b></p>'
          + offerHtml(g, pend)
          + '<div class="au-turn" style="--pc:' + to.color + '"><span class="dot"></span>' + esc(t('of_pass', { name: to.name })) + '</div>'
          + '</div><div class="actions"><button class="btn primary" data-action="choose" data-choice="accept">' + t('of_accept') + '</button>'
          + '<button class="btn" data-action="choose" data-choice="decline">' + t('of_decline') + '</button></div>';
      }
      case 'offerResult':
        return '<div class="card"><div class="card-head"><b>' + t('of_title') + '</b></div><p class="note ' + (pend.accepted ? 'good' : 'bad') + '">'
          + esc(pend.accepted ? t('of_accepted') : pend.error ? t('of_failed', { error: t('err_' + pend.error) }) : t('of_declined')) + '</p></div>' + okBtn();
      case 'cbDone':
        return '<div class="card"><div class="card-head"><span class="card-icon">🏦</span><b>' + t('cb_title') + '</b></div><p>' + t('cb_done') + '</p></div>' + okBtn();
      case 'tile': {
        const tt = D.tileTypes[pend.tile];
        const bill = pend.tax
          ? '<div class="tax-bill">' + pend.tax.items.map((x) => '<div class="srow"><span>' + rich(t(x.key)) + '<small class="muted"> · ' + fmt(x.base) + '</small></span><b>' + fmt(-x.tax) + '</b></div>').join('')
            + '<div class="srow total"><span>' + t('tx_total') + '</span><b>' + fmt(-pend.tax.total) + '</b></div>'
            + '<p class="small muted">' + rich(t('tx_note', { rate: Math.round(pend.tax.bracket * 100) })) + '</p></div>'
          : '';
        return '<div class="card"><div class="card-head"><span class="card-icon">' + tt.icon + '</span><b>' + esc(L(tt.name)) + '</b></div>'
          + (pend.params ? '<p class="note">' + t('tax_body', pend.params) + '</p>' : '') + bill
          + '<p>' + rich(tt.desc) + '</p>'
          + (tt.milestone ? '<p class="note">' + t('coming_soon', { m: tt.milestone }) + '</p>' : '')
          + '</div>' + okBtn();
      }
    }
    return '';
  }

  function renderCenter() {
    const g = UI.game;
    const p = g.players[g.current];
    const prof = profOf(p);
    const faces = FACES;
    const actor = MT.AI.actorOf(g);
    const aiTurn = !!actor && !isMine(actor) && g.phase !== 'gameover';
    const hand = !isMine(p) ? (p.hand.length ? '<p class="small muted">' + t('hand_hidden', { n: p.hand.length }) + '</p>' : '') : handHtml(g, p);
    let body = '';
    if (aiTurn) body = '<div class="ai-thinking" style="--pc:' + actor.color + '"><span class="dot"></span>' + esc(t(actor.ai ? 'ai_thinking' : 'net_waiting', { name: actor.name })) + '</div>';
    if (g.phase === 'roll') {
      body += aiTurn ? hand : '<div class="actions"><button class="btn primary big" data-action="roll">' + t('roll') + '</button></div>' + hand;
    } else if (g.phase === 'resolve') {
      body += renderPending(g, p);
    } else if (g.phase === 'action') {
      body += aiTurn ? hand : '<div class="actions"><button class="btn primary big" data-action="end-turn">' + t('end_turn') + '</button></div>' + hand;
    }
    if (UI.anim) {
      body = '<div class="roll-stage"><div class="big-die' + (UI.anim.rolling ? ' rolling' : '') + '">' + faces[UI.anim.face] + '</div><div class="muted">' + (UI.anim.rolling ? t('rolling') : t('rolled', { n: UI.anim.face })) + '</div></div>';
    }
    $('#center').classList.toggle('ai-turn', aiTurn);
    const key = g.phase + ':' + g.current + ':' + g.round + ':' + (g.pending ? g.pending.type + (g.pending.card || g.pending.q || '') + (g.pending.turn != null ? g.pending.turn : '') : '');
    const enter = !UI.anim && key !== UI.centerKey && g.phase === 'resolve';
    if (!UI.anim) UI.centerKey = key;
    const turnLog = g.log.slice(g.turnLogStart).filter((e) => e.key !== 'log_round')
      .map((e) => '<li>' + esc(t(e.key, e.params)) + '</li>').join('');
    // 真人回合：列出上次真人行動後，其他玩家（電腦）做了什麼
    let others = '';
    if (!aiTurn && UI.seenLog < g.turnLogStart) {
      const list = g.log.slice(UI.seenLog, g.turnLogStart).filter((e) => e.key !== 'log_round' && e.key !== 'log_tile').slice(-25);
      if (list.length) {
        others = '<details class="turn-log others" open><summary>' + t('others_log') + '</summary><ul>'
          + list.map((e) => '<li' + (e.key === 'log_ai' ? ' class="ai-line"' : '') + '>' + esc(t(e.key, e.params)) + '</li>').join('') + '</ul></details>';
      }
    }
    $('#center').innerHTML = ''
      + '<div class="turn-head" style="--pc:' + p.color + '"><span class="dot"></span><b>' + esc(t('turn_of', { name: p.name })) + '</b>'
      + '<span class="muted small">' + prof.icon + ' ' + esc(L(prof.name)) + '</span>'
      + (g.lastRoll && !UI.anim ? '<span class="die roll-' + g.lastRoll + '">' + faces[g.lastRoll] + '</span>' : '') + '</div>'
      + '<div class="center-body' + (enter ? ' enter' : '') + '">' + body + '</div>'
      + (turnLog && !UI.anim ? '<details class="turn-log" open><summary>' + t('this_turn') + '</summary><ul>' + turnLog + '</ul></details>' : '') // 動畫中先不顯示，避免爆雷
      + (UI.anim ? '' : others);
  }

  function viewId() {
    const g = UI.game;
    return UI.viewPlayer == null ? g.current : UI.viewPlayer;
  }

  // ── 右側：財報 / 市場 ──
  function renderRight() {
    const tabs = '<div class="rtabs">'
      + ['statement', 'market'].map((k) => '<button class="rtab' + (UI.rightTab === k ? ' on' : '') + '" data-action="rtab" data-tab="' + k + '">' + t('tab_' + k) + '</button>').join('')
      + '</div>';
    $('#statement').innerHTML = tabs + (UI.rightTab === 'market' ? marketHtml() : statementHtml());
  }

  function statementHtml() {
    const g = UI.game;
    const p = g.players[viewId()];
    const isCur = p.id === g.current && g.phase !== 'gameover' && isMine(p);
    const prof = profOf(p);
    const row = (label, val, cls, extra) => '<div class="srow ' + (cls || '') + '"><span>' + label + '</span><b>' + val + '</b>' + (extra || '') + '</div>';
    const passive = C.passive(g, p);
    const expenses = C.expenses(p);
    const cf = C.cashflow(g, p);
    const fr = C.freedom(g, p);
    const divs = M.incomeLines(g, p);

    let html = '<div class="st-head"><h2>' + t('statement') + '</h2><span class="muted small">' + esc(t('viewing', { name: p.name })) + '</span></div>';
    if (p.skill) html += '<p class="skill">✨ ' + t('skill') + '：<b>' + esc(L(prof.skill.name)) + '</b> — ' + esc(L(prof.skill.desc)) + '</p>';
    if (p.prof === 'sales') html += '<p class="muted small">💼 ' + t('sales_note') + '</p>';
    html += goalHtml(g, p) + healthHtml(g, p);

    html += '<section class="st-block"><h3>' + rich({ zh: '[[cashflow|損益表]]（每月）', en: 'Income statement ([[cashflow|monthly]])' }) + '</h3>'
      + row(rich({ zh: '薪資（[[active_income]]）', en: 'Salary ([[active_income]])' }), fmt(p.salary))
      + row(rich({ zh: '[[passive_income]]', en: '[[passive_income]]' }), fmt(passive), 'pos');
    p.assets.forEach((a) => { html += row('<span class="indent">' + a.icon + ' ' + esc(L(a.name)) + '</span>', '+' + fmt(a.cashflow), 'sub'); });
    divs.forEach((d) => { html += row('<span class="indent">' + M.byId[d.id].icon + ' ' + esc(L(M.byId[d.id].name)) + '</span>', '+' + fmt(d.monthly), 'sub'); });
    if (p.retired) html += row(rich({ zh: '退休金（[[labor_insurance|勞保年金]]＋[[labor_pension|勞退]]）', en: 'Pension ([[labor_insurance|state]] + [[labor_pension|account]])' }), fmt(C.pensionIncome(p)), 'pos');
    html += row(t('total_income'), fmt(C.income(g, p)), 'total')
      + row(rich({ zh: '生活費（隨[[inflation|通膨]]上升）', en: 'Living costs (rise with [[inflation]])' }), fmt(-p.living), 'neg')
      + row(rich({ zh: '[[tax|稅]]', en: '[[tax|Taxes]]' }), fmt(-p.tax), 'neg');
    if (p.children) html += row(t('children_cost', { n: p.children }), fmt(-C.childCost(p)), 'neg');
    p.liabilities.forEach((l) => { html += row(esc(L(l.name)), fmt(-l.payment), 'neg'); });
    if (p.bankLoan) html += row(rich({ zh: '[[credit_loan|銀行借款]]利息', en: '[[credit_loan|Bank loan]] interest' }), fmt(-C.loanPayment(p)), 'neg');
    if (C.marginLoan(p)) html += row(rich({ zh: '[[margin_trading|融資]]利息', en: '[[margin_trading|Margin]] interest' }), fmt(-C.marginInterest(p)), 'neg');
    if (C.premium(p)) html += row(rich({ zh: '[[insurance|保險費]]', en: '[[insurance|Insurance premiums]]' }), fmt(-C.premium(p)), 'neg');
    if (C.selfPension(p)) html += row(rich({ zh: '[[labor_pension|勞退自提]]（存進退休帳戶）', en: '[[labor_pension|Pension top-up]] (saved)' }), fmt(-C.selfPension(p)), 'neg');
    html += row(rich({ zh: '總[[expense|支出]]', en: 'Total [[expense|expenses]]' }), fmt(-expenses), 'total')
      + row(rich({ zh: '每月[[cashflow]]', en: 'Monthly [[cashflow]]' }), fmt(cf), 'grand ' + moneyCls(cf))
      + '<div class="freedom"><div class="small">' + rich({ zh: '[[financial_freedom]]進度（被動收入 ÷ 總支出）', en: '[[financial_freedom]] progress (passive ÷ expenses)' }) + '</div>'
      + '<div class="bar big"><div style="width:' + Math.min(100, fr * 100).toFixed(1) + '%"></div></div><b>' + (fr * 100).toFixed(1) + '%</b></div>'
      + '</section>';

    html += '<section class="st-block"><h3>' + rich({ zh: '資產負債表（[[net_worth]]）', en: 'Balance sheet ([[net_worth]])' }) + '</h3>'
      + '<div class="st-sub">' + rich({ zh: '[[asset|資產]]', en: '[[asset|Assets]]' }) + '</div>'
      + row(t('cash'), fmt(p.cash));
    const hv = M.holdingValue(g, p);
    if (hv > 0) html += row('<a class="link" data-action="rtab" data-tab="market">' + t('portfolio') + ' ›</a>', fmt(hv));
    if (p.home) html += row(rich({ zh: '[[own_home]]（不產生現金流）', en: '[[own_home]] (no cashflow)' }), fmt(p.home), 'muted-row');
    if (!p.assets.length && !hv) html += '<div class="srow muted-row"><span>' + t('no_assets') + '</span></div>';
    p.assets.forEach((a) => {
      const v = E.assetValue(a);
      const tag = a.underwater ? ' <span class="tag bad">' + rich({ zh: '[[negative_equity|資不抵債]]', en: '[[negative_equity|Underwater]]' }) + '</span>' : '';
      const chg = a.kind !== 'loan' && v !== a.cost ? ' <small class="' + moneyCls(v - a.cost) + '">' + pct(v / a.cost - 1) + '</small>' : '';
      const canSell = isCur && E.SALE_FEE[a.kind] && (g.phase !== 'resolve' || (g.pending && g.pending.type === 'deal'));
      const sellBtn = canSell ? '<button class="btn xs" data-action="sell-open" data-id="' + a.id + '">' + t('sell') + '</button>' : '';
      const free = isCur && g.phase !== 'resolve';
      const bizBtn = free && a.chain
        ? (a.stage >= 3 ? '<button class="btn xs gold" data-action="ipo-open" data-id="' + a.id + '">🔔 ' + t('ipo') + '</button>'
          : '<button class="btn xs" data-action="up-open" data-id="' + a.id + '">⬆️ ' + t('upgrade') + '</button>')
        : '';
      const stage = a.chain ? ' <span class="tag stage">' + t('stage_n', { n: a.stage }) + '</span>' : '';
      html += row(a.icon + ' ' + esc(L(a.name)) + stage + tag, fmt(v) + chg, '', bizBtn + sellBtn);
    });
    if (p.pension && p.pension.acct > 0) html += row(rich({ zh: '[[labor_pension|勞退帳戶]]（退休才能領）', en: '[[labor_pension|Pension account]] (locked)' }), fmt(p.pension.acct), 'muted-row');

    html += '<div class="st-sub">' + rich({ zh: '[[liability|負債]]', en: '[[liability|Liabilities]]' }) + '</div>';
    p.assets.filter((a) => a.mortgage > 0).forEach((a) => { html += row(rich({ zh: '[[mortgage|房貸]]：', en: '[[mortgage|Mortgage]]: ' }) + esc(L(a.name)), fmt(-a.mortgage), 'neg'); });
    p.liabilities.forEach((l) => {
      const owed = l.lender != null ? l.principal : l.balance;
      const btn = isCur && g.phase !== 'resolve'
        ? '<button class="btn xs" data-action="payoff" data-id="' + l.id + '"' + (p.cash < owed ? ' disabled' : '') + '>' + t('payoff') + '</button>'
        : '';
      html += row(esc(L(l.name)), fmt(-owed), 'neg', btn);
    });
    Object.keys(p.margin || {}).forEach((id) => {
      html += row(rich({ zh: '[[margin_trading|融資借款]]：', en: '[[margin_trading|Margin loan]]: ' }) + esc(L(M.byId[id].name)), fmt(-p.margin[id]), 'neg');
    });
    html += row(rich({ zh: '[[credit_loan|銀行借款]]', en: '[[credit_loan|Bank loan]]' }), fmt(-p.bankLoan), 'neg');
    if (isCur) {
      html += '<div class="loan-btns"><button class="btn sm" data-action="loan">🏦 ' + t('borrow') + '</button>'
        + '<button class="btn sm" data-action="repay"' + (p.bankLoan <= 0 || p.cash < Math.min(E.LOAN_UNIT, p.bankLoan) ? ' disabled' : '') + '>' + t('repay') + '</button></div>'
        + '<p class="muted small">' + t('loan_rule', { rate: (C.loanRate(p) * 100).toFixed(1) }) + '</p>';
    }
    const nw = C.netWorth(g, p);
    html += row(rich({ zh: '[[net_worth]]', en: '[[net_worth]]' }), fmt(nw), 'grand ' + moneyCls(nw)) + '</section>';
    return html + homeHtml(g, p, isCur && g.phase !== 'resolve') + planHtml(g, p, isCur && g.phase !== 'resolve');
  }

  // ── 人生目標 ──
  function goalHtml(g, p) {
    if (!p.goal) return '';
    const pr = E.goalProgress(g, p);
    const bonus = g.config.victory === 'freedom' ? t('goal_bonus_free', { n: Math.round(E.GOAL_FREEDOM_BONUS * 100) }) : t('goal_bonus_nw', { amount: { money: E.GOAL_BONUS } });
    return '<div class="goal-card' + (p.goalDone ? ' done' : '') + '"><div><b>🎯 ' + t('goal_title') + '：' + t('goal_' + p.goal) + '</b>'
      + '<small>' + rich(t('goal_' + p.goal + '_d')) + '</small></div>'
      + (p.goalDone ? '<span class="tag good">✓ ' + t('goal_done') + '</span>' : '<div class="bar"><div style="width:' + Math.round(pr.ratio * 100) + '%"></div></div>')
      + '<small class="muted">' + bonus + '</small></div>';
  }

  // ── 財務健檢：紅黃綠燈 ──
  function healthHtml(g, p) {
    const exp = C.expenses(p);
    const inc = C.income(g, p);
    const debtPay = C.debtPayments(p) + C.loanPayment(p) + C.marginInterest(p);
    const invest = Object.keys(p.holdings).map((id) => p.holdings[id] * M.priceTWD(g, id))
      .concat(p.assets.filter((a) => a.kind !== 'loan').map((a) => E.assetValue(a)));
    const total = invest.reduce((s, x) => s + x, 0);
    const top = total > 0 ? Math.max.apply(null, invest) / total : null;
    const light = (v, good, ok, higher) => (higher ? (v >= good ? 'g' : v >= ok ? 'y' : 'r') : (v <= good ? 'g' : v <= ok ? 'y' : 'r'));
    const months = exp > 0 ? p.cash / exp : 99;
    const debtRatio = inc > 0 ? debtPay / inc : (debtPay > 0 ? 1 : 0);
    const saveRate = inc > 0 ? C.cashflow(g, p) / inc : -1;
    const pol = p.policies || {};
    const insured = pol.medical && (!p.children || pol.life) ? 'g' : pol.medical || pol.life ? 'y' : 'r';
    const items = [
      ['emergency', light(months, 6, 3, true), months >= 99 ? '∞' : months.toFixed(1) + t('hc_months')],
      ['debt', light(debtRatio, 0.3, 0.45, false), Math.round(debtRatio * 100) + '%'],
      ['save', light(saveRate, 0.2, 0.1, true), Math.round(saveRate * 100) + '%'],
      ['ins', insured, t(insured === 'g' ? 'hc_ins_ok' : insured === 'y' ? 'hc_ins_part' : 'hc_ins_none')],
      ['div', top == null ? 'n' : light(top, 0.4, 0.7, false), top == null ? t('hc_none') : Math.round(top * 100) + '%'],
    ];
    const worst = items.find((x) => x[1] === 'r') || items.find((x) => x[1] === 'y');
    return '<div class="health"><div class="health-head">' + rich(t('hc_title')) + '</div><div class="health-grid">'
      + items.map(([k, c, v]) => '<div class="hc hc-' + c + '"><i></i><span>' + rich(t('hc_' + k)) + '</span><b>' + v + '</b></div>').join('')
      + '</div>' + (worst ? '<p class="small">' + rich(t('hc_tip_' + worst[0])) + '</p>' : '<p class="small">' + t('hc_all_good') + '</p>') + '</div>';
  }

  // ── 居住：租屋或買房 ──
  function homeHtml(g, p, can) {
    const row = (label, val, extra) => '<div class="srow"><span>' + label + '</span><b>' + val + '</b>' + (extra || '') + '</div>';
    let html = '<section class="st-block"><h3>' + rich(t('hm_title')) + '</h3>';
    if (p.home > 0) {
      const q = E.homeSaleQuote(g, p);
      html += row(rich(t('hm_value')), fmt(p.home), p.homeCost ? ' <small class="' + moneyCls(p.home - p.homeCost) + '">' + pct(p.home / p.homeCost - 1) + '</small>' : '')
        + row(rich(t('hm_debt')), fmt(-q.debt))
        + (can ? '<div class="loan-btns"><button class="btn sm" data-action="home-sell-open">🏷️ ' + t('hm_sell') + '</button></div>' : '');
    } else {
      html += '<p class="muted small">' + rich(t('hm_renting')) + '</p>'
        + (can ? '<div class="loan-btns">' + Object.keys(E.HOMES).map((k) => '<button class="btn sm" data-action="home-open" data-kind="' + k + '">🏠 ' + t('home_' + k) + '</button>').join('') + '</div>' : '');
    }
    return html + '</section>';
  }

  function openHome(kind) {
    const g = UI.game;
    const p = g.players[g.current];
    const q = E.homeQuote(g, p, kind);
    const row = (label, val, cls) => '<div class="srow"><span>' + label + '</span><b class="' + (cls || '') + '">' + val + '</b></div>';
    const cfAfter = C.cashflow(g, p) + q.change;
    const need = q.down + q.closing;
    UI.modal('<h2>🏠 ' + t('home_' + kind) + '</h2>'
      + row(t('hm_price'), fmt(q.price))
      + row(rich(t('hm_down')), fmt(q.down))
      + row(t('hm_closing'), fmt(q.closing))
      + row(rich(t('hm_loan', { rate: q.rate.toFixed(2) })), fmt(q.loan))
      + row(t('hm_payment'), fmt(-q.payment), 'neg')
      + row(t('hm_rent_saved'), '+' + fmt(q.rent), 'pos')
      + row(t('hm_cf_change'), fmt(q.change), moneyCls(q.change))
      + row(t('hm_cf_after'), fmt(cfAfter), 'grand ' + moneyCls(cfAfter))
      + '<p class="small">' + rich(t('hm_note')) + '</p>'
      + (p.cash < need ? '<p class="note bad">' + esc(t('hm_need_cash', { amount: { money: need - p.cash } })) + '</p>' : '')
      + (cfAfter < 0 ? '<p class="note bad">' + rich(t('hm_bank_no')) + '</p>' : '')
      + '<div class="actions"><button class="btn primary" data-action="home-buy" data-kind="' + kind + '"' + (p.cash < need || cfAfter < 0 ? ' disabled' : '') + '>' + t('hm_buy_btn') + '</button></div>', 'small-modal');
    MT.Gloss.flushUnlocks();
  }

  function openHomeSell() {
    const g = UI.game;
    const p = g.players[g.current];
    const q = E.homeSaleQuote(g, p);
    const row = (label, val, cls) => '<div class="srow"><span>' + label + '</span><b class="' + (cls || '') + '">' + val + '</b></div>';
    UI.modal('<h2>🏷️ ' + t('hm_sell') + '</h2>'
      + row(rich(t('hm_value')), fmt(q.value))
      + row(t('hm_sell_fee'), fmt(-q.fee))
      + row(rich(t('hm_sell_tax')), fmt(-q.tax))
      + row(t('hm_debt'), fmt(-q.debt))
      + row(t('sell_net'), fmt(q.net), 'grand ' + moneyCls(q.net))
      + row(t('hm_rent_back'), fmt(-q.rent), 'neg')
      + '<p class="small muted">' + rich(t('hm_sell_note')) + '</p>'
      + '<div class="actions"><button class="btn primary" data-action="home-sell"' + (q.net < 0 && p.cash < -q.net ? ' disabled' : '') + '>' + t('hm_sell_btn') + '</button></div>', 'small-modal');
    MT.Gloss.flushUnlocks();
  }

  // ── 下單視窗：定期定額與限價單 ──
  function planOrderHtml(g, p, i) {
    const id = i.id;
    let html = '';
    if (M.byShares(i) || i.type === 'fund') {
      const cur = (p.dca || []).find((d) => d.id === id);
      html += '<div class="od-btns"><b>📅 ' + rich(t('dca_title')) + '</b>'
        + [0, 3000, 5000, 10000].map((a) => '<button class="chip' + ((cur ? cur.monthly : 0) === a ? ' on' : '') + '" data-action="dca-set" data-amount="' + a + '">' + (a ? fmt(a) + t('per_month') : t('dca_off')) + '</button>').join('')
        + '</div><p class="small muted">' + rich(t('dca_note', { n: E.DCA_MAX })) + '</p>';
    }
    if (M.byShares(i)) {
      const price = g.market.prices[id];
      const ccy = i.ccy === 'USD' ? '$' : '';
      const mine = (p.orders || []).filter((o) => o.id === id);
      html += '<div class="od-btns lim"><b>⏱️ ' + rich(t('lim_title')) + '</b>'
        + '<select class="lim-side"><option value="buy">' + t('lim_buy') + '</option><option value="sell"' + ((p.holdings[id] || 0) > 0 ? '' : ' disabled') + '>' + t('lim_sell') + '</option></select>'
        + '<label>' + t('lim_price') + ' ' + ccy + '<input type="number" step="0.01" min="0.01" class="lim-price" value="' + (price * 0.95).toFixed(2) + '"></label>'
        + '<label><input type="number" step="1" min="1" class="lim-units" value="' + (M.lotSize(i) > 1 ? 1000 : 10) + '"> ' + t('sh_unit') + '</label>'
        + '<button class="btn sm" data-action="order-place">' + t('lim_place') + '</button></div>'
        + '<p class="small muted">' + rich(t('lim_note', { price: ccy + price.toFixed(2), n: E.ORDER_ROUNDS })) + '</p>'
        + (mine.length ? '<div class="lim-list">' + mine.map((o) => '<div class="srow"><span>' + t('side_' + o.side) + ' ' + o.units.toLocaleString() + ' ' + t('sh_unit') + ' @ ' + ccy + o.limit.toFixed(2) + ' <small class="muted">' + t('lim_until', { round: o.until }) + '</small></span>'
          + '<button class="btn xs" data-action="order-cancel" data-oid="' + o.oid + '">' + t('lim_cancel') + '</button></div>').join('') + '</div>' : '');
    }
    return html ? '<div class="od-trade od-plan">' + html + '</div>' : '';
  }

  // 保險與退休規劃
  function planHtml(g, p, can) {
    const row = (label, val, extra) => '<div class="srow"><span>' + label + '</span><b>' + val + '</b>' + (extra || '') + '</div>';
    let html = '<section class="st-block"><h3>' + rich({ zh: '🛡️ [[insurance|保險]]', en: '🛡️ [[insurance|Insurance]]' }) + '</h3>';
    ['medical', 'property', 'life'].forEach((k) => {
      const on = p.policies && p.policies[k];
      const btn = can ? '<button class="btn xs' + (on ? '' : ' primary') + '" data-action="insure" data-kind="' + k + '" data-on="' + (on ? '0' : '1') + '">' + t(on ? 'ins_cancel' : 'ins_buy') + '</button>' : '';
      html += row((on ? '✅ ' : '⬜ ') + t('pol_' + k) + '<small class="muted"> · ' + t('pol_' + k + '_d') + '</small>', fmt(E.PREMIUM[k]) + t('per_month'), btn);
    });
    html += '<p class="muted small">' + rich(t('ins_note')) + '</p></section>';

    html += '<section class="st-block"><h3>' + rich({ zh: '🏖️ 退休規劃', en: '🏖️ Retirement' }) + '</h3>';
    if (p.retired) {
      html += row(rich(t('ret_labor')), fmt(p.pension.labor))
        + row(rich(t('ret_acct')), fmt(p.pension.acct > 0 ? p.pension.fromAcct : 0))
        + row(t('ret_left'), fmt(p.pension.acct))
        + '<p class="muted small">' + rich(t('ret_note_retired')) + '</p>';
    } else {
      const on = g.config.retire;
      const early = on ? E.earliestRetire(g) : 0;
      const q = E.pensionQuote(g, p);
      const canRetire = can && on && g.round >= early;
      html += (on
        ? '<p class="note">' + t('ret_countdown', { n: g.config.retireRound - g.round, round: g.config.retireRound }) + '<br>'
          + (g.round >= early ? t('ret_can_now', { cut: Math.round((1 - q.factor) * 100) }) : t('ret_can_from', { round: early })) + '</p>'
        : '<p class="muted small">' + t('ret_off') + '</p>')
        + row(rich(t('ret_acct_bal')), fmt(p.pension.acct))
        + row(t(on && g.round >= early ? 'ret_est_now' : 'ret_est'), fmt(on && g.round >= early ? q.total : Math.round((p.salary * 0.4) / 100) * 100 + q.fromAcct) + t('per_month'),
          canRetire ? '<button class="btn xs primary" data-action="retire-open">🏖️ ' + t('ret_apply') + '</button>' : '')
        + row((p.pension.self ? '✅ ' : '⬜ ') + rich(t('ret_self')), fmt(Math.round(p.salary * E.PENSION_SELF)) + t('per_month'),
          can ? '<button class="btn xs' + (p.pension.self ? '' : ' primary') + '" data-action="pension-self" data-on="' + (p.pension.self ? '0' : '1') + '">' + t(p.pension.self ? 'ret_self_off' : 'ret_self_on') + '</button>' : '')
        + '<p class="muted small">' + rich(t('ret_note')) + '</p>';
    }
    return html + '</section>';
  }

  // 申請退休：比較退休前後的每月現金流
  function openRetire() {
    const g = UI.game;
    const p = g.players[g.current];
    const q = E.pensionQuote(g, p);
    const passive = C.realPassive(g, p);
    const expAfter = Math.round(C.expenses(p) - p.living * 0.2 - p.tax - C.childCost(p) - C.selfPension(p));
    const cfNow = C.cashflow(g, p);
    const cfAfter = passive + C.scamIncome(p) + q.total - expAfter;
    const row = (label, val, cls) => '<div class="srow"><span>' + label + '</span><b class="' + (cls || '') + '">' + val + '</b></div>';
    const cut = Math.round((1 - q.factor) * 100);
    UI.modal('<h2>🏖️ ' + t('ret_title') + '</h2>'
      + (cut > 0 ? '<p class="note">' + rich(t('ret_early_note', { cut, n: g.config.retireRound - g.round })) + '</p>' : '')
      + row(t('ret_salary_now'), fmt(Math.round(p.salary)))
      + row(rich(t('ret_labor')) + (cut > 0 ? ' <small class="neg">−' + cut + '%</small>' : ''), fmt(q.labor))
      + row(rich(t('ret_acct')), fmt(q.fromAcct))
      + row(rich({ zh: '[[passive_income]]', en: '[[passive_income]]' }), fmt(passive))
      + row(t('ret_exp_after'), fmt(-expAfter))
      + row(t('ret_cf_now'), fmt(cfNow), moneyCls(cfNow))
      + row(t('ret_cf_after'), fmt(cfAfter), 'grand ' + moneyCls(cfAfter))
      + '<p class="small">' + rich(t('ret_perks')) + '</p>'
      + (cfAfter < 0 ? '<p class="note bad">' + rich(t('ret_gap_warn', { amount: { money: -cfAfter } })) + '</p>' : '<p class="note good">' + rich(t('ret_fire_ok')) + '</p>')
      + '<div class="actions"><button class="btn" data-action="close-modal">' + t('ret_keep') + '</button><button class="btn primary" data-action="retire-confirm">' + t('ret_confirm') + '</button></div>', 'small-modal');
    MT.Gloss.flushUnlocks();
  }

  // ── 事業升級與上市 ──
  function openUpgrade(id) {
    const g = UI.game;
    const p = g.players[g.current];
    const a = p.assets.find((x) => x.id === id);
    const info = a && E.upgradeInfo(g, a);
    if (!info) { UI.closeModal(); return; }
    const row = (label, val, cls) => '<div class="srow"><span>' + label + '</span><b class="' + (cls || '') + '">' + val + '</b></div>';
    UI.modal('<h2>⬆️ ' + t('up_title') + '</h2>'
      + '<p class="lead">' + a.icon + ' ' + esc(L(a.name)) + ' → ' + info.icon + ' <b>' + esc(L(info.name)) + '</b></p>'
      + row(t('up_cost'), fmt(info.cost))
      + row(t('up_cf'), fmt(a.cashflow) + ' → ' + fmt(info.cashflow), 'pos')
      + row(t('up_chance'), Math.round(info.chance * 100) + '%', info.chance >= 0.7 ? 'pos' : info.chance >= 0.5 ? '' : 'neg')
      + '<div class="bar"><div style="width:' + Math.round(info.chance * 100) + '%"></div></div>'
      + '<p class="small muted">' + rich(t('up_note')) + '</p>'
      + '<div class="actions"><button class="btn primary" data-action="up-confirm" data-id="' + a.id + '"' + (p.cash < info.cost ? ' disabled' : '') + '>' + t('up_btn') + '</button></div>', 'small-modal');
    MT.Gloss.flushUnlocks();
  }

  function openIpo(id) {
    const g = UI.game;
    const p = g.players[g.current];
    const a = p.assets.find((x) => x.id === id);
    if (!a) { UI.closeModal(); return; }
    const q = E.ipoQuote(g, a);
    const row = (label, val, cls) => '<div class="srow"><span>' + label + '</span><b class="' + (cls || '') + '">' + val + '</b></div>';
    const pes = Object.keys(E.IPO_PE).map((k) => '<span class="chip' + (k === g.macro.phase ? ' on' : '') + '">' + D.phases[k].icon + ' ' + E.IPO_PE[k] + 'x</span>').join('');
    UI.modal('<h2>🔔 ' + t('ipo_title') + '</h2>'
      + '<p class="lead">' + a.icon + ' ' + esc(L(a.name)) + '</p>'
      + row(rich(t('ipo_pe')), q.pe + 'x')
      + row(t('ipo_value'), fmt(q.value))
      + row(t('ipo_fee'), fmt(-q.fee))
      + (a.mortgage > 0 ? row(t('sell_mortgage'), fmt(-a.mortgage)) : '')
      + row(t('sell_net'), fmt(q.net), 'pos')
      + row(rich(t('sell_gain')), fmt(q.gain), moneyCls(q.gain))
      + '<p class="small">' + t('ipo_cycle') + '</p><div class="chips">' + pes + '</div>'
      + '<p class="small muted">' + rich(t('ipo_note')) + '</p>'
      + '<div class="actions"><button class="btn primary" data-action="ipo-confirm" data-id="' + a.id + '"' + (q.net <= 0 ? ' disabled' : '') + '>' + t('ipo_btn') + '</button></div>', 'small-modal');
    MT.Gloss.flushUnlocks();
  }

  function macroDash(g) {
    const m = g.macro;
    const prev = g.market.macroHistory.length > 1 ? g.market.macroHistory[g.market.macroHistory.length - 2] : m;
    const lv = M.LEVELS[g.config.difficulty];
    const arrow = (a, b) => (a > b + 0.001 ? '<i class="up">▲</i>' : a < b - 0.001 ? '<i class="down">▼</i>' : '<i>－</i>');
    const series = (k) => g.market.macroHistory.map((x) => x[k]);
    const cell = (label, val, k, extra) => '<div class="mcell"><span>' + label + '</span><b>' + val + ' ' + arrow(m[k], prev[k]) + '</b>' + spark(series(k), 70, 18) + (extra || '') + '</div>';
    const ph = D.phases[m.phase];
    let html = '<div class="phase-box" style="--ph:' + ph.color + '"><span class="ph-icon">' + ph.icon + '</span><div><b>' + rich({ zh: '[[business_cycle|景氣]]：', en: '[[business_cycle|Cycle]]: ' }) + esc(L(ph.name)) + '</b><div class="small">' + rich(ph.desc) + '</div></div></div>'
      + '<div class="mgrid">'
      + cell(rich({ zh: '[[cpi|通膨]]', en: '[[cpi|Inflation]]' }), m.cpi.toFixed(1) + '%', 'cpi')
      + cell(rich({ zh: '[[central_bank|央行]]利率', en: '[[central_bank|Policy]] rate' }), m.rate.toFixed(2) + '%', 'rate');
    if (lv >= 1) {
      html += cell(rich({ zh: '[[gdp|GDP]] 成長', en: '[[gdp|GDP]] growth' }), m.gdp.toFixed(1) + '%', 'gdp')
        + cell(rich({ zh: '[[unemployment|失業率]]', en: '[[unemployment|Unemployment]]' }), m.unemp.toFixed(1) + '%', 'unemp')
        + cell(rich({ zh: '[[exchange_rate|美元/台幣]]', en: '[[exchange_rate|USD/TWD]]' }), m.fx.toFixed(2), 'fx')
        + cell(t('m_oil'), m.oil.toFixed(0), 'oil');
      // 其他貨幣：顯示 1 單位外幣值多少台幣
      const hist = g.market.macroHistory;
      const before = prev.usdjpy ? prev : m;
      [['JPY', 'm_jpy', 3], ['EUR', 'm_eur', 2], ['CNY', 'm_cny', 2]].forEach(([c, key, d]) => {
        if (!M.isTradable(g, c)) return;
        const now = M.ccyTWD(m, c);
        html += '<div class="mcell"><span>' + t(key) + '</span><b>' + now.toFixed(d) + ' ' + arrow(now, M.ccyTWD(before, c)) + '</b>'
          + spark(hist.filter((x) => x.usdjpy).map((x) => M.ccyTWD(x, c)), 70, 18) + '</div>';
      });
    }
    if (lv >= 2) {
      html += cell(rich({ zh: '[[vix|VIX 恐慌指數]]', en: '[[vix|VIX]]' }), m.vix.toFixed(0), 'vix')
        + cell(t('m_usrate'), m.usRate.toFixed(2) + '%', 'usRate');
    }
    return html + '</div>';
  }

  function marketHtml() {
    const g = UI.game;
    const p = g.players[viewId()];
    const groups = [
      ['mk_g_stock_tw', (i) => i.type === 'stock' && i.ccy === 'TWD'],
      ['mk_g_stock_us', (i) => i.type === 'stock' && i.ccy === 'USD'],
      ['mk_g_fund', (i) => i.type === 'etf' || i.type === 'fund'],
      ['mk_g_safe', (i) => i.type === 'bond' || i.type === 'commodity' || i.type === 'deposit' || i.type === 'fx'],
    ];
    const avail = M.available(g);
    let html = '<div class="st-head"><h2>' + t('mk_title') + '</h2><span class="muted small">' + esc(t('mk_portfolio', { value: { money: M.holdingValue(g, p) } })) + '</span></div>'
      + macroDash(g);
    if (p.skill === 'engineer' && p.id === g.current) {
      const next = E.getCard('market', E.peek(g, 'market'));
      html += '<p class="skill">' + t('peek_title') + '「' + next.icon + ' ' + esc(L(next.name)) + '」</p>';
    }
    html += '<p class="muted small">' + t('mk_hint') + '</p>';
    groups.forEach(([key, fn]) => {
      const list = avail.filter(fn);
      if (!list.length) return;
      html += '<div class="st-sub">' + t(key) + '</div>';
      list.forEach((i) => {
        const last = g.market.last[i.id];
        const held = p.holdings[i.id] ? M.priceTWD(g, i.id) * p.holdings[i.id] : 0;
        const isCash = i.type === 'deposit' || i.type === 'fx';
        const priceTxt = isCash
          ? (M.yieldOf(g, i) * 100).toFixed(2) + '%'
          : (i.ccy === 'USD' ? '$' : '') + g.market.prices[i.id].toLocaleString('en-US', { maximumFractionDigits: i.ccy === 'USD' || g.market.prices[i.id] < 100 ? 2 : 0 });
        const tags = ((p.dca || []).some((d) => d.id === i.id) ? ' 📅' : '') + ((p.orders || []).some((o) => o.id === i.id) ? ' ⏱️' : '');
        html += '<button class="irow" data-action="order" data-id="' + i.id + '">'
          + '<span class="iname">' + i.icon + ' ' + esc(L(i.name)) + tags + (held ? '<small>' + t('mk_hold') + ' ' + (M.byShares(i) ? holdLabel(i, p.holdings[i.id]) + ' · ' : '') + fmt(held) + '</small>' : '')
          + (M.isFrozen(g, i.id) ? '<small class="frozen">' + t('frozen_tag') + '</small>' : '') + '</span>'
          + (isCash ? '<span></span>' : spark(g.market.history[i.id].slice(-12), 54, 18))
          + '<span class="iprice">' + priceTxt + '</span>'
          + '<span class="ichg ' + (isCash ? '' : moneyCls(last)) + '">' + (isCash ? '' : pct(last)) + '</span>'
          + '</button>';
      });
    });
    if (M.LEVELS[g.config.difficulty] === 0) html += '<p class="muted small">' + t('mk_locked') + '</p>';
    return html;
  }

  // ── 下單視窗 ──
  function openOrder(id) {
    const g = UI.game;
    const i = M.byId[id];
    const p = g.players[g.current];
    UI.orderId = id;
    const isCash = i.type === 'deposit' || i.type === 'fx';
    const priceTWD = M.priceTWD(g, id);
    const units = p.holdings[id] || 0;
    const value = units * priceTWD;
    const cost = p.cost[id] || 0;
    const c = M.costs(i);
    const y = M.yieldOf(g, i);
    const last = g.market.last[id];
    const frozen = M.isFrozen(g, id);
    const row = (k, v, cls) => '<div class="kv"><span>' + k + '</span><b class="' + (cls || '') + '">' + v + '</b></div>';

    let html = '<h2>' + i.icon + ' ' + esc(L(i.name)) + ' <span class="muted small">' + i.id + '</span></h2>'
      + '<p>' + rich(i.desc) + '</p>'
      + '<div class="od-grid"><div>'
      + row(t('od_price'), isCash ? '—' : (i.ccy === 'USD' ? '$' + g.market.prices[id].toFixed(2) + ' ≈ ' : '') + fmt(priceTWD))
      + (isCash ? '' : row(t('od_last'), pct(last), moneyCls(last)))
      + row(rich({ zh: '[[yield|年配息 / 利率]]', en: '[[yield|Annual yield / rate]]' }), (y * 100).toFixed(2) + '%')
      + (isCash ? '' : row(rich('[[beta]]'), i.beta.toFixed(2)))
      + row(t('od_ccy'), i.ccy + (i.ccy !== 'TWD' ? ' (' + rich({ zh: '[[exchange_rate|匯率]]', en: '[[exchange_rate|FX]]' }) + ' ' + M.ccyTWD(g.macro, i.ccy).toFixed(i.ccy === 'JPY' ? 3 : 2) + ')' : ''))
      + '</div><div>'
      + row(t('od_value'), fmt(value))
      + row(t('od_cost'), fmt(cost))
      + row(rich({ zh: '[[capital_gain|未實現損益]]', en: '[[capital_gain|Unrealised P/L]]' }), fmt(value - cost), moneyCls(value - cost))
      + row(t('od_monthly'), fmt((value * y) / 12))
      + '</div></div>';

    if (!isCash) html += '<div class="od-chart">' + spark(g.market.history[id], 520, 60) + '</div>';

    // 為什麼漲跌
    const contrib = g.market.contrib[id];
    if (!isCash) {
      html += '<div class="why"><h3>' + t('od_why', { dir: t(last >= 0 ? 'od_up' : 'od_down') }) + '</h3>';
      if (contrib) {
        const items = Object.keys(contrib).map((k) => [k, contrib[k]]).filter((x) => Math.abs(x[1]) >= 0.0005).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
        const max = Math.max.apply(null, items.map((x) => Math.abs(x[1])).concat([0.01]));
        html += items.map(([k, v]) => '<div class="wrow"><span>' + t('c_' + k) + '</span><div class="wbar"><div class="' + (v >= 0 ? 'wpos' : 'wneg') + '" style="width:' + ((Math.abs(v) / max) * 100).toFixed(0) + '%"></div></div><b class="' + moneyCls(v) + '">' + pct(v) + '</b></div>').join('');
      } else {
        html += '<p class="muted small">' + t('od_why_none') + '</p>';
      }
      html += '</div>';
    }

    html += '<p class="small muted">' + rich({ zh: '[[transaction_cost|交易成本]]', en: '[[transaction_cost|Costs]]' }) + '：' + esc(t('od_fees', { buy: (c.buy * 100).toFixed(2) + '%', sell: (c.sell * 100).toFixed(2) + '%' }))
      + (i.fee ? ' · ' + rich({ zh: '[[expense_ratio|內扣費用]]', en: '[[expense_ratio|Annual fee]]' }) + ' ' + (i.fee * 100).toFixed(2) + '%' : '')
      + (isCash ? '' : ' · ' + rich({ zh: '大量買賣會有[[slippage]]', en: 'Big orders cause [[slippage]]' })) + '</p>';

    const sellOnly = g.phase === 'resolve' && g.pending && g.pending.type === 'deal';
    const marginOK = M.LEVELS[g.config.difficulty] >= 1 && (i.type === 'stock' || i.type === 'etf');
    if (p.margin && p.margin[id]) {
      const ratio = value / p.margin[id];
      html += '<div class="note ' + (ratio < 1.6 ? 'bad' : '') + '">' + rich({ zh: '[[margin_trading|融資借款]]', en: '[[margin_trading|Margin loan]]' }) + ' ' + fmt(p.margin[id])
        + ' · ' + rich({ zh: '[[margin_call|維持率]]', en: '[[margin_call|Maintenance]]' }) + ' <b>' + (ratio * 100).toFixed(0) + '%</b>（' + t('od_maint_line') + '）</div>';
    }
    if ((canTrade(g) || sellOnly) && g.players[g.current] === p && isMine(p) && M.byShares(i)) {
      html += sharesTradeHtml(g, p, i, sellOnly, frozen, marginOK);
    } else if ((canTrade(g) || sellOnly) && g.players[g.current] === p && isMine(p)) {
      const buyAmts = [10000, 50000, 100000, 500000];
      html += '<div class="od-trade"><div class="small">' + esc(t('od_cash', { cash: { money: p.cash } })) + '</div>'
        + (sellOnly ? '' : '<div class="od-btns"><b>' + t('od_buy') + '</b>'
        + buyAmts.map((a) => '<button class="btn sm" data-action="trade" data-side="buy" data-amount="' + a + '"' + (p.cash < a ? ' disabled' : '') + '>' + fmt(a) + '</button>').join('')
        + '<button class="btn sm" data-action="trade" data-side="buy" data-amount="all"' + (p.cash < 100 ? ' disabled' : '') + '>' + t('od_all_cash') + '</button></div>')
        + '<div class="od-btns"><b>' + t('od_sell') + '</b>'
        + [10000, 100000].map((a) => '<button class="btn sm" data-action="trade" data-side="sell" data-amount="' + a + '"' + (value < 1 || frozen ? ' disabled' : '') + '>' + fmt(a) + '</button>').join('')
        + '<button class="btn sm" data-action="trade" data-side="sell" data-amount="all"' + (units <= 0 || frozen ? ' disabled' : '') + '>' + t('od_sell_all') + '</button></div>'
        + (frozen ? '<p class="note bad">' + t('frozen_until', { round: g.market.frozen[id] }) + '</p>' : '')
        + (marginOK && !sellOnly
          ? '<div class="od-btns"><b>' + t('od_margin') + '</b>'
            + [10000, 50000, 100000].map((a) => '<button class="btn sm warn" data-action="trade" data-side="margin" data-amount="' + a + '"' + (p.cash < a ? ' disabled' : '') + '>' + fmt(a) + '</button>').join('') + '</div>'
            + '<p class="small muted">' + rich(t('od_margin_note', { own: { money: 100000 }, loan: { money: 100000 * (E.MARGIN_LEVERAGE - 1) }, total: { money: 100000 * E.MARGIN_LEVERAGE } })) + '</p>'
          : '')
        + '</div>';
    } else {
      html += '<p class="note">' + t('mk_cant') + '</p>';
    }
    if (canTrade(g) && g.players[g.current] === p && isMine(p)) html += planOrderHtml(g, p, i);
    UI.modal(html, 'order-modal');
    UI.orderId = id;
    MT.Gloss.flushUnlocks();
  }

  // 股票、ETF：以股（台股可以用張）下單
  function shareLabel(i, n) {
    const lot = M.lotSize(i);
    if (lot > 1 && n >= lot && n % lot === 0) return t('sh_lots', { n: (n / lot).toLocaleString() });
    return t('sh_shares', { n: Math.round(n).toLocaleString() });
  }
  function holdLabel(i, units) {
    const lot = M.lotSize(i);
    const n = Math.floor(units + 1e-9);
    const lots = Math.floor(n / lot);
    return lot > 1 && lots > 0
      ? t('sh_hold_tw', { n: n.toLocaleString(), lots: lots.toLocaleString(), odd: (n % lot).toLocaleString() })
      : t('sh_shares', { n: n.toLocaleString() });
  }
  function sharesTradeHtml(g, p, i, sellOnly, frozen, marginOK) {
    const id = i.id;
    const lot = M.lotSize(i);
    const have = p.holdings[id] || 0;
    const max = M.maxShares(g, p, id);
    const presets = lot > 1 ? [10, 100, 1000, 5000] : [1, 10, 100];
    const unitPrice = M.priceTWD(g, id);
    const btn = (side, n, label, disabled, sub) => '<button class="btn sm" data-action="trade-sh" data-side="' + side + '" data-qty="' + n + '"' + (disabled ? ' disabled' : '') + '>'
      + label + (sub ? '<small>' + sub + '</small>' : '') + '</button>';
    let html = '<div class="od-trade"><div class="small">' + esc(t('od_cash', { cash: { money: p.cash } }))
      + ' · ' + t('sh_have') + ' <b>' + holdLabel(i, have) + '</b></div>'
      + (lot > 1 ? '<p class="small muted">' + rich(t('sh_lot_note', { price: { money: Math.round(unitPrice * lot) } })) + '</p>' : '');
    if (!sellOnly) {
      html += '<div class="od-btns"><b>' + t('od_buy') + '</b>'
        + presets.map((n) => btn('buy', n, shareLabel(i, n), n > max, '≈' + fmt(M.buyCost(g, id, n)))).join('')
        + btn('buy', max, t('sh_max', { n: max.toLocaleString() }), max <= 0)
        + '</div>';
    }
    html += '<div class="od-btns"><b>' + t('od_sell') + '</b>'
      + presets.filter((n) => n < have).map((n) => btn('sell', n, shareLabel(i, n), frozen)).join('')
      + '<button class="btn sm" data-action="trade" data-side="sell" data-amount="all"' + (have <= 0 || frozen ? ' disabled' : '') + '>' + t('od_sell_all') + '</button></div>'
      + '<div class="od-btns sh-custom"><b>' + t('sh_custom') + '</b><input type="number" min="1" step="1" class="sh-input" value="' + (lot > 1 ? 1000 : 10) + '"><span>' + t('sh_unit') + '</span>'
      + (sellOnly ? '' : '<button class="btn sm primary" data-action="trade-sh" data-side="buy" data-qty="input">' + t('od_buy') + '</button>')
      + '<button class="btn sm" data-action="trade-sh" data-side="sell" data-qty="input"' + (have <= 0 || frozen ? ' disabled' : '') + '>' + t('od_sell') + '</button>'
      + '<small class="sh-cost muted"></small></div>'
      + (frozen ? '<p class="note bad">' + t('frozen_until', { round: g.market.frozen[id] }) + '</p>' : '')
      + (marginOK && !sellOnly
        ? '<div class="od-btns"><b>' + t('od_margin') + '</b>'
          + [10000, 50000, 100000].map((a) => '<button class="btn sm warn" data-action="trade" data-side="margin" data-amount="' + a + '"' + (p.cash < a ? ' disabled' : '') + '>' + fmt(a) + '</button>').join('') + '</div>'
          + '<p class="small muted">' + rich(t('od_margin_note', { own: { money: 100000 }, loan: { money: 100000 * (E.MARGIN_LEVERAGE - 1) }, total: { money: 100000 * E.MARGIN_LEVERAGE } })) + '</p>'
        : '')
      + '</div>';
    return html;
  }
  function updateShareCost() {
    const g = UI.game;
    const inp = document.querySelector('.sh-input');
    const out = document.querySelector('.sh-cost');
    if (!inp || !out || !UI.orderId) return;
    const n = Math.max(0, Math.floor(Number(inp.value) || 0));
    out.textContent = n > 0 ? '≈ ' + fmt(M.buyCost(g, UI.orderId, n)) : '';
  }
  function doTradeShares(side, qty) {
    const g = UI.game;
    const p = g.players[g.current];
    const id = UI.orderId;
    let n = qty === 'input' ? Math.floor(Number((document.querySelector('.sh-input') || {}).value) || 0) : Number(qty);
    if (!(n > 0)) { UI.toast(esc(t('err_bad_amount')), 'err-toast', 2500); return; }
    if (side === 'buy') act({ type: 'TRADE', id, side: 'buy', units: n });
    else act({ type: 'TRADE', id, side: 'sell', amount: Math.min(n, p.holdings[id] || 0) });
    if (UI.game.phase !== 'gameover') openOrder(id);
  }

  function doTrade(side, amount) {
    const g = UI.game;
    const p = g.players[g.current];
    const id = UI.orderId;
    let qty;
    if (side === 'buy' || side === 'margin') {
      qty = amount === 'all' ? Math.floor(p.cash) : Number(amount);
    } else {
      const have = p.holdings[id] || 0;
      qty = amount === 'all' ? have : Math.min(have, Number(amount) / M.priceTWD(g, id));
    }
    act({ type: 'TRADE', id, side, amount: qty });
    if (UI.game.phase !== 'gameover') openOrder(id);
  }

  // ── 季報 ──
  function renderReport(rp) {
    const g = UI.game;
    if (!rp) {
      UI.modal('<h2>' + t('rp_btn') + '</h2><p class="muted">' + t('rp_none') + '</p>', 'small-modal');
      return;
    }
    const ri = E.roundInfo(rp.round);
    const a = rp.after;
    const b = rp.before;
    const lv = M.LEVELS[g.config.difficulty];
    const mrow = (label, from, to, fmtFn) => '<tr><td>' + label + '</td><td>' + fmtFn(from) + '</td><td>→</td><td><b>' + fmtFn(to) + '</b></td></tr>';
    const pc = (x) => x.toFixed(1) + '%';
    let html = '<h2>' + t('rp_title', ri) + '</h2>';

    const ph = D.phases[a.phase];
    html += '<div class="phase-box" style="--ph:' + ph.color + '"><span class="ph-icon">' + ph.icon + '</span><div><b>' + esc(L(D.phases[b.phase].name)) + ' → ' + esc(L(ph.name)) + '</b><div class="small">' + rich(ph.desc) + '</div></div></div>';

    if (rp.world) {
      const w = E.getCard('world', rp.world);
      html += '<div class="world-card"><div class="small muted">' + t('rp_world') + ' · ' + (w.real ? t('rp_real', { year: w.year }) : t('rp_fiction')) + '</div>'
        + '<h3>' + w.icon + ' ' + esc(L(w.name)) + '</h3><p>' + rich(w.trivia) + '</p></div>';
    } else {
      html += '<p class="muted small">' + t('rp_quiet') + '</p>';
    }

    html += '<div class="rp-cols"><div><h3>' + t('rp_macro') + '</h3><table class="mtable">'
      + mrow(rich({ zh: '[[cpi|通膨]]', en: '[[cpi|Inflation]]' }), b.cpi, a.cpi, pc)
      + mrow(rich({ zh: '[[interest_rate|利率]]', en: '[[interest_rate|Rate]]' }), b.rate, a.rate, (x) => x.toFixed(2) + '%');
    if (lv >= 1) {
      html += mrow(t('m_gdp'), b.gdp, a.gdp, pc) + mrow(t('m_unemp'), b.unemp, a.unemp, pc)
        + mrow(t('m_fx'), b.fx, a.fx, (x) => x.toFixed(2)) + mrow(t('m_oil'), b.oil, a.oil, (x) => x.toFixed(0));
    }
    if (lv >= 2) html += mrow(t('m_vix'), b.vix, a.vix, (x) => x.toFixed(0)) + mrow(t('m_usrate'), b.usRate, a.usRate, (x) => x.toFixed(2) + '%');
    html += '</table></div><div><h3>' + t('rp_movers') + '</h3>'
      + rp.movers.map((x) => '<button class="irow" data-action="order" data-id="' + x.id + '"><span class="iname">' + M.byId[x.id].icon + ' ' + esc(L(M.byId[x.id].name)) + '</span><span></span><span></span><span class="ichg ' + moneyCls(x.r) + '">' + pct(x.r) + '</span></button>').join('')
      + '</div></div>';

    if (rp.players) {
      html += '<h3>' + t('rp_players') + '</h3><div class="table-wrap"><table class="mtable rp-players"><tr><th></th><th>' + t('rp_cf') + '</th><th>' + t('rp_nw') + '</th><th></th></tr>'
        + rp.players.map((x) => {
          const pl = g.players[x.id];
          const ev = x.events.map((e) => esc(t(e.key, e.params))).join('<br>');
          return '<tr><td><span class="dot" style="--pc:' + pl.color + '"></span>' + esc(pl.name) + '</td><td class="' + moneyCls(x.cf) + '">' + (x.cf > 0 ? '+' : '') + fmt(x.cf) + '</td>'
            + '<td class="' + moneyCls(x.nw) + '">' + (x.nw > 0 ? '+' : '') + fmt(x.nw) + '</td><td class="small">' + ev + '</td></tr>';
        }).join('') + '</table></div>';
    }
    rp.chains.forEach((ch) => MT.Gloss.markExperienced(ch.steps.map((s) => s.p)));
    html += '<h3>' + t('rp_why') + '</h3>' + rp.chains.map((ch) => '<div class="chain"><div class="chain-title">' + ch.icon + ' ' + esc(L(ch.title)) + '</div><ol>'
      + ch.steps.map((s) => '<li>' + rich(s) + (s.p ? ' <span class="principle">' + rich('[[' + s.p + ']]') + '</span>' : '') + '</li>').join('')
      + '</ol></div>').join('');

    html += '<div class="actions"><button class="btn primary" data-action="close-modal">' + t('ok') + '</button></div>';
    UI.modal(html, 'report-modal');
    MT.Gloss.flushUnlocks();
  }

  // ── 賽後複盤 ──
  function nwChart(g) {
    const h = g.history || [];
    if (h.length < 2) return '';
    const W = 560, H = 220, PAD = 36;
    const vals = [];
    h.forEach((x) => { x.nw.forEach((v) => vals.push(v)); x.bench.forEach((v) => vals.push(v)); });
    let min = Math.min(0, Math.min.apply(null, vals));
    let max = Math.max.apply(null, vals);
    if (max === min) max = min + 1;
    const X = (i) => PAD + (i / (h.length - 1)) * (W - PAD - 10);
    const Y = (v) => H - 24 - ((v - min) / (max - min)) * (H - 44);
    const line = (arr, color, dash, w) => '<polyline fill="none" stroke="' + color + '" stroke-width="' + w + '"' + (dash ? ' stroke-dasharray="5 4"' : '') + ' points="'
      + arr.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ') + '"/>';
    let svg = '<svg class="nw-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t('rv_chart')) + '">'
      + '<line x1="' + PAD + '" x2="' + (W - 10) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" class="axis0"/>'
      + '<text x="4" y="' + (Y(max) + 4).toFixed(0) + '" class="ylab">' + Math.round(max / 1e4) + t('rv_wan') + '</text>'
      + '<text x="4" y="' + (Y(min) + 4).toFixed(0) + '" class="ylab">' + Math.round(min / 1e4) + t('rv_wan') + '</text>'
      + '<text x="' + PAD + '" y="' + (H - 6) + '" class="ylab">' + t('rv_start') + '</text>'
      + '<text x="' + (W - 10) + '" y="' + (H - 6) + '" class="ylab" text-anchor="end">' + t('rv_end') + '</text>';
    g.players.forEach((pl, k) => {
      svg += line(h.map((x) => x.bench[k] + (g.players[k].nw0 || 0)), pl.color, true, 1.4);
      svg += line(h.map((x) => x.nw[k]), pl.color, false, 2.6);
    });
    svg += '</svg>';
    const legend = g.players.map((pl) => '<span class="lg"><i style="background:' + pl.color + '"></i>' + esc(pl.name) + '</span>').join('')
      + '<span class="lg"><i class="dash"></i>' + t('rv_bench_line') + '</span>';
    return '<h3>📈 ' + t('rv_chart') + '</h3>' + svg + '<div class="legend">' + legend + '</div>';
  }

  // 依玩家的實際表現產生「學到什麼」
  function lessonsFor(g, p) {
    const st = p.stats || { fees: 0, tax: 0, interest: 0, spend: 0, realized: [] };
    const last = g.history && g.history.length ? g.history[g.history.length - 1] : null;
    const bench = last ? last.bench[p.id] : 0;
    const gain = C.netWorth(g, p) - (p.nw0 || 0);
    const out = [];
    const diff = gain - bench;
    out.push(diff >= 0
      ? t('rv_l_beat', { amount: { money: diff } })
      : t('rv_l_lose', { amount: { money: -diff } }));
    out.push(p.free ? t('rv_l_free') : t('rv_l_notfree', { pct: (C.freedom(g, p) * 100).toFixed(0) }));
    const calls = st.realized.filter((x) => x.marginCall);
    const fails = st.realized.filter((x) => x.failed);
    if (calls.length) out.push(t('rv_l_margin', { n: calls.length, amount: { money: -calls.reduce((s2, x) => s2 + x.gain, 0) } }));
    if (fails.length) out.push(t('rv_l_fail', { n: fails.length, amount: { money: -fails.reduce((s2, x) => s2 + x.gain, 0) } }));
    if (st.interest > 200000) out.push(t('rv_l_interest', { amount: { money: st.interest } }));
    if (st.fees > 20000) out.push(t('rv_l_fees', { amount: { money: st.fees } }));
    if (st.spend > 300000) out.push(t('rv_l_spend', { amount: { money: st.spend } }));
    return out.slice(0, 5);
  }

  function reportCard(g, p) {
    const st = p.stats || { fees: 0, tax: 0, interest: 0, spend: 0, realized: [] };
    const last = g.history && g.history.length ? g.history[g.history.length - 1] : null;
    const bench = last ? last.bench[p.id] : 0;
    const nw = C.netWorth(g, p);
    const gain = nw - (p.nw0 || 0);
    const kv = (k, v, cls) => '<div class="kv"><span>' + k + '</span><b class="' + (cls || '') + '">' + v + '</b></div>';
    const sorted = st.realized.slice().sort((a, b) => b.gain - a.gain);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    return '<div class="rv-card" style="--pc:' + p.color + '"><div class="rv-head"><span class="dot"></span><b>' + esc(p.name) + '</b>'
      + '<span class="muted small">' + profOf(p).icon + ' ' + esc(L(profOf(p).name)) + (p.ai ? ' · ' + MT.AI.STYLES[p.ai.style].icon + ' ' + esc(L(MT.AI.STYLES[p.ai.style].name)) : '') + '</span></div>'
      + kv(t('rv_nw'), fmt(p.nw0 || 0) + ' → ' + fmt(nw))
      + kv(t('rv_gain'), (gain > 0 ? '+' : '') + fmt(gain), moneyCls(gain))
      + kv(rich({ zh: '大盤對照組（[[passive_investing|只買台灣 50]]）', en: 'Benchmark ([[passive_investing|Taiwan 50 only]])' }), '+' + fmt(bench))
      + kv(t('passive'), fmt(C.passive(g, p)) + t('per_month') + '（' + (C.freedom(g, p) * 100).toFixed(0) + '%）')
      + '<div class="rv-costs">'
      + kv(rich({ zh: '[[transaction_cost|交易成本]]', en: '[[transaction_cost|Trading costs]]' }), fmt(st.fees))
      + kv(rich({ zh: '[[tax|稅]]', en: '[[tax|Taxes]]' }), fmt(st.tax))
      + kv(rich({ zh: '[[interest_rate|利息]]', en: '[[interest_rate|Interest]]' }), fmt(st.interest))
      + kv(t('rv_spend'), fmt(st.spend))
      + '</div>'
      + (best ? kv(t('rv_best'), esc(L(best.name)) + ' ' + (best.gain > 0 ? '+' : '') + fmt(best.gain), moneyCls(best.gain)) : '')
      + (worst && worst !== best ? kv(t('rv_worst'), esc(L(worst.name)) + ' ' + fmt(worst.gain), moneyCls(worst.gain)) : '')
      + '<ul class="rv-lessons">' + lessonsFor(g, p).map((x) => '<li>' + rich(x) + '</li>').join('') + '</ul>'
      + '</div>';
  }

  function reviewHtml(g) {
    const order = g.players.slice().sort((a, b) => (a.ai ? 1 : 0) - (b.ai ? 1 : 0));
    return '<div class="review">' + nwChart(g)
      + '<p class="small muted">' + rich(t('rv_bench_note')) + '</p>'
      + '<h3>📋 ' + t('rv_cards') + '</h3><div class="rv-grid">' + order.map((p) => reportCard(g, p)).join('') + '</div></div>';
  }

  function renderGameOver() {
    const g = UI.game;
    const winner = g.players[g.winner];
    let head;
    if (g.endReason === 'freedom') head = t('end_freedom', { name: winner.name });
    else if (g.endReason === 'last') head = t('end_last', { name: winner.name });
    else head = t('end_time', { metric: t(g.config.victory === 'freedom' ? 'metric_freedom' : 'metric_networth') });
    const rows = g.ranking.map((id, i) => {
      const p = g.players[id];
      const prof = profOf(p);
      return '<tr' + (i === 0 ? ' class="win"' : '') + '><td>' + (i === 0 ? '🏆' : i + 1) + '</td><td><span class="dot" style="--pc:' + p.color + '"></span>' + esc(p.name) + (p.goalDone ? ' <span class="tag good" title="' + esc(t('goal_' + p.goal)) + '">🎯</span>' : '') + (p.bankrupt ? ' <span class="tag bad">' + t('bankrupt_tag') + '</span>' : '') + '</td>'
        + '<td>' + prof.icon + ' ' + esc(L(prof.name)) + '</td><td>' + fmt(C.netWorth(g, p)) + '</td><td>' + fmt(C.passive(g, p)) + '</td><td>' + (C.freedom(g, p) * 100).toFixed(0) + '%</td></tr>';
    }).join('');
    UI.modal('<h2>' + t('game_over') + '</h2><p class="lead">' + esc(head) + '</p>'
      + '<div class="table-wrap"><table class="rank"><thead><tr><th>' + t('rank') + '</th><th>' + t('player') + '</th><th>' + t('profession') + '</th><th>' + t('net_worth') + '</th><th>' + t('passive') + '</th><th>%</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      + (g.players.some((p) => p.goal) ? '<p class="small muted">' + esc(t(g.config.victory === 'freedom' ? 'goal_end_note_free' : 'goal_end_note_nw', { amount: { money: E.GOAL_BONUS }, n: Math.round(E.GOAL_FREEDOM_BONUS * 100) })) + '</p>' : '')
      + reviewHtml(g)
      + '<div class="lessons"><h3>' + t('lesson_title') + '</h3><ul><li>' + t('lesson_1') + '</li><li>' + t('lesson_2') + '</li><li>' + t('lesson_3') + '</li></ul></div>'
      + '<div class="actions">' + (MT.Net.mode === 'client' ? '<p class="muted">' + t('net_next_wait') + '</p>' : '<button class="btn primary big" data-action="play-again">' + t('play_again') + '</button>') + '</div>', 'gameover');
    MT.Gloss.flushUnlocks();
  }

  function renderGame() {
    $('#setup').hidden = true;
    $('#game').hidden = false;
    renderTop();
    renderPlayers();
    renderBoard();
    renderRight();
    renderMobileNav();
    MT.FX.weather(UI.game.macro.phase);
    MT.Gloss.flushUnlocks();
  }

  // ── 手機版：底部分頁（棋盤／財報／市場），一次只顯示一個區塊 ──
  UI.mview = 'board';
  UI.turnKey = null;

  function renderMobileNav() {
    const g = UI.game;
    // 輪到自己擲骰或要處理格子事件時，自動切回棋盤
    const key = g.round + '-' + g.current + '-' + g.phase;
    if (key !== UI.turnKey) {
      UI.turnKey = key;
      if (isMine(g.players[g.current]) && (g.phase === 'roll' || g.phase === 'resolve')) UI.mview = 'board';
    }
    const v = UI.mview;
    $('#game').dataset.mview = v;
    $('#mnav').innerHTML = [['board', '🎲 ' + t('mv_board')], ['statement', t('tab_statement')], ['market', t('tab_market')]]
      .map(([k, label]) => '<button class="' + (v === k ? 'on' : '') + '" data-action="mview" data-v="' + k + '">' + label + '</button>').join('');
  }

  const FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  UI.anim = null;

  // 擲骰 → 骰子滾動 → 棋子一格一格跳 → 才顯示格子事件
  function animateRoll(g, before, done) {
    const p = g.players[before.current];
    const n = g.lastRoll;
    const from = before.pos[p.id];
    const fast = MT.Audio.settings.anim === 'fast' || (p.ai && UI.aiSpeed === 'fast');
    const stepMs = fast ? 90 : 170;
    UI.anim = { pid: p.id, pos: from, rolling: true, face: 1 };
    MT.Audio.play('dice');
    renderGame();
    const spin = setInterval(() => {
      UI.anim.face = 1 + Math.floor(Math.random() * 6);
      const d = document.querySelector('.big-die');
      if (d) d.textContent = FACES[UI.anim.face];
    }, 70);
    setTimeout(() => {
      clearInterval(spin);
      UI.anim.rolling = false;
      UI.anim.face = n;
      let k = 0;
      renderBoard();
      const hop = setInterval(() => {
        k += 1;
        UI.anim.pos = (from + k) % D.board.length;
        MT.Audio.play('step', 0, k);
        if (D.board[UI.anim.pos] === 'payday' && k < n) MT.Audio.play('coin', 0.05);
        renderBoard();
        if (k >= n) {
          clearInterval(hop);
          setTimeout(() => { UI.anim = null; done(); }, stepMs);
        }
      }, stepMs);
    }, fast ? 350 : 700);
  }

  // 紀錄 → 音效（依重要性最多 2 個）
  const SOUND = {
    log_free: 'fanfare', log_bankrupt: 'alarm', log_margin_call: 'alarm', log_biz_fail: 'alarm', log_default: 'loss',
    log_caught: 'siren', log_world: 'news', log_geo: 'news', log_news: 'news', log_cb: 'gavel', log_auction_start: 'gavel',
    log_auction_win: 'sold', log_takeover: 'cash', log_buy: 'cash', log_buy_mk: 'cash', log_margin_buy: 'cash',
    log_sell_mk: 'coin', log_payday: 'coin', log_payday_neg: 'loss', log_doodad: 'loss', log_tax: 'loss', log_installment: 'loss',
    log_quiz_right: 'success', log_quiz_wrong: 'wrong', log_card_gain: 'card', log_attack_stock: 'zap', log_attack_sector: 'zap',
    log_poach: 'zap', log_blocked: 'shield', log_insured: 'shield', log_hedge_pay: 'shield', log_auction_bid: 'tick',
    log_asset_sold: 'sold', log_asset_unsold: 'wrong',
    log_scam_bust: 'alarm', log_scam_dodged: 'success', log_claim: 'shield', log_retire_all: 'chime', log_retire_early: 'fanfare', log_goal: 'fanfare', log_home_buy: 'sold', log_home_sell: 'cash',
    log_dca: 'coin', log_order_fill: 'cash', log_card: 'loss', log_dca_on: 'stamp', log_order_place: 'stamp', log_ipo: 'fanfare',
    log_upgrade_ok: 'success', log_upgrade_fail: 'loss', log_upgrade_bust: 'alarm', log_insure_on: 'stamp', log_pension_on: 'stamp',
    log_debt_paid: 'happy', log_payoff: 'happy', log_loan: 'stamp', log_repay: 'stamp', log_settle: 'chime', log_trade_done: 'cash',
  };
  const SOUND_PRI = ['fanfare', 'alarm', 'siren', 'sold', 'news', 'gavel', 'success', 'wrong', 'cash', 'shield', 'zap', 'loss', 'happy', 'coin', 'card', 'stamp', 'tick', 'chime'];

  // 重大事件的橫幅與特效（每次最多一個橫幅）
  function bannerFor(e) {
    const P = e.params;
    switch (e.key) {
      case 'log_free': MT.FX.confetti(); return ['🌟 ' + esc(t('bn_free', { name: P.name })), 'good'];
      case 'log_bankrupt': MT.FX.shake(); MT.FX.flash('rgba(214,69,69,.35)'); return ['💀 ' + esc(t('bn_bankrupt', { name: P.name })), 'bad'];
      case 'log_margin_call': MT.FX.shake(); return ['🔨 ' + esc(t('bn_margin', { name: P.name, inst: P.inst })), 'bad'];
      case 'log_biz_fail': MT.FX.shake(); return ['💥 ' + esc(t('bn_fail', { name: P.name, card: P.card })), 'bad'];
      case 'log_caught': MT.FX.flash('rgba(47,134,235,.3)'); return ['🚨 ' + esc(t('bn_caught', { name: P.name })), 'bad'];
      case 'log_world': return ['🌐 ' + esc(t('bn_world', { card: P.card })), 'news'];
      case 'log_auction_win': return ['🔨 ' + esc(t('bn_auction', { name: P.name })), 'good'];
      case 'log_asset_sold': return ['🏷️ ' + esc(t('bn_sold', { name: P.name, card: P.card })), 'good'];
      case 'log_scam_bust': MT.FX.shake(); return ['🚨 ' + esc(t('bn_scam', { name: P.name, card: P.card })), 'bad'];
      case 'log_retire_all': return ['🏖️ ' + esc(t('bn_retire')), 'news'];
      case 'log_goal': MT.FX.confetti(); return ['🎯 ' + esc(t('bn_goal', { name: P.name, goal: P.goal })), 'good'];
      case 'log_home_buy': return ['🏠 ' + esc(t('bn_home', { name: P.name })), 'good'];
      case 'log_retire_early': return ['🏖️ ' + esc(t('bn_retire_early', { name: P.name })), 'good'];
      case 'log_ipo': MT.FX.confetti(); return ['🔔 ' + esc(t('bn_ipo', { name: P.name, card: P.card })), 'good'];
      case 'log_upgrade_ok': return ['⬆️ ' + esc(t('bn_upgrade', { name: P.name, card: P.card })), 'good'];
      case 'log_upgrade_bust': MT.FX.shake(); return ['💥 ' + esc(t('bn_upgrade_bust', { card: P.card })), 'bad'];
      case 'log_asset_unsold': return ['🏷️ ' + esc(t('bn_unsold', { card: P.card })), 'news'];
      default: return null;
    }
  }

  function react(g, before) {
    const logs = g.log.slice(before.len);
    const sounds = logs.map((e) => SOUND[e.key]).filter((x, i, arr) => x && arr.indexOf(x) === i)
      .sort((a, b) => SOUND_PRI.indexOf(a) - SOUND_PRI.indexOf(b)).slice(0, 2);
    sounds.forEach((x, i) => MT.Audio.play(x, i * 0.28));
    g.players.forEach((p, i) => {
      const d = Math.round(p.cash - before.cash[i]);
      if (Math.abs(d) >= 1000) MT.FX.moneyPop(document.querySelector('.pcard[data-id="' + p.id + '"]'), d);
    });
    for (const e of logs) {
      const b = bannerFor(e);
      if (b) { MT.FX.banner(b[0], b[1]); break; }
    }
    MT.Audio.setMood(g.phase === 'gameover' ? 'menu' : g.macro.phase);
    if (g.phase === 'gameover') {
      if (sounds.indexOf('fanfare') < 0) MT.Audio.play('fanfare', 0.3);
      MT.FX.confetti(200);
    }
    MT.Ach.check(g, { logs, prevPhase: before.phase, isMine }).forEach(({ a, p }, i) => {
      setTimeout(() => {
        UI.toast('<div class="toast-title">' + t('ach_unlocked') + '</div><div>' + a.icon + ' <b>' + esc(L(a.name)) + '</b> — ' + esc(L(a.desc)) + '</div><div class="muted small">' + esc(p.name) + '</div>', 'ach-toast', 5000);
        MT.Audio.play('chime');
        if (i === 0) MT.FX.confetti(60);
        renderTop();
      }, 700 + i * 900);
    });
  }

  // byAI = true：電腦玩家的動作，失敗不跳錯誤訊息
  function act(action, byAI) {
    if (MT.Net.mode === 'client') {
      MT.Net.send({ t: 'act', action });
      return { ok: true, remote: true };
    }
    return performLocal(action, byAI);
  }

  // 真正執行動作（單機、房主、或玩家收到房主廣播時）；conn = 送出動作的網路玩家
  function performLocal(action, byAI, conn) {
    const g = UI.game;
    const before = { len: g.log.length, cash: g.players.map((p) => p.cash), pos: g.players.map((p) => p.pos), phase: g.macro.phase, current: g.current };
    const mine = isMine(MT.AI.actorOf(g));
    const r = E.dispatch(g, action);
    if (!r.ok && !byAI && !conn) UI.toast(esc(t('err_' + r.error)), 'err-toast', 2800);
    if (!r.ok && conn) MT.Net.sendReject(conn, 'err_' + r.error);
    if (r.ok && MT.Net.mode === 'host') MT.Net.broadcastAct(action, g);
    if (mine) UI.seenLog = g.log.length;
    if (action.type === 'END_TURN' || action.type === 'ROLL') UI.viewPlayer = null;
    if (g.phase === 'gameover') {
      try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    } else {
      saveGame();
    }
    if (r.ok && action.type === 'ROLL' && !MT.FX.off()) {
      animateRoll(g, before, () => afterAct(g, r, before));
      return r;
    }
    afterAct(g, r, before);
    return r;
  }

  function afterAct(g, r, before) {
    renderGame();
    react(g, before);
    if (g.phase === 'gameover') {
      renderGameOver();
    } else if (r.ok && r.result) {
      const res = r.result;
      const by = g.players[res.by];
      const target = res.target != null ? g.players[res.target] : null;
      // 電腦的出牌：攻擊到真人時才跳出結果，其他（例如情報卡）只顯示簡短提示，不洩漏內容
      if (isMine(by) || (target && isMine(target))) showPlayResult(res);
      else UI.toast(esc(t('ai_played', { name: by.name, card: E.getCard('strategy', res.card).name })), 'term-toast', 3500);
    } else if (g.report && g.report.round !== UI.lastReport) {
      // 新的一季結算完成：自動打開季報
      UI.lastReport = g.report.round;
      renderReport(g.report);
    }
    if (UI.modalKind === 'order-modal' && UI.orderId) openOrder(UI.orderId);
    scheduleAI();
    drainNet();
  }

  // ── 連線：收到的動作排隊，等動畫播完再一個一個執行 ──
  UI.netQueue = [];
  function drainNet() {
    while (!UI.anim && UI.netQueue.length) UI.netQueue.shift()();
  }
  UI.netHostAct = function (action, conn) {
    UI.netQueue.push(() => { if (UI.game && UI.game.phase !== 'gameover') performLocal(action, true, conn); });
    drainNet();
  };
  UI.netApply = function (action, check) {
    UI.netQueue.push(() => {
      const g = UI.game;
      if (!g) return;
      performLocal(action, true);
      if (check && (g.log.length !== check.len || g.rng !== check.rng)) MT.Net.send({ t: 'needsync' });
    });
    drainNet();
  };
  UI.netLoad = function (state, keepView) {
    UI.game = state;
    UI.netQueue = [];
    UI.anim = null;
    UI.lastReport = state.report ? state.report.round : null;
    if (!keepView) { UI.viewPlayer = null; UI.seenLog = state.turnLogStart; }
    UI.closeModal();
    renderGame();
  };
  UI.netBackToLobby = function () {
    UI.game = null;
    UI.closeModal();
    renderSetup();
  };
  UI.onNet = function () {
    if (!$('#setup').hidden) renderSetup();
    else if (UI.game) renderTop();
  };

  // ── 電腦玩家自動行動 ──
  UI.aiTimer = null;
  UI.aiSpeed = 'normal';
  UI.seenLog = 0; // 真人上次看過的紀錄位置

  function scheduleAI() {
    if (MT.Net.mode === 'client') return; // 電腦玩家只在房主那邊跑
    if (UI.aiTimer || UI.anim || !UI.game || UI.game.phase === 'gameover' || $('#game').hidden) return;
    if (!$('#modal').hidden && !MT.Net.mode) return; // 單機：有視窗開著（季報、出牌結果）時先暫停，等真人看完
    const d = MT.AI.decide(UI.game);
    if (!d) return;
    const fast = UI.aiSpeed === 'fast';
    const delay = d.action.type === 'ROLL' ? (fast ? 300 : 1000) : (fast ? 200 : 800);
    UI.aiTimer = setTimeout(stepAI, delay);
  }

  function stepAI() {
    UI.aiTimer = null;
    const g = UI.game;
    if (!g || g.phase === 'gameover' || (!$('#modal').hidden && !MT.Net.mode) || UI.anim) return;
    const d = MT.AI.decide(g);
    if (!d) return;
    const action = Object.assign({}, d.action, d.reason ? { reason: d.reason } : {});
    const r = act(action, true);
    if (!r.ok) {
      MT.AI.noteFail(g, action);
      scheduleAI();
    }
  }

  function aiActing() {
    const g = UI.game;
    if (UI.anim) return true; // 動畫中也先不接受操作
    if (!g || g.phase === 'gameover') return false;
    const actor = MT.AI.actorOf(g);
    return !(actor && isMine(actor)); // 電腦或別台裝置的玩家在行動
  }
  const GAME_ACTIONS = ['roll', 'end-turn', 'choose', 'loan', 'repay', 'payoff', 'trade', 'hand-card', 'play-confirm', 'trade-open', 'tr-send', 'sell-open', 'sell-confirm', 'insure', 'pension-self', 'up-open', 'up-confirm', 'ipo-open', 'ipo-confirm', 'retire-open', 'retire-confirm', 'trade-sh', 'dca-set', 'order-place', 'order-cancel', 'home-open', 'home-buy', 'home-sell-open', 'home-sell'];

  function openSettings() {
    const S = MT.Audio.settings;
    const sw = (key, label) => '<label class="set-row"><span>' + label + '</span><input type="checkbox" data-set="' + key + '"' + (S[key] ? ' checked' : '') + '></label>';
    UI.modal('<h2>' + t('settings') + '</h2>'
      + sw('sfx', t('set_sfx')) + sw('music', t('set_music'))
      + '<label class="set-row"><span>' + t('set_volume') + '</span><input type="range" min="0" max="1" step="0.05" data-set="volume" value="' + S.volume + '"></label>'
      + '<div class="set-row"><span>' + t('set_anim') + '</span><div class="chips">'
      + ['normal', 'fast', 'off'].map((v) => '<button class="chip' + (S.anim === v ? ' on' : '') + '" data-action="set-anim" data-val="' + v + '">' + t('anim_' + v) + '</button>').join('') + '</div></div>'
      + '<p class="small muted">' + t('music_note') + '</p>'
      + '<div class="actions"><button class="btn" data-action="sound-test">🔔 ' + t('sound_test') + '</button></div>', 'small-modal');
  }

  function showTileInfo(type) {
    const tt = D.tileTypes[type];
    UI.modal('<h2>' + tt.icon + ' ' + esc(L(tt.name)) + '</h2><p>' + rich(tt.desc) + '</p>'
      + (tt.milestone ? '<p class="note">' + t('coming_soon', { m: tt.milestone }) + '</p>' : ''), 'small-modal');
    MT.Gloss.flushUnlocks();
  }

  function rerender() {
    if (UI.game && !$('#game').hidden) {
      renderGame();
      if (UI.modalKind === 'order-modal' && UI.orderId) openOrder(UI.orderId);
    } else {
      renderSetup();
    }
  }

  // ── 事件處理 ──
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (e.target.id === 'modal') { UI.closeModal(); return; }
    if (!el || el.dataset.action.startsWith('g-') || e.target.closest('.term')) return;
    const a = el.dataset.action;
    const s = UI.setup;
    if (GAME_ACTIONS.indexOf(a) >= 0 && aiActing()) return; // 電腦行動中，真人不能代按
    if (a !== 'roll' && a !== 'choose' && a !== 'trade') MT.Audio.play('click');
    switch (a) {
      case 'sound': {
        const on = !(MT.Audio.settings.sfx || MT.Audio.settings.music);
        MT.Audio.set('sfx', on);
        MT.Audio.set('music', on);
        if (UI.game && !$('#game').hidden) renderTop(); else renderSetup();
        break;
      }
      case 'settings': openSettings(); break;
      case 'tutorial': MT.Tutorial.start(); break;
      case 'net-host':
        for (let i = 1; i < 4; i++) if (s.kinds[i] === 'human') s.kinds[i] = 'net';
        if (s.count < 2) s.count = 2;
        if (s.kinds.slice(1, s.count).indexOf('net') < 0) s.kinds[1] = 'net'; // 至少留一個座位給朋友
        MT.Net.host();
        renderSetup();
        break;
      case 'net-join': {
        const name = ($('.join-name') && $('.join-name').value.trim()) || t('net_guest');
        const code = $('.join-code') ? $('.join-code').value : '';
        UI.joinName = name;
        UI.joinCode = code;
        MT.Net.join(code, name);
        break;
      }
      case 'net-leave':
        MT.Net.leave();
        UI.game = null;
        for (let i = 0; i < 4; i++) if (s.kinds[i] === 'net') s.kinds[i] = 'human';
        UI.closeModal();
        renderSetup();
        break;
      case 'net-copy':
        try { navigator.clipboard.writeText(MT.Net.code); UI.toast(esc(t('net_copied')), 'term-toast', 2000); } catch (e) { /* ignore */ }
        break;
      case 'emote': MT.Net.emote(el.dataset.e); break;
      case 'set-anim': MT.Audio.set('anim', el.dataset.val); openSettings(); break;
      case 'sound-test': MT.Audio.play('fanfare'); MT.FX.confetti(60); break;
      case 'ach': UI.modal(MT.Ach.galleryHtml(), 'ach-modal'); MT.Gloss.flushUnlocks(); break;
      case 'seat-kind':
        s.kinds[Number(el.dataset.idx)] = el.dataset.val;
        if (MT.Net.mode === 'host') MT.Net.backToLobby(); // 座位改變後重新分配網路玩家
        renderSetup();
        break;
      case 'setup':
        if (el.dataset.name === 'count') s.count = Number(el.dataset.value);
        else s[el.dataset.name] = el.dataset.value;
        renderSetup();
        break;
      case 'start': startGame(); break;
      case 'resume': resumeGame(loadSave()); break;
      case 'save-menu': $('#topbar').classList.remove('open'); renderTop(); openSaveMenu(); break;
      case 'save-download': {
        const g = UI.game;
        const blob = new Blob([JSON.stringify(g)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'moneytide-save-r' + g.round + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        break;
      }
      case 'save-copy':
        encodeSave(UI.game).then((code) => {
          // 不能直接寫入剪貼簿時（例如非 https），改成顯示代碼讓玩家自己複製
          const fallback = () => {
            UI.modal('<h2>📋 ' + t('sv_copy') + '</h2><textarea class="sv-code" rows="8" readonly>' + esc(code) + '</textarea>', 'small-modal');
            const ta = document.querySelector('#modal .sv-code');
            if (ta) ta.select();
          };
          if (!navigator.clipboard) { fallback(); return; }
          navigator.clipboard.writeText(code).then(() => UI.toast(esc(t('sv_copied')), '', 4500), fallback);
        });
        break;
      case 'save-import-open': openImport(); break;
      case 'slot-save': {
        const g = UI.game;
        const list = readSlots();
        const i = Number(el.dataset.i);
        if (list[i] && !confirm(t('sl_confirm_over', { n: i + 1 }))) break;
        list[i] = { time: Date.now(), round: g.round, total: g.config.rounds, names: g.players.map((p) => p.name).join('、'), data: JSON.stringify(g) };
        if (writeSlots(list)) UI.toast(esc(t('sl_saved', { n: i + 1 })), '', 2500);
        else UI.toast(esc(t('sl_full')), 'err-toast', 4000);
        openSaveMenu();
        break;
      }
      case 'slot-load': {
        const slot = readSlots()[Number(el.dataset.i)];
        const g = slot && slotGame(slot);
        if (!g) { UI.toast(esc(t('sv_bad')), 'err-toast', 4000); break; }
        if (UI.game && !$('#game').hidden && !confirm(t('sl_confirm_load'))) break;
        UI.closeModal();
        resumeGame(g);
        saveGame();
        UI.toast(esc(t('sv_loaded')), '', 2500);
        break;
      }
      case 'slot-del': {
        const list = readSlots();
        const i = Number(el.dataset.i);
        if (!confirm(t('sl_confirm_del', { n: i + 1 }))) break;
        list[i] = null;
        writeSlots(list);
        if (UI.game && !$('#game').hidden) openSaveMenu(); else openImport();
        break;
      }
      case 'save-import': {
        const f = document.querySelector('.sv-file-input');
        const code = document.querySelector('.sv-code');
        if (f && f.files && f.files[0]) f.files[0].text().then(doImport);
        else doImport(code ? code.value : '');
        break;
      }
      case 'lang':
        MT.setLang(MT.lang === 'zh' ? 'en' : 'zh');
        document.documentElement.lang = MT.lang === 'zh' ? 'zh-Hant' : 'en';
        rerender();
        break;
      case 'glossary': MT.Gloss.openGlossary(null); break;
      case 'close-modal': UI.closeModal(); break;
      case 'new-game':
        if (confirm(t('confirm_new'))) {
          UI.closeModal();
          if (MT.Net.mode === 'host') { UI.game = null; MT.Net.backToLobby(); }
          renderSetup();
        }
        break;
      case 'play-again':
        UI.closeModal();
        UI.game = null;
        if (MT.Net.mode === 'host') MT.Net.backToLobby();
        renderSetup();
        break;
      case 'roll': act({ type: 'ROLL' }); break;
      case 'end-turn': act({ type: 'END_TURN' }); break;
      case 'choose': {
        const choice = el.dataset.choice;
        const index = el.dataset.index != null ? Number(el.dataset.index) : undefined;
        const amount = el.dataset.amount != null ? Number(el.dataset.amount) : undefined;
        act({ type: 'CHOOSE', choice, index, amount });
        break;
      }
      case 'hand-card': UI.play = { index: null, target: {} }; openPlay(Number(el.dataset.index)); break;
      case 'play-target': {
        const v = el.dataset.val;
        const key = el.dataset.key;
        UI.play.target[key] = key === 'player' ? Number(v) : v;
        if (key === 'player') delete UI.play.target.asset;
        openPlay(UI.play.index);
        break;
      }
      case 'play-confirm': {
        const pl = UI.play;
        UI.closeModal();
        UI.play = { index: null, target: {} };
        act({ type: 'PLAY_CARD', index: pl.index, target: pl.target });
        break;
      }
      case 'trade-open': UI.tr = null; openTrade(); break;
      case 'tr-set': {
        const [a, b] = el.dataset.key.split('.');
        const v = el.dataset.val;
        if (b) UI.tr[a][b] = v; else UI.tr[a] = a === 'to' ? Number(v) : v;
        if (a === 'to') { UI.tr.get = { cash: 0, asset: '', card: '' }; }
        openTrade();
        break;
      }
      case 'tr-send': sendTrade(); break;
      case 'loan': act({ type: 'LOAN' }); break;
      case 'repay': act({ type: 'REPAY' }); break;
      case 'payoff': act({ type: 'PAYOFF', id: el.dataset.id }); break;
      case 'sell-open': UI.sell = null; openSell(el.dataset.id); break;
      case 'insure': act({ type: 'INSURE', kind: el.dataset.kind, on: el.dataset.on === '1' }); break;
      case 'pension-self': act({ type: 'PENSION_SELF', on: el.dataset.on === '1' }); break;
      case 'up-open': openUpgrade(el.dataset.id); break;
      case 'retire-open': openRetire(); break;
      case 'dca-set': act({ type: 'DCA_SET', id: UI.orderId, monthly: Number(el.dataset.amount) }); openOrder(UI.orderId); break;
      case 'order-place': {
        const side = (document.querySelector('.lim-side') || {}).value;
        const limit = Number((document.querySelector('.lim-price') || {}).value);
        const units = Number((document.querySelector('.lim-units') || {}).value);
        act({ type: 'ORDER_PLACE', id: UI.orderId, side, limit, units });
        openOrder(UI.orderId);
        break;
      }
      case 'order-cancel': act({ type: 'ORDER_CANCEL', oid: el.dataset.oid }); openOrder(UI.orderId); break;
      case 'home-open': openHome(el.dataset.kind); break;
      case 'home-buy': UI.closeModal(); act({ type: 'BUY_HOME', kind: el.dataset.kind }); break;
      case 'home-sell-open': openHomeSell(); break;
      case 'home-sell': UI.closeModal(); act({ type: 'SELL_HOME' }); break;
      case 'retire-confirm': UI.closeModal(); act({ type: 'RETIRE' }); break;
      case 'up-confirm': UI.closeModal(); act({ type: 'UPGRADE', id: el.dataset.id }); break;
      case 'ipo-open': openIpo(el.dataset.id); break;
      case 'ipo-confirm': UI.closeModal(); act({ type: 'IPO', id: el.dataset.id }); break;
      case 'sell-pct': {
        const a = UI.game.players[UI.game.current].assets.find((x) => x.id === UI.sell.id);
        UI.sell.price = Math.round(E.assetValue(a) * Number(el.dataset.val) / 10000) * 10000;
        const inp = document.querySelector('.sell-input');
        if (inp) inp.value = UI.sell.price;
        updateSellQuote();
        break;
      }
      case 'sell-confirm': {
        const sl = UI.sell;
        UI.sell = null;
        UI.closeModal();
        act({ type: 'SELL_ASSET', id: sl.id, price: Math.round(Number(sl.price) || 0) });
        break;
      }
      case 'view':
        UI.viewPlayer = Number(el.dataset.id);
        renderPlayers();
        renderRight();
        MT.Gloss.flushUnlocks();
        break;
      case 'top-menu':
        $('#topbar').classList.toggle('open');
        renderTop();
        break;
      case 'mview': {
        const v = el.dataset.v;
        UI.mview = v;
        if (v !== 'board') { UI.rightTab = v; renderRight(); }
        renderMobileNav();
        window.scrollTo(0, 0);
        MT.Gloss.flushUnlocks();
        break;
      }
      case 'rtab':
        UI.rightTab = el.dataset.tab;
        if (UI.mview !== 'board') UI.mview = el.dataset.tab;
        if ($('#mnav').innerHTML) renderMobileNav();
        UI.closeModal();
        renderRight();
        MT.Gloss.flushUnlocks();
        break;
      case 'order': openOrder(el.dataset.id); break;
      case 'trade': doTrade(el.dataset.side, el.dataset.amount); break;
      case 'trade-sh': doTradeShares(el.dataset.side, el.dataset.qty); break;
      case 'report': renderReport(UI.game.report); break;
      case 'tile': showTileInfo(el.dataset.type); break;
    }
  });

  // 交易視窗的輸入欄位
  function trInput(e) {
    const key = e.target.dataset && e.target.dataset.tr;
    if (!key || !UI.tr) return;
    const [a, b] = key.split('.');
    let v = e.target.value;
    if (b === 'cash' || b === 'amount' || b === 'months' || b === 'rate') v = Number(v);
    UI.tr[a][b] = v;
    if (a === 'loan' && e.type === 'change') openTrade();
  }
  document.addEventListener('change', trInput);
  document.addEventListener('input', (e) => {
    const key = e.target.dataset && e.target.dataset.set;
    if (!key) return;
    MT.Audio.set(key, key === 'volume' ? Number(e.target.value) : e.target.checked);
    if (key !== 'volume' && UI.game && !$('#game').hidden) renderTop();
  });
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('style-select')) {
      UI.setup.styles[Number(e.target.dataset.idx)] = e.target.value;
      renderSetup();
    }
  });
  document.addEventListener('input', trInput);

  document.addEventListener('input', (e) => {
    if (e.target.classList.contains('join-name')) UI.joinName = e.target.value;
    if (e.target.classList.contains('join-code')) UI.joinCode = e.target.value.toUpperCase();
    if (e.target.classList.contains('name-input')) UI.setup.names[Number(e.target.dataset.idx)] = e.target.value;
    if (e.target.classList.contains('seed-input')) UI.setup.seed = e.target.value;
    if (e.target.classList.contains('sell-input') && UI.sell) { UI.sell.price = Number(e.target.value); updateSellQuote(); }
    if (e.target.classList.contains('sh-input')) updateShareCost();
    if (e.target.dataset.action === 'custom-rounds') {
      UI.setup.customRounds = Number(e.target.value);
      const span = e.target.nextElementSibling;
      span.textContent = t('len_detail', { rounds: UI.setup.customRounds, years: UI.setup.customRounds / 4 });
    }
  });
  // 自訂長度放開滑桿後重畫，讓退休回合等說明跟著更新
  document.addEventListener('change', (e) => {
    if (e.target.dataset && e.target.dataset.action === 'custom-rounds') renderSetup();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') UI.closeModal();
  });

  UI.startGame = startGame;
  UI.rerender = rerender;

  UI.init = function () {
    document.documentElement.lang = MT.lang === 'zh' ? 'zh-Hant' : 'en';
    renderSetup();
  };
})();

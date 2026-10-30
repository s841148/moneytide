// 錢潮 MoneyTide © 2026 麥麥的遊戲工廠 保留所有權利 All rights reserved. 詳見 LICENSE
// 名詞解釋系統：文字中的 [[id]] 或 [[id|顯示文字]] 會變成可點擊的名詞。
// 第一次遇到的名詞會「解鎖」並跳出提示，解鎖紀錄跨局保存在本機。
window.MT = window.MT || {};

(function () {
  const STORE_KEY = 'mt_glossary_unlocked';
  const byId = {};
  MT.DATA.glossary.forEach((g) => { byId[g.id] = g; });

  let unlocked = {};
  try { unlocked = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { unlocked = {}; }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(unlocked)); } catch (e) { /* 無法儲存時只在本次有效 */ }
  }

  // 經濟規則的「親身經歷」徽章：在季報或事件卡的因果鏈中真的遇到過
  const EXP_KEY = 'mt_experienced';
  let experienced = {};
  try { experienced = JSON.parse(localStorage.getItem(EXP_KEY) || '{}') || {}; } catch (e) { experienced = {}; }
  function markExperienced(ids) {
    let changed = false;
    ids.forEach((id) => { if (id && byId[id] && !experienced[id]) { experienced[id] = true; changed = true; } });
    if (changed) { try { localStorage.setItem(EXP_KEY, JSON.stringify(experienced)); } catch (e) { /* ignore */ } }
  }
  function expCount() { return MT.DATA.glossary.filter((g) => g.cat === 'rules' && experienced[g.id]).length; }
  function rulesTotal() { return MT.DATA.glossary.filter((g) => g.cat === 'rules').length; }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 雙語顯示名稱：中文介面「現金流 Cashflow」，英文介面「Cashflow」
  function displayName(g) {
    return MT.lang === 'zh' ? g.name.zh + ' ' + g.name.en : g.name.en;
  }

  let unlockQueue = [];

  function unlock(id) {
    if (!byId[id] || unlocked[id]) return;
    unlocked[id] = true;
    save();
    unlockQueue.push(id);
  }

  // 把含 [[term]] 的文字轉成 HTML。track = true 時會解鎖名詞。
  function rich(text, track) {
    const s = esc(MT.L(text));
    return s.replace(/\[\[([a-z_]+)(?:\|([^\]]+))?\]\]/g, (m, id, label) => {
      const g = byId[id];
      if (!g) return label || id;
      if (track !== false) unlock(id);
      return '<span class="term" data-term="' + id + '" tabindex="0">' + (label || MT.L(g.name)) + '</span>';
    });
  }

  // 把解鎖提示顯示出來（在畫面重繪後呼叫）
  function flushUnlocks() {
    const ids = unlockQueue;
    unlockQueue = [];
    // 一次解鎖很多個時合併成一則，避免洗版
    if (ids.length > 2) {
      MT.UI.toast(
        '<div class="toast-title">' + MT.t('new_terms', { n: ids.length }) + '</div>'
        + '<div>' + ids.map((id) => '<span class="term" data-term="' + id + '">' + esc(MT.L(byId[id].name)) + '</span>').join('、') + '</div>',
        'term-toast', 8000,
      );
      return;
    }
    ids.forEach((id, i) => {
      setTimeout(() => {
        const g = byId[id];
        MT.UI.toast(
          '<div class="toast-title">' + MT.t('new_term') + '</div>'
          + '<div><span class="term" data-term="' + id + '">' + esc(displayName(g)) + '</span>：' + esc(MT.L(g.one)) + '</div>',
          'term-toast', 6000,
        );
      }, i * 350);
    });
  }

  function count() {
    return Object.keys(unlocked).filter((id) => byId[id]).length;
  }

  // 依難度決定預設展開到哪一層
  function defaultDepth() {
    const d = MT.UI.game ? MT.UI.game.config.difficulty : 'easy';
    return { easy: 1, medium: 2, hard: 3 }[d];
  }

  function entryHtml(g, depth) {
    const row = (label, val, cls) => '<div class="g-row ' + (cls || '') + '"><div class="g-label">' + label + '</div><div>' + rich(val, false) + '</div></div>';
    let html = '<div class="g-entry" data-entry="' + g.id + '">'
      + '<h3>' + esc(displayName(g)) + (g.cat === 'rules' && experienced[g.id] ? ' <span class="exp-badge">' + MT.t('exp_badge') + '</span>' : '') + '</h3>'
      + row('🟢 ' + MT.t('g_one'), g.one, 'g-one')
      + row('🍜 ' + MT.t('g_analogy'), g.analogy)
      + row('🎮 ' + MT.t('g_game'), g.game);
    if (depth >= 2) html += row('🟡 ' + MT.t('g_mid'), g.mid);
    if (depth >= 3) html += row('🔴 ' + MT.t('g_deep'), g.deep);
    if (depth < 3) html += '<button class="link-btn" data-action="g-depth" data-id="' + g.id + '" data-depth="' + (depth + 1) + '">' + MT.t('g_more') + '</button>';
    if (g.related && g.related.length) {
      html += '<div class="g-related">' + MT.t('g_related') + '：'
        + g.related.filter((r) => byId[r]).map((r) => '<button class="chip" data-action="g-open" data-id="' + r + '">' + esc(MT.L(byId[r].name)) + '</button>').join('')
        + '</div>';
    }
    return html + '</div>';
  }

  let showLocked = false;

  function openGlossary(focusId, depth) {
    if (focusId) unlock(focusId);
    const cats = ['personal', 'macro', 'invest', 'global', 'rules'];
    const focus = focusId ? byId[focusId] : null;
    let list = '';
    cats.forEach((cat) => {
      list += '<div class="g-cat">' + MT.t('cat_' + cat) + '</div>';
      MT.DATA.glossary.filter((g) => g.cat === cat).forEach((g) => {
        const isOpen = unlocked[g.id];
        if (!isOpen && !showLocked) {
          list += '<div class="g-item locked">' + MT.t('locked') + '</div>';
          return;
        }
        list += '<button class="g-item' + (focus === g ? ' active' : '') + (isOpen ? '' : ' dim') + '" data-action="g-open" data-id="' + g.id + '">' + (g.cat === 'rules' && experienced[g.id] ? '🏅 ' : '') + esc(MT.L(g.name)) + '</button>';
      });
    });
    const detail = focus ? entryHtml(focus, depth || defaultDepth()) : '<p class="muted">' + MT.t('g_pick') + '</p>';
    MT.UI.modal(
      '<div class="g-head"><h2>' + MT.t('glossary') + '</h2>'
      + '<span class="muted">' + MT.t('glossary_progress', { n: count(), total: MT.DATA.glossary.length }) + ' · ' + MT.t('exp_progress', { n: expCount(), total: rulesTotal() }) + '</span>'
      + '<label class="g-toggle"><input type="checkbox" data-action="g-locked"' + (showLocked ? ' checked' : '') + '> ' + MT.t('show_locked') + '</label></div>'
      + '<div class="g-body"><div class="g-list">' + list + '</div><div class="g-detail">' + detail + '</div></div>',
      'glossary-modal',
    );
    flushUnlocks();
  }

  // ── 滑鼠移上顯示一句話解釋 ──
  function showTip(el) {
    const g = byId[el.dataset.term];
    if (!g) return;
    const tip = document.getElementById('tooltip');
    tip.innerHTML = '<b>' + esc(displayName(g)) + '</b><div>' + esc(MT.L(g.one)) + '</div><div class="muted">🍜 ' + esc(MT.L(g.analogy)) + '</div>';
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 24);
    tip.style.width = w + 'px';
    let left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
    let top = r.bottom + 8;
    if (top + tip.offsetHeight > window.innerHeight - 8) top = r.top - tip.offsetHeight - 8;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }

  function hideTip() {
    document.getElementById('tooltip').hidden = true;
  }

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('.term');
    if (el) showTip(el);
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('.term')) hideTip();
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.term');
    if (el) { hideTip(); openGlossary(el.dataset.term); return; }
    const a = e.target.closest('[data-action^="g-"]');
    if (!a) return;
    if (a.dataset.action === 'g-open') openGlossary(a.dataset.id);
    if (a.dataset.action === 'g-depth') openGlossary(a.dataset.id, Number(a.dataset.depth));
  });
  document.addEventListener('change', (e) => {
    if (e.target.dataset && e.target.dataset.action === 'g-locked') {
      showLocked = e.target.checked;
      const active = document.querySelector('.g-item.active');
      openGlossary(active ? active.dataset.id : null);
    }
  });

  MT.Gloss = { rich, flushUnlocks, openGlossary, count, total: () => MT.DATA.glossary.length, esc, markExperienced, expCount };
})();

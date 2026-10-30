// 錢潮 MoneyTide © 2026 麥麥的遊戲工廠 保留所有權利 All rights reserved. 詳見 LICENSE
// 成就系統：只計算真人玩家，解鎖紀錄跨局保存在本機。每個成就都連到一個金融觀念。
window.MT = window.MT || {};

(function () {
  const E = MT.Engine;
  const C = E.Calc;
  const M = MT.Macro;
  const STORE = 'mt_ach';

  const has = (logs, key, p) => logs.some((e) => e.key === key && e.params.name === p.name);

  const LIST = [
    { id: 'first_passive', icon: '💧', term: 'passive_income', name: { zh: '第一滴被動收入', en: 'First Drop of Passive Income' },
      desc: { zh: '擁有第一筆被動收入', en: 'Earn your first passive income' },
      test: (g, p) => C.passive(g, p) > 0 },
    { id: 'first_stock', icon: '📈', term: 'stock', name: { zh: '股東登場', en: 'Shareholder Debut' },
      desc: { zh: '第一次買進股票或 ETF', en: 'Buy your first stock or ETF' },
      test: (g, p) => Object.keys(p.holdings).some((id) => ['stock', 'etf'].indexOf(M.byId[id].type) >= 0) },
    { id: 'diversified', icon: '🧺', term: 'diversification', name: { zh: '雞蛋分籃放', en: 'Eggs in Many Baskets' },
      desc: { zh: '同時持有 5 種以上不同的投資商品', en: 'Hold 5 or more different instruments at once' },
      test: (g, p) => Object.keys(p.holdings).length >= 5 },
    { id: 'landlord', icon: '🏘️', term: 'rental_income', name: { zh: '包租公 / 包租婆', en: 'Landlord' },
      desc: { zh: '同時擁有 3 間房地產', en: 'Own 3 properties at once' },
      test: (g, p) => p.assets.filter((a) => a.kind === 'realestate').length >= 3 },
    { id: 'boss', icon: '🏪', term: 'business_risk', name: { zh: '當老闆', en: 'The Boss' },
      desc: { zh: '同時擁有 3 個事業', en: 'Own 3 businesses at once' },
      test: (g, p) => p.assets.filter((a) => a.kind === 'business').length >= 3 },
    { id: 'debt_free', icon: '🕊️', term: 'liability', name: { zh: '無債一身輕', en: 'Debt Free' },
      desc: { zh: '還清所有負債', en: 'Pay off every debt' },
      test: (g, p, logs) => (has(logs, 'log_debt_paid', p) || has(logs, 'log_payoff', p))
        && !p.liabilities.length && !p.bankLoan && !C.marginLoan(p) },
    { id: 'scholar', icon: '🎓', term: 'compound', name: { zh: '學霸', en: 'Top Student' },
      desc: { zh: '連續答對 3 題進修問答', en: 'Answer 3 quiz questions in a row correctly' },
      test: (g, p, logs, st) => st.quizStreak >= 3 },
    { id: 'prophet', icon: '🔮', term: 'central_bank', name: { zh: '央行預言家', en: 'Central Bank Oracle' },
      desc: { zh: '猜中央行決議 3 次', en: 'Guess 3 central bank decisions correctly' },
      test: (g, p, logs, st) => st.cbRight >= 3 },
    { id: 'auction', icon: '🔨', term: 'winners_curse', name: { zh: '得標！', en: 'Sold to You!' },
      desc: { zh: '在拍賣中得標', en: 'Win an auction' },
      test: (g, p, logs) => has(logs, 'log_auction_win', p) },
    { id: 'winter', icon: '🧥', term: 'business_cycle', name: { zh: '撐過寒冬', en: 'Survived the Winter' },
      desc: { zh: '經歷一次衰退後，被動收入仍然是正的', en: 'Come out of a recession with positive passive income' },
      test: (g, p, logs, st, ctx) => ctx.prevPhase === 'recession' && g.macro.phase === 'recovery' && C.passive(g, p) > 0 && !p.bankrupt },
    { id: 'margin_lesson', icon: '🩹', term: 'margin_call', name: { zh: '學到教訓', en: 'Lesson Learned' },
      desc: { zh: '第一次被融資斷頭', en: 'Suffer your first margin call' },
      test: (g, p, logs) => has(logs, 'log_margin_call', p) },
    { id: 'caught', icon: '🚔', term: 'market_manipulation', name: { zh: '法網恢恢', en: 'Busted' },
      desc: { zh: '使用違法卡被抓到', en: 'Get caught using an illegal card' },
      test: (g, p, logs) => has(logs, 'log_caught', p) },
    { id: 'ten_million', icon: '💰', term: 'net_worth', name: { zh: '千萬富翁', en: 'Ten Millionaire' },
      desc: { zh: '淨資產達到 1,000 萬', en: 'Reach a net worth of 10 million' },
      test: (g, p) => C.netWorth(g, p) >= 1e7 },
    { id: 'freedom', icon: '🌟', term: 'financial_freedom', name: { zh: '財務自由', en: 'Financially Free' },
      desc: { zh: '被動收入超過總支出', en: 'Passive income exceeds total expenses' },
      test: (g, p) => p.free },
    { id: 'collector', icon: '📘', term: null, name: { zh: '名詞收藏家', en: 'Term Collector' },
      desc: { zh: '名詞圖鑑解鎖 40 個', en: 'Unlock 40 glossary terms' },
      test: () => MT.Gloss.count() >= 40 },
    { id: 'winner', icon: '🏆', term: null, name: { zh: '冠軍', en: 'Champion' },
      desc: { zh: '贏得一局遊戲', en: 'Win a game' },
      test: (g, p) => g.phase === 'gameover' && g.winner === p.id },
  ];

  let unlocked = {};
  try { unlocked = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { unlocked = {}; }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(unlocked)); } catch (e) { /* ignore */ } }

  // 每局每位玩家的計數（連續答對、猜中央行）
  const stats = {};
  function statOf(g, p) {
    const k = g.config.seed + ':' + p.id;
    if (!stats[k]) stats[k] = { quizStreak: 0, cbRight: 0 };
    return stats[k];
  }

  // ctx = { logs: 這次新增的紀錄, prevPhase: 動作前的景氣階段 }，回傳這次新解鎖的成就
  function check(g, ctx) {
    const found = [];
    g.players.forEach((p) => {
      if (ctx.isMine ? !ctx.isMine(p) : p.ai) return;
      const st = statOf(g, p);
      ctx.logs.forEach((e) => {
        if (e.params.name !== p.name) return;
        if (e.key === 'log_quiz_right') st.quizStreak += 1;
        if (e.key === 'log_quiz_wrong') st.quizStreak = 0;
      });
      if (ctx.logs.some((e) => e.key === 'log_cb') && g.pending && g.pending.type === 'cbResult' && g.pending.correct && g.current === p.id) st.cbRight += 1;
      LIST.forEach((a) => {
        if (unlocked[a.id]) return;
        let ok = false;
        try { ok = a.test(g, p, ctx.logs, st, ctx); } catch (err) { ok = false; }
        if (ok) {
          unlocked[a.id] = { name: p.name, at: Date.now() };
          found.push({ a, p });
        }
      });
    });
    if (found.length) save();
    return found;
  }

  function count() { return LIST.filter((a) => unlocked[a.id]).length; }

  function galleryHtml() {
    const t = MT.t;
    const L = MT.L;
    const esc = MT.Gloss.esc;
    return '<h2>' + t('ach_title') + '</h2><p class="muted">' + t('ach_progress', { n: count(), total: LIST.length }) + '</p>'
      + '<div class="ach-grid">' + LIST.map((a) => {
        const u = unlocked[a.id];
        return '<div class="ach' + (u ? ' on' : '') + '"><div class="ach-icon">' + (u ? a.icon : '🔒') + '</div>'
          + '<b>' + esc(L(a.name)) + '</b><small>' + esc(L(a.desc)) + '</small>'
          + (a.term ? '<small>' + MT.Gloss.rich('[[' + a.term + ']]', false) + '</small>' : '')
          + (u ? '<small class="muted">' + esc(u.name) + '</small>' : '') + '</div>';
      }).join('') + '</div>';
  }

  MT.Ach = { LIST, check, count, total: () => LIST.length, galleryHtml };
})();

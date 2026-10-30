// 錢潮 MoneyTide © 2026 麥麥的遊戲工廠 保留所有權利 All rights reserved. 詳見 LICENSE
// 新手教學：用提示泡泡一步一步帶玩家玩第一年。需要玩家動手的步驟，會等玩家真的做了才往下。
window.MT = window.MT || {};

(function () {
  const DONE_KEY = 'mt_tutorial_done';

  // target：要框起來的元素；wait：回傳 true 時自動進到下一步（沒有 wait 就顯示「下一步」按鈕）
  const STEPS = [
    { target: '.pcard[data-id="0"]',
      text: { zh: '👋 歡迎來到《錢潮》！這是你的玩家卡。遊戲目標：讓[[passive_income]]超過每月總支出，就能[[financial_freedom|財務自由]]、脫離[[rat_race]]。', en: '👋 Welcome to MoneyTide! This is your player card. The goal: make [[passive_income]] exceed your monthly expenses to reach [[financial_freedom]] and escape the [[rat_race]].' } },
    { target: '#statement', tab: 'statement',
      text: { zh: '📋 這是你的財報。上面是每月收入與支出，相減就是[[cashflow]]；下面的進度條就是財務自由的進度。', en: '📋 Your financial statement. Monthly income minus expenses is your [[cashflow]]; the bar below shows your progress to freedom.' } },
    { target: '#statement .term',
      text: { zh: '💡 有黃色底線的字都是金融名詞，滑鼠移上去看一句話解釋，點下去看完整說明。看過的名詞會收進「📘 名詞圖鑑」。', en: '💡 Words with a yellow underline are finance terms: hover for a one-line explanation, click for the full card. They are collected in the 📘 Glossary.' } },
    { target: '[data-action="roll"]',
      text: { zh: '🎲 輪到你了！按「擲骰子」前進。經過或停在 💰 發薪日，就會領到半年的現金流。', en: '🎲 Your turn! Press “Roll dice” to move. Passing or landing on 💰 Payday pays six months of cashflow.' },
      wait: (g) => g.lastRoll != null && !MT.UI.anim },
    { target: '.center-body',
      text: { zh: '🃏 每一格都有事件。讀完卡片上的說明（💡 是小知識），再按按鈕做決定。投資機會要看「年報酬率」：越高越好，但也要看風險。', en: '🃏 Every tile has an event. Read the card (💡 marks a tip), then choose. For deals, check the annual return — higher is better, but mind the risk.' },
      wait: (g) => g.phase !== 'resolve' },
    { target: '[data-action="rtab"][data-tab="market"]',
      text: { zh: '📈 點「市場」分頁可以買股票、ETF、債券。新手可以從「台灣 50 ETF」開始：一次買進 50 家大公司，最簡單的[[diversification]]。', en: '📈 Open the Market tab to buy stocks, ETFs and bonds. Beginners can start with the Taiwan 50 ETF — 50 big companies at once, the simplest [[diversification]].' },
      wait: () => MT.UI.rightTab === 'market' },
    { target: '.mgrid',
      text: { zh: '🌍 這裡是總體經濟：景氣、通膨、利率……它們會影響所有商品的價格。棋盤背景也會跟著景氣換季！', en: '🌍 Here is the macro economy — cycle, inflation, rates — which moves every price. The board even changes season with the cycle!' } },
    { target: '[data-action="end-turn"]',
      text: { zh: '➜ 做完決定後按「結束回合」，電腦對手就會接著玩。等一下每一季結束時，會跳出季報。', en: '➜ When you’re done, press “End turn” and the computer plays. At the end of each quarter a report pops up.' },
      wait: (g) => g.current !== 0 || g.round > 1 },
    { target: '.modal-card.report-modal',
      text: { zh: '📊 這是季報：告訴你這一季景氣、利率、匯率怎麼變，以及「💡 為什麼會這樣？」。看完按「知道了」。', en: '📊 The quarterly report: how the cycle, rates and FX changed — and “💡 Why did this happen?”. Press “Got it” when done.' },
      wait: (g) => g.round > 1 && MT.UI.modalKind !== 'report-modal' && g.current === 0,
      skipIf: (g) => g.round > 1 && MT.UI.modalKind !== 'report-modal' },
    { target: '#topbar .top-btns',
      text: { zh: '🎉 你已經學會基本玩法了！小提醒：現金不夠可以在財報向銀行借款，但借越多、升息時壓力越大。上方有 📘 名詞圖鑑、🏅 成就、⚙️ 設定。祝你早日財務自由！', en: '🎉 You know the basics! Tip: you can borrow from the bank in the statement — but the more you borrow, the harder rate hikes hit. Up top are the 📘 Glossary, 🏅 Achievements and ⚙️ Settings. Good luck!' },
      last: true },
  ];

  const T = { active: false, i: 0, timer: null };

  function done() { try { return localStorage.getItem(DONE_KEY) === '1'; } catch (e) { return false; } }

  function start() {
    const s = MT.UI.setup;
    Object.assign(s, {
      count: 2, names: [MT.t('tut_you'), '', '', ''], kinds: ['human', 'ai', 'ai', 'ai'], styles: ['value', 'conservative', 'momentum', 'macro'],
      difficulty: 'easy', victory: 'freedom', length: 'short', roleMode: 'equal', seed: 'tutorial', aiLevel: 'easy', aiSpeed: 'normal',
    });
    MT.UI.startGame();
    T.active = true;
    T.i = 0;
    T.shownStep = -1;
    clearInterval(T.timer);
    T.timer = setInterval(tick, 300);
    tick();
  }

  function stop(finished) {
    T.active = false;
    clearInterval(T.timer);
    ['tut-bubble', 'tut-ring'].forEach((id) => { const el = document.getElementById(id); if (el) el.remove(); });
    if (finished) { try { localStorage.setItem(DONE_KEY, '1'); } catch (e) { /* ignore */ } }
  }

  function next() {
    T.i += 1;
    if (T.i >= STEPS.length) { stop(true); MT.Audio.play('fanfare'); MT.FX.confetti(80); return; }
    MT.Audio.play('chime');
    tick();
  }

  function tick() {
    if (!T.active) return;
    const g = MT.UI.game;
    if (!g || document.getElementById('game').hidden) { stop(false); return; }
    let step = STEPS[T.i];
    while (step && step.skipIf && T.shownStep !== T.i && step.skipIf(g)) { T.i += 1; step = STEPS[T.i]; }
    if (!step) { stop(true); return; }
    if (step.wait && step.wait(g)) { next(); return; }
    if (step.tab && MT.UI.rightTab !== step.tab) { MT.UI.rightTab = step.tab; MT.UI.rerender(); }
    const target = document.querySelector(step.target);
    render(step, target);
  }

  function render(step, target) {
    let ring = document.getElementById('tut-ring');
    let bubble = document.getElementById('tut-bubble');
    if (!ring) { ring = document.createElement('div'); ring.id = 'tut-ring'; document.body.appendChild(ring); }
    if (!bubble) { bubble = document.createElement('div'); bubble.id = 'tut-bubble'; document.body.appendChild(bubble); }
    if (T.shownStep !== T.i) {
      T.shownStep = T.i;
      bubble.innerHTML = '<div class="tut-top"><b>' + MT.t('tut_title') + '</b><span class="muted small">' + (T.i + 1) + ' / ' + STEPS.length + '</span></div>'
        + '<p>' + MT.Gloss.rich(step.text) + '</p>'
        + '<div class="tut-btns"><button class="btn sm ghost" data-tut="skip">' + MT.t('tut_skip') + '</button>'
        + (step.wait ? '<span class="small muted">' + MT.t('tut_wait') + '</span>' : '<button class="btn sm primary" data-tut="next">' + MT.t(step.last ? 'tut_finish' : 'tut_next') + '</button>')
        + '</div>';
      MT.Gloss.flushUnlocks();
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if (!target) { ring.style.display = 'none'; placeBubble(bubble, null); return; }
    const r = target.getBoundingClientRect();
    ring.style.display = 'block';
    ring.style.left = (r.left - 6) + 'px';
    ring.style.top = (r.top - 6) + 'px';
    ring.style.width = (r.width + 12) + 'px';
    ring.style.height = (r.height + 12) + 'px';
    placeBubble(bubble, r);
  }

  function placeBubble(b, r) {
    const w = Math.min(340, window.innerWidth - 24);
    b.style.width = w + 'px';
    if (!r) { b.style.left = ((window.innerWidth - w) / 2) + 'px'; b.style.top = '80px'; return; }
    let top = r.bottom + 14;
    if (top + b.offsetHeight > window.innerHeight - 10) top = Math.max(10, r.top - b.offsetHeight - 14);
    if (top < 10 || top + b.offsetHeight > window.innerHeight - 10) top = window.innerHeight - b.offsetHeight - 12;
    b.style.top = top + 'px';
    b.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + 'px';
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tut]');
    if (!b) return;
    if (b.dataset.tut === 'skip') stop(true);
    if (b.dataset.tut === 'next') next();
  });

  MT.Tutorial = { start, stop, isDone: done, active: () => T.active };
})();

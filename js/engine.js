// 錢潮 MoneyTide © 2026 麥麥的遊戲工廠 保留所有權利 All rights reserved. 詳見 LICENSE
// 遊戲引擎：只處理規則與狀態，不碰畫面。
// 所有變化都透過 dispatch(state, action) 進行，之後做網路連線時只需同步 action。
window.MT = window.MT || {};

(function () {
  const R = MT.RNG;
  const D = MT.DATA;
  const M = MT.Macro;

  const LOAN_UNIT = 100000;
  const CHILD_COST = 6000;
  const QUIZ_REWARD = { easy: 10000, medium: 20000, hard: 30000 };
  const CB_REWARD = 20000;
  const PAYDAY_MONTHS = 6; // 一圈約 7 回合（21 個月）、經過 3 次發薪日，每次 6 個月讓時間大致對得上
  const WORLD_CHANCE = { easy: 0.25, medium: 0.3, hard: 0.4 }; // 每季抽到世界新聞的機率
  const HAND_LIMIT = 5;
  const SHORT_NOTIONAL = 500000; // 放空狙擊卡的放空金額
  const AUCTION_START = 0.6; // 拍賣起標價 = 頭期款 × 60%
  // ── 槓桿風險（M5）──
  const MARGIN_LEVERAGE = 2.5; // 融資：自備 4 成、借 6 成，總部位 = 自備 × 2.5
  const MARGIN_RATE = 0.065 / 12; // 融資月利率（年 6.5%）
  const MAINTENANCE = 1.3; // 維持率低於 130% 就斷頭
  const BANK_SPREAD = 9.75; // 銀行借款年利率 = 央行利率 + 9.75%（一開始 12%）
  const INSOLVENT_MONTHS = 6; // 破產淘汰制：淨資產比起點（起點為負時）再少 6 個月薪資即破產
  const START_RATE = 2.25; // 遊戲開始時的央行利率（接近長期平衡點，升降息機會差不多）
  const FAIL_PHASE = { recovery: 0.015, expansion: 0.008, overheat: 0.012, recession: 0.05 }; // 事業每季倒閉機率
  const FAIL_DIFF = { easy: 0.4, medium: 0.8, hard: 1.3 };
  const BIZ_PHASE = { recovery: 1, expansion: 1.12, overheat: 1.05, recession: 0.7 }; // 事業現金流倍數
  const RENT_PHASE = { recovery: 1, expansion: 1, overheat: 1, recession: 0.9 }; // 衰退時空租變多
  const RISK_DAMP = { easy: 0.5, medium: 0.8, hard: 1 }; // 景氣對收入的影響程度（初級較溫和）
  const COLORS = ['#e8505b', '#2f86eb', '#f4b400', '#22a06b'];

  const lengthRounds = { short: 20, medium: 32, long: 48 };
  const SAVE_VERSION = 5; // 存檔格式版本：改動遊戲狀態結構時要加 1（畫面讀檔也用這個數字）

  // ── 保險、退休、稅務、創業（M8）──
  const PREMIUM = { medical: 800, property: 500, life: 1000 }; // 每月保費
  const PENSION_EMPLOYER = 0.06; // 雇主提撥勞退 6%
  const PENSION_SELF = 0.06; // 自提 6%
  const PENSION_RETURN = 0.03 / 4; // 勞退帳戶每季報酬（年 3%）
  const LABOR_PENSION = 0.4; // 勞保年金 ≈ 退休前薪資 4 成
  const RETIRE_LIVING = 0.8; // 退休後不用通勤、應酬，生活費約剩 8 成
  const RETIRE_EARLY_MAX = 20; // 最多提早 5 年（20 季）退休
  const RETIRE_EARLY_CUT = 0.01; // 每提早 1 季，勞保年金少 1%（每年 4%）
  const PENSION_MONTHS = 240; // 勞退帳戶分 20 年領
  const SAVINGS_DEDUCTION = 270000; // 每年利息免稅額
  // 事業升級：從第 stage 階段升到下一階段的花費（× 原始價格）、現金流倍數、成功率
  const UPGRADE = [null, { cost: 1.5, mult: 2.2, chance: 0.8 }, { cost: 5, mult: 6, chance: 0.65 }];
  const UPGRADE_PHASE = { recovery: 0, expansion: 0.1, overheat: 0.05, recession: -0.2 };
  const IPO_PE = { recovery: 14, expansion: 18, overheat: 22, recession: 9 }; // 上市時市場給的本益比
  const IPO_FEE = 0.05; // 承銷與上市費用

  // ── M9：定期定額、自住房、限價單、信用卡、人生目標 ──
  const DCA_MAX = 3; // 最多 3 檔定期定額
  const HOMES = { small: { price: 6000000, rent: 12000 }, family: { price: 12000000, rent: 20000 } }; // 房價（以房價指數 1 計）與省下的房租
  const HOME_DOWN = 0.2; // 頭期款 2 成
  const HOME_CLOSING = 0.02; // 契稅、代書、仲介等買房成本
  const HOME_SELL_FEE = 0.04;
  const HOME_SPREAD = 0.6; // 房貸利率 = 央行利率 + 0.6%
  const ORDER_MAX = 5; // 最多同時 5 張掛單
  const ORDER_ROUNDS = 4; // 掛單有效 4 季
  const CARD_APR = 0.15; // 信用卡循環利率（年）
  const CARD_MIN = 0.03; // 最低應繳 = 欠款 3%（至少 1,000）
  const GOAL_BONUS = 1000000; // 達成人生目標：淨資產排名加 100 萬
  const GOAL_FREEDOM_BONUS = 0.1; // 財務自由模式：進度加 10 個百分點
  const GOALS = ['home', 'debtfree', 'passive', 'nest', 'emergency', 'boss', 'fire'];

  function money(n) { return { money: n }; }

  function log(state, key, params) {
    state.log.push({ round: state.round, key, params: params || {} });
  }

  function newId(state) {
    state.nextId += 1;
    return 'x' + state.nextId;
  }

  // ── 財報計算（s = 遊戲狀態，用來取得市場價格）──
  const Calc = {
    loanRate(p) {
      const r = p.loanRate || 0.01; // 浮動利率，每季結算時更新
      return p.skill === 'doctor' ? r - 0.001 : r;
    },
    marginLoan(p) { return Object.keys(p.margin || {}).reduce((s, id) => s + p.margin[id], 0); },
    marginInterest(p) { return Math.round(Calc.marginLoan(p) * MARGIN_RATE); },
    loanPayment(p) { return Math.round(p.bankLoan * Calc.loanRate(p)); },
    assetIncome(p) { return p.assets.reduce((s, a) => s + a.cashflow, 0); },
    passive(s, p) { return Calc.assetIncome(p) + M.dividendMonthly(s, p); },
    debtPayments(p) { return p.liabilities.reduce((s, l) => s + l.payment, 0); },
    childCost(p) { return p.retired ? 0 : p.children * CHILD_COST; }, // 退休時孩子已經長大
    premium(p) { return Object.keys(PREMIUM).reduce((sum, k) => sum + (p.policies && p.policies[k] ? PREMIUM[k] : 0), 0); },
    selfPension(p) { return p.pension && p.pension.self && !p.retired ? Math.round(p.salary * PENSION_SELF) : 0; },
    pensionIncome(p) { return p.retired && p.pension ? p.pension.labor + (p.pension.acct > 0 ? p.pension.fromAcct : 0) : 0; },
    scamIncome(p) { return p.assets.reduce((s, a) => s + (a.kind === 'scam' ? a.cashflow : 0), 0); },
    expenses(p) { return Math.round(p.living) + p.tax + Calc.childCost(p) + Calc.debtPayments(p) + Calc.loanPayment(p) + Calc.marginInterest(p) + Calc.premium(p) + Calc.selfPension(p); },
    income(s, p) { return Math.round(p.salary) + Calc.passive(s, p) + Calc.pensionIncome(p); },
    cashflow(s, p) { return Calc.income(s, p) - Calc.expenses(p); },
    // 詐騙的「配息」不算真正的被動收入，不能拿來判定財務自由
    realPassive(s, p) { return Calc.passive(s, p) - Calc.scamIncome(p); },
    freedom(s, p) {
      const e = Calc.expenses(p);
      return e <= 0 ? 1 : Calc.realPassive(s, p) / e;
    },
    netWorth(s, p) {
      const assets = p.cash + p.home + p.assets.reduce((sum, a) => sum + assetValue(a), 0) + M.holdingValue(s, p) + (p.pension ? p.pension.acct : 0);
      const debts = p.bankLoan + Calc.marginLoan(p)
        + p.liabilities.filter((l) => l.lender == null).reduce((sum, l) => sum + l.balance, 0)
        + p.liabilities.filter((l) => l.lender != null).reduce((sum, l) => sum + l.principal, 0)
        + p.assets.reduce((sum, a) => sum + a.mortgage, 0);
      return assets - debts;
    },
  };

  // 賽後複盤用的統計（舊存檔沒有就補上）
  function stat(p) {
    if (!p.stats) p.stats = { fees: 0, tax: 0, interest: 0, spend: 0, realized: [] };
    if (p.stats.premium == null) { p.stats.premium = 0; p.stats.claims = 0; }
    return p.stats;
  }

  function snapshot(state) {
    return {
      round: state.round,
      nw: state.players.map((p) => Math.round(Calc.netWorth(state, p))),
      passive: state.players.map((p) => Calc.passive(state, p)),
      bench: state.players.map((p) => Math.round(((p.shadow && p.shadow.units) || 0) * M.priceTWD(state, 'TW50'))),
    };
  }

  // 資產目前的市價（房地產跟著房價指數、事業跟著獲利能力）
  function assetValue(a) { return a.value != null ? a.value : a.cost; }

  // 惡意併購要付給對方的錢：市價 × 1.2 − 承接的貸款
  function takeoverPrice(a) { return Math.round(assetValue(a) * 1.2) - a.mortgage; }

  // ── 自訂售價出售資產 ──
  // 仲介費／交易成本：房地產 4%、事業 5%
  const SALE_FEE = { realestate: 0.04, business: 0.05 };
  // 景氣好買家多、願意出高價；衰退時買家少
  const SALE_PHASE = { recovery: 0, expansion: 0.1, overheat: 0.15, recession: -0.2 };

  // 開價 price 時找到買家的機率：開價 ≤ 市價 85% 一定賣得掉，開價越高越難成交
  function saleChance(state, a, price) {
    const ratio = price / Math.max(1, assetValue(a));
    if (ratio <= 0.85) return 1;
    return Math.max(0, Math.min(1, (1.25 - ratio) / 0.4 + SALE_PHASE[state.macro.phase]));
  }

  // 成交後實拿：售價 − 仲介費 − 房地合一稅 − 還清剩餘貸款（可能是負數＝要倒貼）
  function saleQuote(a, price, round) {
    const fee = Math.round(price * (SALE_FEE[a.kind] || 0.05));
    const gain = price - fee - a.cost;
    const taxRate = a.kind === 'realestate' && round != null ? landTaxRate(a, round) : 0;
    const tax = gain > 0 ? Math.round(gain * taxRate) : 0;
    return { fee, tax, taxRate, net: price - fee - tax - a.mortgage, gain: gain - tax };
  }

  // ── 事業升級與上市 ──
  function upgradeInfo(state, a) {
    if (!a.chain || a.stage >= 3) return null;
    const u = UPGRADE[a.stage];
    const next = D.chains[a.chain][a.stage - 1];
    return {
      cost: Math.round(a.cost0 * u.cost), cashflow: Math.round(a.base0 * u.mult),
      chance: Math.max(0.1, Math.min(0.95, u.chance + UPGRADE_PHASE[state.macro.phase])), name: next.name, icon: next.icon,
    };
  }
  function ipoQuote(state, a) {
    const pe = IPO_PE[state.macro.phase];
    const value = Math.max(0, a.cashflow) * 12 * pe;
    const fee = Math.round(value * IPO_FEE);
    return { pe, value: Math.round(value), fee, net: Math.round(value) - fee - a.mortgage, gain: Math.round(value) - fee - a.cost };
  }

  // 事業倒閉：投入的錢歸零，剩下的貸款變成負債
  function closeBusiness(state, p, a) {
    p.assets = p.assets.filter((x) => x !== a);
    stat(p).realized.push({ name: a.name, gain: -(a.cost - a.mortgage), round: state.round, failed: true });
    if (a.mortgage > 0) {
      p.liabilities.push({
        id: newId(state), name: { zh: a.name.zh + '剩餘貸款', en: 'Leftover loan: ' + a.name.en },
        balance: a.mortgage, payment: Math.round(a.mortgage / 180),
      });
    }
  }

  function makeAsset(state, card, deck) {
    const a = {
      id: newId(state), card: card.id, deck, name: card.name, icon: card.icon, kind: card.kind,
      cost: card.cost, value: card.cost, mortgage: card.cost - card.down, cashflow: card.cashflow,
      base: card.cashflow, rate0: state.macro.rate, reIdx: state.market.reIndex, risk: card.risk || 1,
      bought: state.round,
    };
    if (card.scam) { a.lasts = card.lasts; a.age = 0; }
    if (card.chain) { a.chain = card.chain; a.stage = 1; a.cost0 = card.cost; a.base0 = card.cashflow; }
    return a;
  }

  // ── 房地合一稅：持有越短稅率越高（1 回合 = 1 季）──
  function landTaxRate(a, round) {
    const held = round - (a.bought || 0);
    return held < 8 ? 0.45 : held < 20 ? 0.35 : held < 40 ? 0.2 : 0.15;
  }

  const strategyById = {};
  D.strategy.forEach((c) => { strategyById[c.id] = c; });

  function getCard(deck, id) {
    if (deck === 'quiz') return D.quiz.find((q) => q.id === id);
    if (deck === 'strategy') return strategyById[id];
    return D.cards[deck].find((c) => c.id === id);
  }

  function strategyPool(state) {
    const lv = M.LEVELS[state.config.difficulty];
    const ids = [];
    const solo = state.players.length < 2;
    D.strategy.forEach((c) => {
      if (M.LEVELS[c.level] > lv) return;
      if (c.mode && c.mode !== state.config.victory) return;
      if (solo && (c.kind === 'attack' || c.id === 'legal')) return; // 單人遊戲沒有對手可以攻擊
      for (let i = 0; i < c.count; i++) ids.push(c.id);
    });
    return ids;
  }

  function refill(state, deck) {
    if (state.decks[deck].length) return;
    let ids;
    if (deck === 'quiz') ids = D.quiz.filter((q) => q.level === state.config.difficulty).map((q) => q.id);
    else if (deck === 'strategy') ids = strategyPool(state);
    else ids = D.cards[deck].map((c) => c.id);
    state.decks[deck] = R.shuffle(state, ids);
  }

  function draw(state, deck) {
    refill(state, deck);
    return state.decks[deck].shift();
  }

  // 工程師技能：預看下一張市場消息
  function peek(state, deck) {
    refill(state, deck);
    return state.decks[deck][0];
  }

  // 下一季的世界新聞與景氣階段事先決定好，情報卡才能預看
  function makeForecast(state) {
    const world = R.next(state) < WORLD_CHANCE[state.config.difficulty] ? draw(state, 'world') : null;
    const card = world ? getCard('world', world) : null;
    const phase = (card && card.effect.phase) || M.rollPhase(state);
    state.forecast = { world, phase };
  }

  function makePlayer(state, cfg, index, prof, withSkill) {
    return {
      id: index,
      name: cfg.name,
      color: COLORS[index],
      prof: prof.id,
      salary: prof.salary,
      living: prof.living,
      tax: prof.tax,
      cash: prof.cash,
      home: prof.home,
      children: 0,
      liabilities: prof.liabilities.map((l) => ({
        id: newId(state), name: l.name, balance: l.balance, payment: l.payment,
        floating: !!l.floating, base: l.payment, rate0: START_RATE, orig: true,
      })),
      assets: [],
      holdings: {},
      cost: {},
      hand: [],
      bankLoan: 0,
      loanRate: (START_RATE + BANK_SPREAD) / 1200,
      margin: {},
      pos: 0,
      skill: withSkill && prof.skill ? prof.id : null,
      ai: cfg.ai || null, // { style, level }：電腦玩家
      skipPaydays: 0,
      poached: 0,
      hedgeRound: 0,
      shieldUsed: false,
      bankrupt: false,
      free: false,
      policies: { medical: false, property: false, life: false },
      pension: { acct: 0, self: false, labor: 0, fromAcct: 0 },
      retired: false,
      // homeCost：遊戲中買的房子才記買價、跟著房價指數變動；開局就有的房子維持原價（避免高薪職業優勢再擴大）
      homeCost: 0, homeIdx: 1, homeBought: 0,
      dca: [],
      orders: [],
      goal: null,
    };
  }

  // 人生目標：開局隨機抽一個（已經有房子的人不會抽到「成家」，沒有退休階段就不會抽到「提早退休」）
  function pickGoal(state, p) {
    const pool = GOALS.filter((g) => !(g === 'home' && p.home > 0) && !(g === 'fire' && !state.config.retire));
    p.goal = pool[R.int(state, 0, pool.length - 1)];
  }
  // 回傳 { done, ratio }：ratio 是進度（0–1）
  function goalProgress(state, p) {
    const pr = (x) => Math.max(0, Math.min(1, x));
    switch (p.goal) {
      case 'home': return { done: p.home > 0, ratio: p.home > 0 ? 1 : pr(p.cash / (HOMES.small.price * state.market.reIndex * (HOME_DOWN + HOME_CLOSING))) };
      case 'debtfree': {
        const debt = p.liabilities.reduce((s, l) => s + (l.lender != null ? l.principal : l.balance), 0) + p.bankLoan + Calc.marginLoan(p);
        return { done: debt <= 0 && state.round >= 8, ratio: debt <= 0 ? 1 : 0 };
      }
      case 'passive': return { done: Calc.realPassive(state, p) >= 30000, ratio: pr(Calc.realPassive(state, p) / 30000) };
      case 'nest': return { done: M.holdingValue(state, p) >= 5000000, ratio: pr(M.holdingValue(state, p) / 5000000) };
      case 'emergency': return { done: p.cash >= Calc.expenses(p) * 12, ratio: pr(p.cash / (Calc.expenses(p) * 12)) };
      case 'boss': {
        const best = p.assets.reduce((m, a) => Math.max(m, a.chain ? a.stage : 0), 0);
        return { done: best >= 2 || !!p.ipoDone, ratio: p.ipoDone ? 1 : best / 2 };
      }
      case 'fire': return { done: !!p.retired && p.retiredRound < state.config.retireRound, ratio: p.retired ? 1 : 0 };
      default: return { done: false, ratio: 0 };
    }
  }
  function checkGoal(state, p) {
    if (!p.goal || p.goalDone || p.bankrupt) return;
    if (goalProgress(state, p).done) {
      p.goalDone = state.round;
      log(state, 'log_goal', { name: p.name, goal: { key: 'goal_' + p.goal } });
    }
  }

  // ── 自住房 ──
  function homeQuote(state, p, kind) {
    const h = HOMES[kind];
    const price = Math.round((h.price * state.market.reIndex) / 10000) * 10000;
    const down = Math.round(price * HOME_DOWN);
    const closing = Math.round(price * HOME_CLOSING);
    const loan = price - down;
    const rate = (state.macro.rate + HOME_SPREAD) / 1200;
    const payment = loanPayment(loan, 360, rate);
    return { kind, price, down, closing, loan, payment, rent: h.rent, change: h.rent - payment, rate: state.macro.rate + HOME_SPREAD };
  }
  function homeMortgage(p) { return p.liabilities.filter((l) => l.home || (l.orig && l.floating)); }
  function homeSaleQuote(state, p) {
    const value = p.home;
    const fee = Math.round(value * HOME_SELL_FEE);
    const debt = homeMortgage(p).reduce((s, l) => s + l.balance, 0);
    const gain = value - fee - (p.homeCost || value);
    // 自住房：持有滿 6 年，400 萬以內免稅、超過的部分 10%；未滿 6 年依一般房地合一稅
    const held = state.round - (p.homeBought || 0);
    const tax = gain <= 0 ? 0 : held >= 24 ? Math.round(Math.max(0, gain - 4000000) * 0.1) : Math.round(gain * landTaxRate({ bought: p.homeBought || 0 }, state.round));
    const rent = p.homeRent || Math.round((value * 0.002) / 100) * 100;
    return { value, fee, debt, tax, gain: gain - tax, net: value - fee - tax - debt, rent };
  }

  function retireRoundOf(rounds) { return rounds - Math.floor(rounds * 0.1) + 1; }
  // 最早可以申請退休的回合：最多提早 5 年，而且遊戲至少要過一半（短局不能一開始就退休）
  function earliestOf(rounds, retireRound) { return Math.max(retireRound - RETIRE_EARLY_MAX, Math.ceil(rounds / 2)); }
  function earliestRetire(state) { return earliestOf(state.config.rounds, state.config.retireRound); }
  // 現在退休的勞保年金打幾折（提早退休每年少 4%）
  function retireFactor(state) { return 1 - RETIRE_EARLY_CUT * Math.max(0, state.config.retireRound - state.round); }
  function pensionQuote(state, p) {
    const factor = retireFactor(state);
    const labor = Math.round((p.salary * LABOR_PENSION * factor) / 100) * 100;
    const fromAcct = Math.round(p.pension.acct / PENSION_MONTHS);
    return { factor, labor, fromAcct, total: labor + fromAcct };
  }

  function loanPayment(amount, months, rate) {
    return Math.round((amount * rate) / (1 - Math.pow(1 + rate, -months)));
  }

  function createGame(cfg) {
    const seed = cfg.seed && cfg.seed.trim() ? cfg.seed.trim() : String(Date.now());
    const rounds = cfg.length === 'custom'
      ? Math.max(12, Math.min(80, Math.round(cfg.customRounds || 32)))
      : lengthRounds[cfg.length];
    const state = {
      version: SAVE_VERSION,
      config: {
        difficulty: cfg.difficulty,
        victory: cfg.victory,
        roleMode: cfg.roleMode,
        rounds,
        seed,
        // 退休：最後 1 成的回合強制退休（法定退休年齡）；最多可以提早 5 年自己申請
        retire: cfg.retire !== false,
        retireRound: retireRoundOf(rounds),
      },
      rng: R.seedFrom(seed),
      round: 1,
      current: 0,
      phase: 'roll',
      pending: null,
      lastRoll: null,
      log: [],
      turnLogStart: 0,
      players: [],
      decks: {},
      winner: null,
      ranking: null,
      endReason: null,
      nextId: 1,
    };

    const pool = R.shuffle(state, D.professions.filter((p) => p.id !== 'equal'));
    const equal = D.professions.find((p) => p.id === 'equal');
    cfg.players.forEach((pc, i) => {
      const prof = cfg.roleMode === 'equal' ? equal : pool[i % pool.length];
      const p = makePlayer(state, pc, i, prof, cfg.roleMode === 'skill');
      p.liabilities.forEach((l) => { if (l.floating && p.home > 0) l.home = true; });
      state.players.push(p);
    });
    state.players.forEach((p) => pickGoal(state, p));

    ['doodad', 'small', 'big', 'life', 'market', 'world', 'geo', 'strategy', 'quiz'].forEach((k) => { state.decks[k] = []; });
    M.init(state);
    makeForecast(state);
    state.players.forEach((p) => {
      p.nw0 = Calc.netWorth(state, p); // 起點淨資產（學貸、車貸會讓它為負）
      stat(p);
      // 大盤對照組：同一個人只上班、把每次發薪剩下的錢全買台灣 50 ETF
      p.shadow = { units: p.cash / M.priceTWD(state, 'TW50') };
    });
    state.history = [snapshot(state)];

    log(state, 'log_start');
    logRound(state);
    state.turnLogStart = state.log.length;
    return state;
  }

  function roundInfo(round) {
    return { year: Math.floor((round - 1) / 4) + 1, q: ((round - 1) % 4) + 1 };
  }

  function logRound(state) {
    log(state, 'log_round', roundInfo(state.round));
  }

  // ── 手牌 ──
  function hasCard(p, id) { return p.hand.indexOf(id) >= 0; }
  function useCard(p, id) {
    const i = p.hand.indexOf(id);
    if (i >= 0) p.hand.splice(i, 1);
  }
  function gainCard(state, p) {
    if (p.hand.length >= HAND_LIMIT) return null;
    const id = draw(state, 'strategy');
    p.hand.push(id);
    log(state, 'log_card_gain', { name: p.name, card: strategyById[id].name });
    return id;
  }

  // ── 金錢處理 ──
  function payCash(state, p, amount) {
    if (amount <= 0) return;
    if (p.cash < amount) {
      const loan = Math.ceil((amount - p.cash) / LOAN_UNIT) * LOAN_UNIT;
      p.bankLoan += loan;
      p.cash += loan;
      log(state, 'log_autoloan', { name: p.name, amount: money(loan) });
      // 退休後現金流本來就常是負的（花老本），只有資不抵債才算破產（季結算時檢查）
      if (state.config.victory === 'bankrupt' && Calc.cashflow(state, p) < 0 && !p.retired) {
        p.cash -= amount;
        goBankrupt(state, p);
        return;
      }
    }
    p.cash -= amount;
  }

  function goBankrupt(state, p) {
    // 政府紓困卡：免除部分銀行借款，之後每月多繳稅
    if (hasCard(p, 'bailout')) {
      useCard(p, 'bailout');
      while (Calc.cashflow(state, p) < 0 && p.bankLoan > 0) p.bankLoan = Math.max(0, p.bankLoan - LOAN_UNIT);
      if (p.cash < 0) p.cash = 0;
      p.tax += Math.round(p.salary * 0.1);
      log(state, 'log_bailout', { name: p.name });
      return;
    }
    p.bankrupt = true;
    log(state, 'log_bankrupt', { name: p.name });
    // 借錢給破產玩家的人收不回剩下的錢（違約）
    p.liabilities.filter((l) => l.lender != null).forEach((l) => {
      const lender = state.players[l.lender];
      lender.assets = lender.assets.filter((a) => a.liab !== l.id);
      log(state, 'log_default', { name: lender.name, debtor: p.name, amount: money(l.principal) });
    });
    const alive = state.players.filter((x) => !x.bankrupt);
    if (state.players.length > 1 && alive.length === 1) {
      state.winner = alive[0].id;
      finish(state, 'last');
    } else if (alive.length === 0) {
      finish(state, 'time');
    }
  }

  function payday(state, p) {
    let salary = Math.round(p.salary);
    if (p.skipPaydays > 0) {
      p.skipPaydays -= 1;
      salary = 0;
      log(state, 'log_layoff_payday', { name: p.name });
    } else if (p.prof === 'sales') {
      salary = Math.round((p.salary * (0.7 + R.int(state, 0, 6) * 0.1)) / 100) * 100;
      log(state, 'log_sales', { amount: money(salary) });
    }
    if (p.poached && salary > 0) {
      salary = Math.round(salary * p.poached);
      log(state, 'log_poached_pay', { name: p.name, amount: money(salary) });
    }
    p.poached = 0;
    const pension = Calc.pensionIncome(p);
    const amount = (salary + Calc.passive(state, p) + pension - Calc.expenses(p)) * PAYDAY_MONTHS;
    const st = stat(p);
    st.premium += Calc.premium(p) * PAYDAY_MONTHS;
    if (p.pension) {
      if (!p.retired) {
        // 雇主提撥 6%（加上自提 6%）存進勞退帳戶
        p.pension.acct += Math.round(salary * (PENSION_EMPLOYER + (p.pension.self ? PENSION_SELF : 0)) * PAYDAY_MONTHS);
      } else if (p.pension.acct > 0) {
        p.pension.acct = Math.max(0, p.pension.acct - p.pension.fromAcct * PAYDAY_MONTHS);
      }
    }
    st.tax += p.tax * PAYDAY_MONTHS;
    st.interest += (Calc.loanPayment(p) + Calc.marginInterest(p)) * PAYDAY_MONTHS;
    if (p.shadow) {
      const origDebt = p.liabilities.filter((l) => l.orig).reduce((sum, l) => sum + l.payment, 0);
      const surplus = (salary - Math.round(p.living) - p.tax - Calc.childCost(p) - origDebt) * PAYDAY_MONTHS;
      if (surplus > 0) p.shadow.units += surplus / M.priceTWD(state, 'TW50');
    }
    if (amount >= 0) {
      p.cash += amount;
      log(state, 'log_payday', { name: p.name, months: PAYDAY_MONTHS, amount: money(amount) });
    } else {
      log(state, 'log_payday_neg', { name: p.name, amount: money(-amount) });
      payCash(state, p, -amount);
    }
    runDca(state, p);
    // 負債依每月還款金額減少；玩家之間的借款，本金還給債權人
    p.liabilities = p.liabilities.filter((l) => {
      l.balance -= l.payment * PAYDAY_MONTHS;
      const done = l.balance <= 0;
      if (l.lender != null) {
        const lender = state.players[l.lender];
        const a = lender.assets.find((x) => x.liab === l.id);
        const principal = done ? l.principal : Math.min(l.principal, Math.max(0, (l.payment - Math.round(l.principal * l.rate)) * PAYDAY_MONTHS));
        l.principal -= principal;
        lender.cash += principal;
        if (a) {
          a.cost = l.principal;
          a.cashflow = Math.round(l.principal * l.rate);
          if (done) lender.assets = lender.assets.filter((x) => x !== a);
        }
      }
      if (done) {
        log(state, 'log_debt_paid', { name: p.name, debt: l.name, amount: money(l.payment) });
        return false;
      }
      return true;
    });
  }

  // 定期定額：每次發薪日買進 6 個月的金額（股票換算成整數股）
  function runDca(state, p) {
    (p.dca || []).forEach((d) => {
      const amount = d.monthly * PAYDAY_MONTHS;
      if (p.cash < amount) { log(state, 'log_dca_skip', { name: p.name, inst: M.byId[d.id].name }); return; }
      const r = M.trade(state, p, d.id, 'buy', amount);
      if (r.error) { log(state, 'log_dca_skip', { name: p.name, inst: M.byId[d.id].name }); return; }
      const st = stat(p);
      st.fees += r.fee;
      st.dca = (st.dca || 0) + r.amount;
      log(state, 'log_dca', { name: p.name, inst: M.byId[d.id].name, amount: money(r.amount) });
    });
  }

  function doodadCost(p, card) {
    const factor = p.skill === 'factory' ? 0.7 : 1;
    return {
      amount: Math.round((card.amount * factor) / 100) * 100,
      payment: card.installment ? Math.round((card.installment.payment * factor) / 100) * 100 : 0,
    };
  }

  // 報稅季：一季（3 個月）的所得分項計稅，教「賺多少」和「實拿多少」的差別
  function taxBreakdown(state, p) {
    const bracket = p.salary >= 100000 ? 0.12 : 0.05; // 簡化的累進稅率
    const items = [];
    const add = (key, base, tax) => { if (base > 0) items.push({ key, base: Math.round(base), tax: Math.max(0, Math.round(tax)) }); };
    // 薪資：每月已經預扣一部分，這裡是結算補繳；自提勞退的部分不用課稅
    const salaryBase = p.salary * 3 * (p.pension && p.pension.self ? 1 - PENSION_SELF : 1);
    add('tx_salary', salaryBase, salaryBase * (bracket === 0.12 ? 0.08 : 0.05));
    let rent = 0, biz = 0, interest = 0;
    p.assets.forEach((a) => {
      if (a.cashflow <= 0) return;
      if (a.kind === 'realestate') rent += a.cashflow * 3;
      else if (a.kind === 'business') biz += a.cashflow * 3;
      else if (a.kind === 'loan') interest += a.cashflow * 3;
    });
    add('tx_rent', rent, rent * 0.57 * bracket); // 租金可扣 43% 必要費用
    add('tx_biz', biz, biz * bracket);
    let div = 0;
    M.incomeLines(state, p).forEach((l) => {
      const t = M.byId[l.id].type;
      if (t === 'deposit' || t === 'fx') interest += l.monthly * 3;
      else div += l.monthly * 3;
    });
    add('tx_div', div, div * Math.max(0, bracket - 0.085)); // 股利可抵減 8.5%
    add('tx_nhi', div, div * 0.0211); // 二代健保補充保費
    add('tx_interest', interest, Math.max(0, interest - SAVINGS_DEDUCTION / 4) * bracket); // 一年 27 萬內免稅
    const total = Math.round(items.reduce((s, x) => s + x.tax, 0) / 100) * 100;
    return { bracket, items, total };
  }

  function checkFreedom(state, p) {
    checkGoal(state, p);
    if (p.free || p.bankrupt || state.phase === 'gameover') return;
    const passive = Calc.realPassive(state, p);
    if (passive > 0 && passive >= Calc.expenses(p)) {
      p.free = true;
      log(state, 'log_free', { name: p.name });
      if (state.config.victory === 'freedom') {
        state.winner = p.id;
        finish(state, 'freedom');
      }
    }
  }

  function finish(state, reason) {
    state.players.forEach((p) => checkGoal(state, p));
    const metric = state.config.victory === 'freedom'
      ? (p) => (Calc.freedom(state, p) + (p.goalDone ? GOAL_FREEDOM_BONUS : 0)) * 1e12 + Calc.netWorth(state, p)
      : (p) => Calc.netWorth(state, p) + (p.goalDone ? GOAL_BONUS : 0);
    const sorted = state.players.slice().sort((a, b) => {
      if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
      return metric(b) - metric(a);
    });
    state.ranking = sorted.map((p) => p.id);
    if (state.winner == null) state.winner = state.ranking[0];
    state.endReason = reason;
    // 季中結束（有人財務自由、只剩一人）時補一筆最後的紀錄；時間到的話季結算已經記過了
    if (state.history && reason !== 'time') state.history.push(snapshot(state));
    state.phase = 'gameover';
    state.pending = null;
  }

  // ── 拍賣 ──
  function startAuction(state, deck, cardId, starter) {
    const card = getCard(deck, cardId);
    const n = state.players.length;
    const order = [];
    for (let k = 0; k < n; k++) {
      const id = (starter + k) % n;
      if (!state.players[id].bankrupt) order.push(id);
    }
    state.pending = {
      type: 'auction', deck, card: cardId, order, active: order.slice(),
      bid: Math.max(10000, Math.round((card.down * AUCTION_START) / 10000) * 10000),
      leader: null, turn: order[0], history: [],
    };
    log(state, 'log_auction_start', { card: card.name, amount: money(state.pending.bid) });
  }

  function minBid(pend) {
    return pend.leader == null ? pend.bid : Math.ceil((pend.bid * 1.05) / 1000) * 1000;
  }

  function auctionStep(state, action) {
    const pend = state.pending;
    const a = state.players[pend.turn];
    if (action.choice === 'bid') {
      const amount = Math.max(minBid(pend), Math.round(action.amount || 0));
      if (a.cash < amount) return 'not_enough_cash';
      pend.bid = amount;
      pend.leader = a.id;
      pend.history.push({ id: a.id, amount });
      log(state, 'log_auction_bid', { name: a.name, amount: money(amount) });
    } else {
      pend.active = pend.active.filter((x) => x !== a.id);
      pend.history.push({ id: a.id, fold: true });
      log(state, 'log_auction_fold', { name: a.name });
    }
    const challengers = pend.active.filter((x) => x !== pend.leader);
    if (!challengers.length) {
      finishAuction(state);
      return null;
    }
    // 下一位：依順序找下一個還在場、而且不是目前最高出價者的人
    const start = pend.order.indexOf(a.id);
    for (let k = 1; k <= pend.order.length; k++) {
      const id = pend.order[(start + k) % pend.order.length];
      if (pend.active.indexOf(id) >= 0 && id !== pend.leader) { pend.turn = id; break; }
    }
    return null;
  }

  function finishAuction(state) {
    const pend = state.pending;
    const card = getCard(pend.deck, pend.card);
    if (pend.leader == null) {
      log(state, 'log_auction_none', { card: card.name });
      state.pending = { type: 'auctionResult', deck: pend.deck, card: pend.card, winner: null };
      return;
    }
    const w = state.players[pend.leader];
    w.cash -= pend.bid;
    w.assets.push(makeAsset(state, card, pend.deck));
    log(state, 'log_auction_win', { name: w.name, card: card.name, amount: money(pend.bid) });
    state.pending = { type: 'auctionResult', deck: pend.deck, card: pend.card, winner: w.id, price: pend.bid };
    checkFreedom(state, w);
  }

  // ── 格子事件 ──
  function landOn(state, p) {
    const type = D.board[p.pos];
    const tile = D.tileTypes[type];
    state.pending = null;
    log(state, 'log_tile', { name: p.name, tile: tile.name });

    switch (type) {
      case 'payday':
        payday(state, p);
        break;
      case 'small':
      case 'big': {
        // 業務員技能、或已經退休（有時間慢慢挑）：看 2 張選 1 張
        const count = (type === 'small' && p.skill === 'sales') || p.retired ? 2 : 1;
        const cards = [];
        for (let i = 0; i < count; i++) cards.push(draw(state, type));
        state.pending = { type: 'deal', deck: type, cards };
        break;
      }
      case 'doodad': {
        const id = draw(state, 'doodad');
        const card = getCard('doodad', id);
        let insured = false;
        if (card.cover && p.policies && p.policies[card.cover]) {
          insured = 'policy';
          const saved = doodadCost(p, card).amount;
          stat(p).claims += saved;
          log(state, 'log_claim', { name: p.name, card: card.name, amount: money(saved) });
        } else if (card.accident && hasCard(p, 'insurance')) {
          useCard(p, 'insurance');
          insured = 'card';
          log(state, 'log_insured', { name: p.name, card: card.name });
        }
        state.pending = { type: 'doodad', card: id, insured };
        break;
      }
      case 'life': {
        const card = getCard('life', draw(state, 'life'));
        let note = null;
        if (card.cover && p.policies && p.policies[card.cover]) {
          note = 'note_policy';
          stat(p).claims += -card.amount;
          log(state, 'log_claim', { name: p.name, card: card.name, amount: money(-card.amount) });
        } else if (p.retired && ['raise', 'side', 'bonus', 'layoff'].indexOf(card.effect) >= 0) {
          note = 'note_retired';
        } else if (card.effect === 'layoff' && p.skill === 'civil') {
          note = 'skill_civil_used';
        } else if (card.negative && p.skill === 'nurse' && !p.shieldUsed) {
          p.shieldUsed = true;
          note = 'skill_nurse_used';
        } else if (card.accident && hasCard(p, 'insurance')) {
          useCard(p, 'insurance');
          note = 'card_insurance_used';
        } else {
          applyLife(state, p, card);
        }
        if (note && note !== 'note_policy' && note !== 'note_retired') log(state, 'log_skill', { name: p.name });
        log(state, 'log_life', { name: p.name, card: card.name });
        state.pending = { type: 'life', card: card.id, note };
        break;
      }
      case 'learning':
        state.pending = { type: 'quiz', q: draw(state, 'quiz') };
        break;
      case 'tax': {
        const bill = taxBreakdown(state, p);
        const amount = bill.total;
        payCash(state, p, amount);
        stat(p).tax += amount;
        log(state, 'log_tax', { name: p.name, amount: money(amount) });
        state.pending = { type: 'tile', tile: type, params: { amount: money(amount) }, tax: bill };
        break;
      }
      case 'market': {
        const card = getCard('market', draw(state, 'market'));
        const impacts = M.applyNews(state, card, 'news');
        log(state, 'log_news', { name: p.name, card: card.name });
        marginCheck(state);
        state.pending = { type: 'news', card: card.id, impacts };
        break;
      }
      case 'geo': {
        const card = getCard('geo', draw(state, 'geo'));
        const impacts = M.applyNews(state, card, 'geo');
        log(state, 'log_geo', { name: p.name, card: card.name });
        marginCheck(state);
        state.pending = { type: 'geo', card: card.id, impacts };
        break;
      }
      case 'cb':
        state.pending = state.macro.cbDoneRound === state.round ? { type: 'cbDone' } : { type: 'cb' };
        break;
      case 'auction': {
        let id = draw(state, 'big');
        for (let k = 0; k < 5 && getCard('big', id).scam; k++) id = draw(state, 'big');
        startAuction(state, 'big', id, p.id);
        break;
      }
      case 'exchange':
        state.pending = { type: 'exchange', card: gainCard(state, p) };
        break;
      default:
        state.pending = { type: 'tile', tile: type };
    }
    if (state.phase === 'gameover') return;
    state.phase = state.pending ? 'resolve' : 'action';
  }

  function applyLife(state, p, card) {
    switch (card.effect) {
      case 'marry':
        payCash(state, p, card.cost);
        p.living += card.living;
        break;
      case 'child':
        if (p.children < 3) p.children += 1;
        break;
      case 'raise':
        p.salary = Math.round((p.salary * (1 + (card.pct || 0.05))) / 100) * 100;
        break;
      case 'living':
        p.living += card.amount;
        break;
      case 'layoff':
        p.skipPaydays = 1;
        break;
      case 'bonus':
        p.cash += Math.round(p.salary * 2);
        break;
      case 'cash':
        if (card.amount >= 0) p.cash += card.amount;
        else payCash(state, p, -card.amount);
        break;
      case 'side':
        p.salary += card.amount;
        break;
    }
  }

  function move(state, p, steps) {
    for (let s = 1; s <= steps; s++) {
      p.pos = (p.pos + 1) % D.board.length;
      if (D.board[p.pos] === 'payday' && s < steps) {
        payday(state, p);
        if (state.phase === 'gameover') return;
        if (p.bankrupt) { state.phase = 'action'; return; }
      }
    }
    landOn(state, p);
  }

  // ── 玩家之間轉移資產 ──
  function moveAsset(from, to, assetId) {
    const a = from.assets.find((x) => x.id === assetId);
    if (!a) return null;
    from.assets = from.assets.filter((x) => x !== a);
    to.assets.push(a);
    return a;
  }

  // 驗證交易提案；ok 時回傳 null
  function checkOffer(state, from, to, deal) {
    if (deal.loan) {
      const l = deal.loan;
      const lender = l.dir === 'lend' ? from : to;
      if (!(l.amount >= 10000) || [12, 24, 36].indexOf(l.months) < 0 || !(l.rate > 0 && l.rate <= 0.03)) return 'bad_amount';
      if (lender.cash < l.amount) return 'not_enough_cash';
      return null;
    }
    const g = deal.give || {};
    const r = deal.get || {};
    if ((g.cash || 0) < 0 || (r.cash || 0) < 0) return 'bad_amount';
    if (!g.cash && !g.asset && !g.card && !r.cash && !r.asset && !r.card) return 'bad_amount';
    if ((g.cash || 0) > from.cash || (r.cash || 0) > to.cash) return 'not_enough_cash';
    if (g.asset && !from.assets.some((a) => a.id === g.asset && a.kind !== 'loan')) return 'bad_target';
    if (r.asset && !to.assets.some((a) => a.id === r.asset && a.kind !== 'loan')) return 'bad_target';
    if (g.card && !hasCard(from, g.card)) return 'bad_target';
    if (r.card && !hasCard(to, r.card)) return 'bad_target';
    if (r.card && !g.card && from.hand.length >= HAND_LIMIT) return 'hand_full';
    if (g.card && !r.card && to.hand.length >= HAND_LIMIT) return 'hand_full';
    return null;
  }

  function executeOffer(state, from, to, deal) {
    if (deal.loan) {
      const l = deal.loan;
      const lender = l.dir === 'lend' ? from : to;
      const borrower = l.dir === 'lend' ? to : from;
      const payment = loanPayment(l.amount, l.months, l.rate);
      const liabId = newId(state);
      lender.cash -= l.amount;
      borrower.cash += l.amount;
      borrower.liabilities.push({
        id: liabId, name: { zh: '向' + lender.name + '借款', en: 'Loan from ' + lender.name },
        balance: payment * l.months, payment, lender: lender.id, principal: l.amount, rate: l.rate,
      });
      lender.assets.push({
        id: newId(state), kind: 'loan', icon: '🤝', name: { zh: '借給' + borrower.name, en: 'Loan to ' + borrower.name },
        cost: l.amount, mortgage: 0, cashflow: Math.round(l.amount * l.rate), liab: liabId, borrower: borrower.id,
      });
      log(state, 'log_p2p_loan', { lender: lender.name, borrower: borrower.name, amount: money(l.amount), payment: money(payment), months: l.months });
      return;
    }
    const g = deal.give || {};
    const r = deal.get || {};
    if (g.cash) { from.cash -= g.cash; to.cash += g.cash; }
    if (r.cash) { to.cash -= r.cash; from.cash += r.cash; }
    if (g.asset) moveAsset(from, to, g.asset);
    if (r.asset) moveAsset(to, from, r.asset);
    if (g.card) { useCard(from, g.card); to.hand.push(g.card); }
    if (r.card) { useCard(to, r.card); from.hand.push(r.card); }
    log(state, 'log_trade_done', { from: from.name, to: to.name });
  }

  // ── 出牌 ──
  function blocked(state, attacker, target, def) {
    if (hasCard(target, 'legal')) {
      useCard(target, 'legal');
      log(state, 'log_blocked', { name: target.name, card: def.name });
      return 'legal';
    }
    return null;
  }

  function playCard(state, p, action) {
    const id = p.hand[action.index];
    const def = id && strategyById[id];
    if (!def) return { error: 'bad_target' };
    if (def.auto) return { error: 'card_auto' };
    const tg = action.target || {};
    const res = { card: id, by: p.id };

    switch (id) {
      case 'short_attack':
      case 'rumor': {
        const inst = M.byId[tg.inst];
        if (!inst || inst.type !== 'stock' || !M.isTradable(state, inst.id)) return { error: 'bad_target' };
        res.inst = inst.id;
        if (id === 'rumor' && R.next(state) < def.risk) {
          res.caught = true;
          res.fine = def.fine;
          payCash(state, p, def.fine);
          log(state, 'log_caught', { name: p.name, card: def.name, amount: money(def.fine) });
          break;
        }
        const pct = id === 'rumor' ? -0.1 : -0.15;
        res.impacts = M.applyNews(state, { effect: { shocks: { [inst.id]: pct } } }, 'attack');
        res.pct = pct;
        if (id === 'short_attack') {
          res.profit = Math.round(SHORT_NOTIONAL * -pct);
          p.cash += res.profit;
        }
        log(state, 'log_attack_stock', { name: p.name, card: def.name, inst: inst.name, pct: Math.round(pct * 100) + '%' });
        break;
      }
      case 'lobbying': {
        if (!D.sectors[tg.sector]) return { error: 'bad_target' };
        res.sector = tg.sector;
        res.impacts = M.applyNews(state, { effect: { shocks: { ['sector:' + tg.sector]: -0.1 }, macro: { cpi: 0.2 } } }, 'attack');
        log(state, 'log_attack_sector', { name: p.name, sector: D.sectors[tg.sector] });
        break;
      }
      case 'poaching':
      case 'takeover': {
        const t = state.players[tg.player];
        if (!t || t === p || t.bankrupt) return { error: 'bad_target' };
        res.target = t.id;
        let asset = null;
        let pay = 0;
        if (id === 'takeover') {
          asset = t.assets.find((a) => a.id === tg.asset && a.kind !== 'loan');
          if (!asset) return { error: 'bad_target' };
          pay = takeoverPrice(asset);
          if (p.cash < pay) return { error: 'not_enough_cash' };
        }
        if (id === 'takeover' && t.skill === 'lawyer') {
          res.blocked = 'lawyer';
          log(state, 'log_blocked', { name: t.name, card: def.name });
          break;
        }
        const b = blocked(state, p, t, def);
        if (b) { res.blocked = b; break; }
        if (id === 'poaching') {
          t.poached = t.skill === 'lawyer' ? 0.75 : 0.5;
          res.factor = t.poached;
          log(state, 'log_poach', { name: p.name, target: t.name });
        } else {
          p.cash -= pay;
          t.cash += pay;
          moveAsset(t, p, asset.id);
          res.asset = asset.name;
          res.pay = pay;
          log(state, 'log_takeover', { name: p.name, target: t.name, card: asset.name, amount: money(pay) });
          checkFreedom(state, p);
        }
        break;
      }
      case 'insider': {
        if (R.next(state) < def.risk) {
          res.caught = true;
          res.fine = def.fine;
          payCash(state, p, def.fine);
          log(state, 'log_caught', { name: p.name, card: def.name, amount: money(def.fine) });
        } else {
          res.world = state.forecast.world;
          log(state, 'log_intel', { name: p.name, card: def.name });
        }
        break;
      }
      case 'research':
        res.phase = state.forecast.phase;
        log(state, 'log_intel', { name: p.name, card: def.name });
        break;
      case 'hedge':
        p.hedgeRound = state.round;
        log(state, 'log_hedge_on', { name: p.name });
        break;
      default:
        return { error: 'card_auto' };
    }
    useCard(p, id);
    if (res.impacts) marginCheck(state);
    return { result: res };
  }

  function resolveChoice(state, p, action) {
    const pend = state.pending;
    switch (pend.type) {
      case 'deal': {
        if (action.choice === 'buy') {
          const card = getCard(pend.deck, pend.cards[action.index || 0]);
          if (p.cash < card.down) return 'not_enough_cash';
          p.cash -= card.down;
          p.assets.push(makeAsset(state, card, pend.deck));
          log(state, 'log_buy', { name: p.name, card: card.name, amount: money(card.cashflow) });
          checkFreedom(state, p);
        } else if (action.choice === 'auction' && pend.deck === 'big') {
          startAuction(state, 'big', pend.cards[0], p.id);
          return null;
        } else {
          pend.cards.forEach((id) => log(state, 'log_pass', { name: p.name, card: getCard(pend.deck, id).name }));
          const scams = pend.cards.filter((id) => getCard(pend.deck, id).scam);
          if (scams.length) {
            scams.forEach((id) => log(state, 'log_scam_dodged', { name: p.name, card: getCard(pend.deck, id).name }));
            state.pending = { type: 'scamReveal', deck: pend.deck, cards: scams };
            return null;
          }
        }
        break;
      }
      case 'doodad': {
        if (pend.insured) break;
        const card = getCard('doodad', pend.card);
        const cost = doodadCost(p, card);
        if (action.choice === 'card') {
          // 刷卡只繳最低應繳：欠款變成循環信用，每季加 15%／4 的利息
          p.liabilities.push({ id: newId(state), card: true, name: { zh: '信用卡循環：' + card.name.zh, en: 'Card balance: ' + card.name.en }, balance: cost.amount, payment: Math.max(1000, Math.round(cost.amount * CARD_MIN)) });
          stat(p).spend += cost.amount;
          log(state, 'log_card', { name: p.name, card: card.name, amount: money(cost.amount) });
        } else if (action.choice === 'installment' && card.installment) {
          p.liabilities.push({ id: newId(state), name: card.name, balance: cost.payment * card.installment.months, payment: cost.payment });
          stat(p).spend += cost.payment * card.installment.months;
          log(state, 'log_installment', { name: p.name, card: card.name, amount: money(cost.payment) });
        } else {
          payCash(state, p, cost.amount);
          stat(p).spend += cost.amount;
          log(state, 'log_doodad', { name: p.name, card: card.name, amount: money(cost.amount) });
        }
        break;
      }
      case 'quiz': {
        const q = getCard('quiz', pend.q);
        const correct = action.index === q.answer;
        const full = QUIZ_REWARD[state.config.difficulty];
        let reward = 0;
        let card = null;
        if (correct) {
          reward = full;
          log(state, 'log_quiz_right', { name: p.name, amount: money(reward) });
          card = gainCard(state, p);
        } else {
          if (p.skill === 'teacher') reward = full / 2;
          log(state, 'log_quiz_wrong', { name: p.name });
        }
        p.cash += reward;
        // 進入解答畫面，按「知道了」才結束
        state.pending = { type: 'quizResult', q: pend.q, picked: action.index, correct, reward, card };
        return null;
      }
      case 'cb': {
        // 玩家先猜，央行再公布決議
        const before = { cpi: state.macro.cpi, gdp: state.macro.gdp, unemp: state.macro.unemp, rate: state.macro.rate };
        const decision = M.cbDecide(state);
        M.applyRate(state, decision);
        state.macro.cbDoneRound = state.round;
        const actual = decision > 0 ? 'hike' : decision < 0 ? 'cut' : 'hold';
        const correct = action.choice === actual;
        if (correct) p.cash += CB_REWARD;
        log(state, 'log_cb', { decision: { key: 'cb_result_' + actual, x: Math.abs(decision).toFixed(2) } });
        state.pending = { type: 'cbResult', guess: action.choice, actual, decision, correct, reward: correct ? CB_REWARD : 0, before };
        return null;
      }
      case 'auction':
        return auctionStep(state, action);
      case 'offer': {
        const from = state.players[pend.from];
        const to = state.players[pend.to];
        let accepted = action.choice === 'accept';
        let error = null;
        if (accepted) {
          error = checkOffer(state, from, to, pend.deal);
          if (error) accepted = false;
          else executeOffer(state, from, to, pend.deal);
        } else {
          log(state, 'log_trade_declined', { from: from.name, to: to.name });
        }
        state.pending = { type: 'offerResult', from: pend.from, to: pend.to, accepted, error, returnPhase: pend.returnPhase };
        if (accepted) { checkFreedom(state, from); checkFreedom(state, to); }
        return null;
      }
      case 'offerResult':
        state.phase = pend.returnPhase;
        state.pending = null;
        return null;
      default:
        break; // life / tile / news / geo / exchange / quizResult / cbResult / cbDone / auctionResult：只需確認
    }
    if (state.phase === 'gameover') return null;
    state.pending = null;
    state.phase = 'action';
    return null;
  }

  // 每季：浮動利率重新計算、房地產與事業的現金流和市價隨景氣變動、事業可能倒閉
  function updateEconomy(state, events) {
    const m = state.macro;
    const phase = m.phase;
    const fail = FAIL_PHASE[phase] * FAIL_DIFF[state.config.difficulty];
    const inflation = Math.max(0, m.cpi) / 400;
    state.players.forEach((p) => {
      if (p.bankrupt) return;
      p.loanRate = (m.rate + BANK_SPREAD) / 1200;
      if (p.homeCost && p.home > 0) p.home = Math.round((p.homeCost * state.market.reIndex) / (p.homeIdx || 1));
      p.liabilities.forEach((l) => {
        if (l.card) {
          const interest = Math.round(l.balance * CARD_APR / 4);
          l.balance += interest;
          l.payment = Math.max(1000, Math.round(l.balance * CARD_MIN));
          stat(p).interest += interest;
          return;
        }
        if (!l.floating) return;
        l.payment = Math.max(Math.round(l.base * 0.5), Math.round(l.base + (l.balance * (m.rate - l.rate0)) / 1200));
      });
      if (p.pension && p.pension.acct > 0) p.pension.acct = Math.round(p.pension.acct * (1 + PENSION_RETURN));
      p.assets = p.assets.filter((a) => {
        if (a.kind === 'loan') return true;
        if (a.kind === 'scam') {
          a.age += 1;
          if (a.age <= a.lasts) return true;
          log(state, 'log_scam_bust', { name: p.name, card: a.name, amount: money(a.cost) });
          stat(p).realized.push({ name: a.name, gain: -a.cost, round: state.round, scam: true });
          events.push({ id: p.id, key: 'ev_scam', params: { card: a.name, amount: money(a.cost) } });
          return false;
        }
        const rateCost = Math.round((a.mortgage * (m.rate - a.rate0)) / 1200); // 浮動房貸的利息變化
        if (a.kind === 'business') {
          if (R.next(state) < fail * a.risk) {
            log(state, 'log_biz_fail', { name: p.name, card: a.name });
            stat(p).realized.push({ name: a.name, gain: -(a.cost - a.mortgage), round: state.round, failed: true });
            events.push({ id: p.id, key: 'ev_fail', params: { card: a.name, amount: money(a.cost - a.mortgage) } });
            if (a.mortgage > 0) {
              p.liabilities.push({
                id: newId(state), name: { zh: a.name.zh + '剩餘貸款', en: 'Leftover loan: ' + a.name.en },
                balance: a.mortgage, payment: Math.round(a.mortgage / 180),
              });
            }
            return false;
          }
          const f = (1 + (BIZ_PHASE[phase] - 1) * RISK_DAMP[state.config.difficulty]) * (0.9 + R.next(state) * 0.2);
          a.cashflow = Math.round(a.base * f) - rateCost;
          a.value = Math.round(a.cost * f);
        } else {
          a.base *= 1 + inflation; // 租金跟著通膨調漲
          a.cashflow = Math.round(a.base * (1 + (RENT_PHASE[phase] - 1) * RISK_DAMP[state.config.difficulty])) - rateCost;
          a.value = Math.round((a.cost * state.market.reIndex) / a.reIdx);
          if (a.value < a.mortgage && !a.underwater) events.push({ id: p.id, key: 'ev_underwater', params: { card: a.name } });
          a.underwater = a.value < a.mortgage;
        }
        return true;
      });
    });
  }

  // 限價單：季結算後的價格碰到掛單價就成交；過期就取消
  function fillOrders(state, events) {
    state.players.forEach((p) => {
      if (!p.orders || !p.orders.length || p.bankrupt) return;
      p.orders = p.orders.filter((o) => {
        const price = state.market.prices[o.id];
        const name = M.byId[o.id].name;
        const hit = o.side === 'buy' ? price <= o.limit : price >= o.limit;
        if (hit) {
          const units = o.side === 'buy' ? o.units : Math.min(o.units, p.holdings[o.id] || 0);
          const r = units > 0 ? (o.side === 'buy' ? M.trade(state, p, o.id, 'buy', units, true) : M.trade(state, p, o.id, 'sell', units)) : { error: 'bad_amount' };
          if (r.error) {
            log(state, 'log_order_fail', { name: p.name, inst: name });
            events.push({ id: p.id, key: 'ev_order_fail', params: { inst: name } });
          } else {
            stat(p).fees += r.fee;
            if (o.side === 'sell') stat(p).realized.push({ name, gain: Math.round(r.gain), round: state.round });
            log(state, 'log_order_fill', { name: p.name, inst: name, side: { key: 'side_' + o.side }, units: Math.round(r.units), amount: money(o.side === 'buy' ? r.amount : r.proceeds) });
            events.push({ id: p.id, key: 'ev_order_fill', params: { inst: name, side: { key: 'side_' + o.side }, units: Math.round(r.units) } });
          }
          return false;
        }
        if (state.round >= o.until) {
          log(state, 'log_order_expired', { name: p.name, inst: name });
          return false;
        }
        return true;
      });
    });
  }

  // 融資維持率檢查：市值低於融資借款的 130% 就強制賣出（斷頭）
  // 季中發生的斷頭先記在 roundEvents，季報再一起列出
  function marginCheck(state, events) {
    if (!events) {
      if (!state.roundEvents) state.roundEvents = [];
      events = state.roundEvents;
    }
    state.players.forEach((p) => {
      if (p.bankrupt) return;
      Object.keys(p.margin).forEach((id) => {
        if (!p.holdings[id] || M.isFrozen(state, id)) return;
        const loan = p.margin[id];
        if (p.holdings[id] * M.priceTWD(state, id) >= loan * MAINTENANCE) return;
        const r = M.trade(state, p, id, 'sell', p.holdings[id]);
        if (r.error) return;
        delete p.margin[id];
        p.cash -= loan;
        stat(p).fees += r.fee;
        stat(p).realized.push({ name: M.byId[id].name, gain: Math.round(r.gain), round: state.round, marginCall: true });
        log(state, 'log_margin_call', { name: p.name, inst: M.byId[id].name, amount: money(-r.gain) });
        events.push({ id: p.id, key: 'ev_margin', params: { inst: M.byId[id].name, amount: money(-r.gain) } });
        if (p.cash < 0) {
          const debt = -p.cash;
          p.cash = 0;
          payCash(state, p, debt);
        }
      });
    });
  }

  // 一輪結束：市場結算
  function settleRound(state) {
    const fc = state.forecast;
    const card = fc.world ? getCard('world', fc.world) : null;
    if (card) log(state, 'log_world', { card: card.name });
    const before = state.players.map((p) => M.holdingValue(state, p));
    const cfBefore = state.players.map((p) => Calc.cashflow(state, p));
    const nwBefore = state.players.map((p) => Calc.netWorth(state, p));
    M.settle(state, card, fc.phase);
    // 避險部位：本季投資虧損減半
    state.players.forEach((p, k) => {
      if (p.hedgeRound !== state.round) return;
      const loss = before[k] - M.holdingValue(state, p);
      if (loss > 0) {
        const refund = Math.round(loss / 2);
        p.cash += refund;
        log(state, 'log_hedge_pay', { name: p.name, amount: money(refund) });
      }
    });
    const events = state.roundEvents || [];
    state.roundEvents = [];
    updateEconomy(state, events);
    fillOrders(state, events);
    marginCheck(state, events);
    // 破產淘汰制：資不抵債（淨資產比起點再少 6 個月以上的薪資）也算破產
    if (state.config.victory === 'bankrupt') {
      state.players.forEach((p) => {
        if (p.bankrupt || state.phase === 'gameover') return;
        if (Calc.netWorth(state, p) < Math.min(0, p.nw0 || 0) - INSOLVENT_MONTHS * (p.retired ? p.salaryBefore || 0 : p.salary)) {
          events.push({ id: p.id, key: 'ev_insolvent', params: {} });
          goBankrupt(state, p);
        }
      });
      if (state.phase === 'gameover') return;
    }
    state.report.players = state.players.map((p, k) => ({
      id: p.id,
      cf: Calc.cashflow(state, p) - cfBefore[k],
      // 整季的淨資產變化（從上一季結算後算起，包含季中的發薪、投資與支出）
      nw: Calc.netWorth(state, p) - (state.history && state.history.length ? state.history[state.history.length - 1].nw[k] : nwBefore[k]),
      events: events.filter((e) => e.id === p.id),
    }));
    if (!state.history) state.history = [];
    state.history.push(snapshot(state));
    log(state, 'log_settle', roundInfo(state.round));
    makeForecast(state);
    state.players.forEach((p) => { checkGoal(state, p); checkFreedom(state, p); });
  }

  // 退休：薪水停止，改領勞保年金（提早退休打折）+ 勞退帳戶（分 20 年領）
  function retire(state, p) {
    const q = pensionQuote(state, p);
    p.retired = true;
    p.retiredRound = state.round;
    p.salaryBefore = Math.round(p.salary);
    p.pension.labor = q.labor;
    p.pension.fromAcct = q.fromAcct;
    p.salary = 0;
    p.skipPaydays = 0;
    p.living *= RETIRE_LIVING;
    p.tax = 0; // 勞保年金與勞退免稅
    const early = Math.round((1 - q.factor) * 100);
    log(state, early > 0 ? 'log_retire_early' : 'log_retire', { name: p.name, amount: money(Calc.pensionIncome(p)), before: money(p.salaryBefore), cut: early });
  }

  // 到了法定退休年齡：還在工作的人強制退休
  function retireAll(state) {
    if (!state.players.some((p) => !p.bankrupt && !p.retired)) return;
    log(state, 'log_retire_all');
    state.players.forEach((p) => { if (!p.bankrupt && !p.retired) retire(state, p); });
  }

  function endTurn(state) {
    const p = state.players[state.current];
    checkFreedom(state, p);
    if (state.phase === 'gameover') return;

    const n = state.players.length;
    let idx = state.current;
    let wrapped = false;
    for (let i = 0; i < n; i++) {
      idx = (idx + 1) % n;
      if (idx === 0) wrapped = true;
      if (!state.players[idx].bankrupt) break;
    }
    if (wrapped) {
      settleRound(state);
      if (state.phase === 'gameover') return;
      state.round += 1;
      if (state.round > state.config.rounds) {
        state.round = state.config.rounds;
        finish(state, 'time');
        return;
      }
      logRound(state);
      if (state.config.retire && state.round === state.config.retireRound) retireAll(state);
    }
    state.current = idx;
    state.phase = 'roll';
    state.pending = null;
    state.lastRoll = null;
    state.turnLogStart = state.log.length;
  }

  const FREE_PHASES = ['roll', 'action'];

  // 電腦玩家的決策理由寫進紀錄（排在動作結果之前），動作失敗就拿掉
  function dispatch(state, action) {
    if (!action.reason || state.phase === 'gameover') return run(state, action);
    const pd = state.pending;
    const actor = state.phase === 'resolve' && pd && pd.type === 'auction' ? state.players[pd.turn]
      : state.phase === 'resolve' && pd && pd.type === 'offer' ? state.players[pd.to] : state.players[state.current];
    const at = state.log.length;
    log(state, 'log_ai', { name: actor.name, text: action.reason });
    const r = run(state, action);
    if (!r.ok) state.log.splice(at, 1);
    return r;
  }

  function run(state, action) {
    if (state.phase === 'gameover') return { ok: false, error: 'game_over' };
    const p = state.players[state.current];
    let error = null;
    let result = null;

    switch (action.type) {
      case 'ROLL': {
        if (state.phase !== 'roll') return { ok: false, error: 'bad_phase' };
        const n = R.int(state, 1, 6);
        state.lastRoll = n;
        log(state, 'log_roll', { name: p.name, n });
        move(state, p, n);
        break;
      }
      case 'CHOOSE':
        if (state.phase !== 'resolve' || !state.pending) return { ok: false, error: 'bad_phase' };
        error = resolveChoice(state, p, action);
        break;
      case 'TRADE': {
        // 處理投資機會卡時可以先賣出投資湊頭期款，但不能買進
        const sellForDeal = state.phase === 'resolve' && state.pending && state.pending.type === 'deal' && action.side === 'sell';
        if (FREE_PHASES.indexOf(state.phase) < 0 && !sellForDeal) return { ok: false, error: 'cant_trade' };
        if (action.side === 'sell' && M.isFrozen(state, action.id)) return { ok: false, error: 'frozen' };
        const id = action.id;
        const def = M.byId[id];
        if (action.side === 'margin') {
          // 融資買進：自備 action.amount，向券商借 1.5 倍
          if (sellForDeal) return { ok: false, error: 'cant_trade' };
          if (M.LEVELS[state.config.difficulty] < 1 || !def || (def.type !== 'stock' && def.type !== 'etf')) return { ok: false, error: 'no_margin' };
          const own = Math.floor(action.amount);
          if (!(own > 0)) return { ok: false, error: 'bad_amount' };
          if (p.cash < own) return { ok: false, error: 'not_enough_cash' };
          const loan = Math.round(own * (MARGIN_LEVERAGE - 1));
          p.cash += loan;
          const r = M.trade(state, p, id, 'buy', own + loan);
          if (r.error) { p.cash -= loan; return { ok: false, error: r.error }; }
          stat(p).fees += r.fee;
          p.margin[id] = (p.margin[id] || 0) + loan;
          log(state, 'log_margin_buy', { name: p.name, inst: def.name, amount: money(own), loan: money(loan) });
          break;
        }
        const repay = action.side === 'sell' && p.margin[id] && p.holdings[id]
          ? p.margin[id] * Math.min(1, action.amount / p.holdings[id]) : 0;
        const r = action.side === 'buy' && action.units
          ? M.trade(state, p, id, 'buy', action.units, true)
          : M.trade(state, p, id, action.side, action.amount);
        if (r.error) return { ok: false, error: r.error };
        stat(p).fees += r.fee;
        if (action.side === 'sell') stat(p).realized.push({ name: def.name, gain: Math.round(r.gain), round: state.round });
        if (repay) {
          p.margin[id] -= repay;
          p.cash -= repay;
          if (!p.holdings[id] || p.margin[id] < 1) delete p.margin[id];
          if (p.cash < 0) { const debt = -p.cash; p.cash = 0; payCash(state, p, debt); }
        }
        if (action.side === 'buy') log(state, 'log_buy_mk', { name: p.name, inst: def.name, amount: money(r.amount) });
        else log(state, 'log_sell_mk', { name: p.name, inst: def.name, amount: money(r.proceeds - repay), gain: money(r.gain) });
        checkFreedom(state, p);
        break;
      }
      case 'DCA_SET': {
        // 設定定期定額：monthly = 每月金額（0 = 取消）
        if (FREE_PHASES.indexOf(state.phase) < 0) return { ok: false, error: 'cant_trade' };
        const i = M.byId[action.id];
        if (!i || !M.isTradable(state, i.id) || !(M.byShares(i) || i.type === 'fund')) return { ok: false, error: 'bad_target' };
        const monthly = Math.round(Number(action.monthly) || 0);
        if (!p.dca) p.dca = [];
        const cur = p.dca.find((d) => d.id === i.id);
        if (monthly <= 0) {
          if (!cur) return { ok: false, error: 'bad_target' };
          p.dca = p.dca.filter((d) => d !== cur);
          log(state, 'log_dca_off', { name: p.name, inst: i.name });
          break;
        }
        if (monthly < 1000) return { ok: false, error: 'bad_amount' };
        if (cur) cur.monthly = monthly;
        else if (p.dca.length >= DCA_MAX) return { ok: false, error: 'dca_full' };
        else p.dca.push({ id: i.id, monthly });
        log(state, 'log_dca_on', { name: p.name, inst: i.name, amount: money(monthly) });
        break;
      }
      case 'ORDER_PLACE': {
        if (FREE_PHASES.indexOf(state.phase) < 0) return { ok: false, error: 'cant_trade' };
        const i = M.byId[action.id];
        if (!i || !M.isTradable(state, i.id) || !M.byShares(i)) return { ok: false, error: 'bad_target' };
        const units = Math.floor(Number(action.units) || 0);
        const limit = Number(action.limit);
        if (!(units > 0) || !(limit > 0) || (action.side !== 'buy' && action.side !== 'sell')) return { ok: false, error: 'bad_amount' };
        if (action.side === 'sell' && (p.holdings[i.id] || 0) < units) return { ok: false, error: 'not_enough_shares' };
        if (!p.orders) p.orders = [];
        if (p.orders.length >= ORDER_MAX) return { ok: false, error: 'orders_full' };
        p.orders.push({ oid: newId(state), id: i.id, side: action.side, units, limit: Math.round(limit * 100) / 100, until: state.round + ORDER_ROUNDS - 1 });
        log(state, 'log_order_place', { name: p.name, inst: i.name, side: { key: 'side_' + action.side }, units, limit: limit.toFixed(2) });
        break;
      }
      case 'ORDER_CANCEL': {
        if (FREE_PHASES.indexOf(state.phase) < 0) return { ok: false, error: 'cant_trade' };
        const before = (p.orders || []).length;
        p.orders = (p.orders || []).filter((o) => o.oid !== action.oid);
        if (p.orders.length === before) return { ok: false, error: 'bad_target' };
        log(state, 'log_order_cancel', { name: p.name });
        break;
      }
      case 'BUY_HOME': {
        if (FREE_PHASES.indexOf(state.phase) < 0) return { ok: false, error: 'cant_trade' };
        if (p.home > 0 || !HOMES[action.kind]) return { ok: false, error: 'bad_target' };
        const q = homeQuote(state, p, action.kind);
        if (p.cash < q.down + q.closing) return { ok: false, error: 'not_enough_cash' };
        // 銀行審核：買房後每月現金流不能是負的
        const lid = newId(state);
        p.liabilities.push({ id: lid, home: true, floating: true, name: { zh: '自住房貸（浮動利率）', en: 'Home mortgage (floating)' }, balance: q.loan, payment: q.payment, base: q.payment, rate0: state.macro.rate });
        p.living -= q.rent;
        if (Calc.cashflow(state, p) < 0) {
          p.liabilities = p.liabilities.filter((l) => l.id !== lid);
          p.living += q.rent;
          return { ok: false, error: 'mortgage_denied' };
        }
        p.cash -= q.down + q.closing;
        p.home = q.price;
        p.homeCost = q.price;
        p.homeIdx = state.market.reIndex;
        p.homeBought = state.round;
        p.homeRent = q.rent;
        stat(p).fees += q.closing;
        log(state, 'log_home_buy', { name: p.name, home: { key: 'hmn_' + action.kind }, amount: money(q.price), payment: money(q.payment) });
        checkFreedom(state, p);
        break;
      }
      case 'SELL_HOME': {
        if (FREE_PHASES.indexOf(state.phase) < 0) return { ok: false, error: 'cant_trade' };
        if (!(p.home > 0)) return { ok: false, error: 'bad_target' };
        const q = homeSaleQuote(state, p);
        if (q.net < 0 && p.cash < -q.net) return { ok: false, error: 'not_enough_cash' };
        p.cash += q.net;
        const ids = homeMortgage(p).map((l) => l.id);
        p.liabilities = p.liabilities.filter((l) => ids.indexOf(l.id) < 0);
        p.living += q.rent; // 回去租屋
        p.home = 0;
        p.homeCost = 0;
        p.homeRent = 0;
        const st = stat(p);
        st.fees += q.fee;
        st.tax += q.tax;
        st.realized.push({ name: { zh: '自住房', en: 'Home' }, gain: q.gain, round: state.round });
        log(state, 'log_home_sell', { name: p.name, amount: money(q.value), net: money(q.net), rent: money(q.rent) });
        checkFreedom(state, p);
        break;
      }
      case 'RETIRE': {
        if (FREE_PHASES.indexOf(state.phase) < 0) return { ok: false, error: 'cant_trade' };
        if (!state.config.retire || p.retired) return { ok: false, error: 'bad_target' };
        if (state.round < earliestRetire(state)) return { ok: false, error: 'too_early' };
        retire(state, p);
        checkFreedom(state, p);
        break;
      }
      case 'INSURE': {
        // 保單：任何時候都能加保或退保，保費每月算進支出
        if (FREE_PHASES.indexOf(state.phase) < 0) return { ok: false, error: 'cant_trade' };
        if (!PREMIUM[action.kind]) return { ok: false, error: 'bad_target' };
        const on = !!action.on;
        if (p.policies[action.kind] === on) return { ok: false, error: 'bad_target' };
        p.policies[action.kind] = on;
        log(state, on ? 'log_insure_on' : 'log_insure_off', { name: p.name, policy: { key: 'pol_' + action.kind }, amount: money(PREMIUM[action.kind]) });
        break;
      }
      case 'PENSION_SELF': {
        if (FREE_PHASES.indexOf(state.phase) < 0) return { ok: false, error: 'cant_trade' };
        if (p.retired || p.pension.self === !!action.on) return { ok: false, error: 'bad_target' };
        p.pension.self = !!action.on;
        log(state, p.pension.self ? 'log_pension_on' : 'log_pension_off', { name: p.name, amount: money(Math.round(p.salary * PENSION_SELF)) });
        break;
      }
      case 'UPGRADE': {
        if (FREE_PHASES.indexOf(state.phase) < 0) return { ok: false, error: 'cant_trade' };
        const a = p.assets.find((x) => x.id === action.id);
        const info = a && upgradeInfo(state, a);
        if (!info) return { ok: false, error: 'bad_target' };
        const turnKey = state.round + '-' + state.current;
        if (a.upTry === turnKey) return { ok: false, error: 'already_tried' };
        if (p.cash < info.cost) return { ok: false, error: 'not_enough_cash' };
        a.upTry = turnKey;
        p.cash -= info.cost;
        if (R.next(state) < info.chance) {
          a.stage += 1;
          a.name = info.name;
          a.icon = info.icon;
          a.base = info.cashflow;
          a.cashflow = info.cashflow - Math.round((a.mortgage * (state.macro.rate - a.rate0)) / 1200);
          a.cost += info.cost;
          a.value = a.cost;
          a.risk *= 1.15;
          log(state, 'log_upgrade_ok', { name: p.name, card: a.name, amount: money(info.cashflow) });
        } else {
          // 擴張失敗：一半的錢收不回來，還有 1/4 的機會整個事業倒閉
          p.cash += Math.round(info.cost / 2);
          stat(p).realized.push({ name: info.name, gain: -Math.round(info.cost / 2), round: state.round, failed: true });
          if (R.next(state) < 0.25) {
            log(state, 'log_upgrade_bust', { name: p.name, card: a.name, amount: money(Math.round(info.cost / 2)) });
            closeBusiness(state, p, a);
          } else {
            log(state, 'log_upgrade_fail', { name: p.name, card: a.name, amount: money(Math.round(info.cost / 2)) });
          }
        }
        checkFreedom(state, p);
        break;
      }
      case 'IPO': {
        if (FREE_PHASES.indexOf(state.phase) < 0) return { ok: false, error: 'cant_trade' };
        const a = p.assets.find((x) => x.id === action.id);
        if (!a || !a.chain || a.stage < 3) return { ok: false, error: 'bad_target' };
        const q = ipoQuote(state, a);
        if (q.net <= 0) return { ok: false, error: 'bad_amount' };
        p.cash += q.net;
        p.assets = p.assets.filter((x) => x !== a);
        stat(p).fees += q.fee;
        stat(p).realized.push({ name: a.name, gain: q.gain, round: state.round });
        p.ipoDone = true;
        log(state, 'log_ipo', { name: p.name, card: a.name, amount: money(q.net), pe: q.pe });
        checkFreedom(state, p);
        break;
      }
      case 'SELL_ASSET': {
        // 處理投資機會卡時也可以賣資產湊頭期款
        const forDeal = state.phase === 'resolve' && state.pending && state.pending.type === 'deal';
        if (FREE_PHASES.indexOf(state.phase) < 0 && !forDeal) return { ok: false, error: 'cant_trade' };
        const a = p.assets.find((x) => x.id === action.id);
        if (!a || !SALE_FEE[a.kind]) return { ok: false, error: 'bad_target' };
        const price = Math.round(action.price);
        if (!(price >= 10000) || price > assetValue(a) * 3) return { ok: false, error: 'bad_amount' };
        // 每項資產每回合只能掛牌一次，沒賣掉就等下回合再試
        const turnKey = state.round + '-' + state.current;
        if (a.listed === turnKey) return { ok: false, error: 'already_listed' };
        const q = saleQuote(a, price, state.round);
        if (q.net < 0 && p.cash < -q.net) return { ok: false, error: 'not_enough_cash' };
        a.listed = turnKey;
        const chance = saleChance(state, a, price);
        const sold = chance >= 1 || R.next(state) < chance;
        if (!sold) {
          log(state, 'log_asset_unsold', { name: p.name, card: a.name, price: money(price) });
          break;
        }
        p.cash += q.net;
        p.assets = p.assets.filter((x) => x !== a);
        stat(p).fees += q.fee;
        if (q.tax) {
          stat(p).tax += q.tax;
          log(state, 'log_land_tax', { name: p.name, amount: money(q.tax), rate: Math.round(q.taxRate * 100) });
        }
        stat(p).realized.push({ name: a.name, gain: q.gain, round: state.round });
        log(state, 'log_asset_sold', { name: p.name, card: a.name, price: money(price), net: money(q.net), gain: money(q.gain) });
        checkFreedom(state, p);
        break;
      }
      case 'PLAY_CARD': {
        if (FREE_PHASES.indexOf(state.phase) < 0) return { ok: false, error: 'cant_trade' };
        const r = playCard(state, p, action);
        if (r.error) return { ok: false, error: r.error };
        result = r.result;
        state.lastPlay = result;
        break;
      }
      case 'OFFER': {
        if (FREE_PHASES.indexOf(state.phase) < 0) return { ok: false, error: 'cant_trade' };
        const to = state.players[action.to];
        if (!to || to === p || to.bankrupt) return { ok: false, error: 'bad_target' };
        const e = checkOffer(state, p, to, action.deal);
        if (e) return { ok: false, error: e };
        state.pending = { type: 'offer', from: p.id, to: to.id, deal: action.deal, returnPhase: state.phase };
        state.phase = 'resolve';
        log(state, 'log_trade_offer', { from: p.name, to: to.name });
        break;
      }
      case 'LOAN': {
        // units：一次借幾個 10 萬（預設 1）；銀行逐筆審核，借到現金流會變負為止
        const units = Math.max(1, Math.min(50, Math.round(action.units || 1)));
        let amount = 0;
        for (let k = 0; k < units; k++) {
          p.bankLoan += LOAN_UNIT;
          if (Calc.cashflow(state, p) < 0) { p.bankLoan -= LOAN_UNIT; break; }
          amount += LOAN_UNIT;
        }
        if (!amount) return { ok: false, error: 'loan_denied' };
        p.cash += amount;
        log(state, 'log_loan', { name: p.name, amount: money(amount) });
        break;
      }
      case 'REPAY': {
        const units = Math.max(1, Math.min(50, Math.round(action.units || 1)));
        const amount = Math.min(LOAN_UNIT * units, p.bankLoan, Math.floor(p.cash / LOAN_UNIT) * LOAN_UNIT || p.bankLoan);
        if (amount <= 0) return { ok: false, error: 'no_loan' };
        if (p.cash < amount) return { ok: false, error: 'not_enough_cash' };
        p.cash -= amount;
        p.bankLoan -= amount;
        log(state, 'log_repay', { name: p.name, amount: money(amount) });
        break;
      }
      case 'PAYOFF': {
        if (state.phase === 'resolve') return { ok: false, error: 'bad_phase' };
        const l = p.liabilities.find((x) => x.id === action.id);
        if (!l) return { ok: false, error: 'bad_phase' };
        const amount = l.lender != null ? l.principal : l.balance;
        if (p.cash < amount) return { ok: false, error: 'not_enough_cash' };
        p.cash -= amount;
        p.liabilities = p.liabilities.filter((x) => x !== l);
        if (l.lender != null) {
          const lender = state.players[l.lender];
          lender.cash += amount;
          lender.assets = lender.assets.filter((a) => a.liab !== l.id);
        }
        log(state, 'log_payoff', { name: p.name, debt: l.name, amount: money(amount) });
        break;
      }
      case 'END_TURN':
        if (state.phase !== 'action') return { ok: false, error: 'bad_phase' };
        endTurn(state);
        break;
      case 'SET_AI': {
        // 連線用：玩家斷線時由電腦暫代，回來後再交還
        const who = state.players[action.seat];
        if (!who) return { ok: false, error: 'bad_target' };
        who.ai = action.ai || null;
        log(state, action.ai ? 'log_standin' : 'log_rejoin', { name: who.name });
        break;
      }
      default:
        return { ok: false, error: 'bad_phase' };
    }
    return error ? { ok: false, error } : { ok: true, result };
  }

  // 舊版存檔（v4）升級成 v5：補上新欄位；退休階段預設關閉，避免進行中的遊戲突然改規則
  function migrate(s) {
    if (!s || s.version !== 4) return s;
    M.migrate(s);
    s.config.retire = false;
    s.config.retireRound = s.config.rounds + 1;
    s.players.forEach((p) => {
      if (!p.policies) p.policies = { medical: false, property: false, life: false };
      if (!p.pension) p.pension = { acct: 0, self: false, labor: 0, fromAcct: 0 };
      if (p.retired == null) p.retired = false;
      if (p.homeCost == null) { p.homeCost = 0; p.homeIdx = 1; p.homeBought = 0; }
      if (!p.dca) p.dca = [];
      if (!p.orders) p.orders = [];
      stat(p);
      p.assets.forEach((a) => { if (a.bought == null) a.bought = 0; });
    });
    s.version = 5;
    return s;
  }

  MT.Engine = {
    createGame, dispatch, getCard, roundInfo, doodadCost, peek, minBid, loanPayment, checkOffer, assetValue, takeoverPrice,
    saleChance, saleQuote, SALE_FEE, upgradeInfo, ipoQuote, taxBreakdown, landTaxRate, migrate,
    earliestRetire, earliestOf, pensionQuote, retireRoundOf,
    homeQuote, homeSaleQuote, goalProgress, HOMES, DCA_MAX, ORDER_MAX, ORDER_ROUNDS, CARD_APR, GOAL_BONUS, GOAL_FREEDOM_BONUS,
    PREMIUM, PENSION_SELF, IPO_PE,
    MARGIN_LEVERAGE, MARGIN_RATE, MAINTENANCE, BANK_SPREAD, SAVE_VERSION,
    Calc, LOAN_UNIT, CHILD_COST, QUIZ_REWARD, CB_REWARD, PAYDAY_MONTHS, HAND_LIMIT, SHORT_NOTIONAL, lengthRounds,
  };
})();

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
  const SAVE_VERSION = 4; // 存檔格式版本：改動遊戲狀態結構時要加 1（畫面讀檔也用這個數字）

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
    childCost(p) { return p.children * CHILD_COST; },
    expenses(p) { return Math.round(p.living) + p.tax + Calc.childCost(p) + Calc.debtPayments(p) + Calc.loanPayment(p) + Calc.marginInterest(p); },
    income(s, p) { return Math.round(p.salary) + Calc.passive(s, p); },
    cashflow(s, p) { return Calc.income(s, p) - Calc.expenses(p); },
    freedom(s, p) {
      const e = Calc.expenses(p);
      return e <= 0 ? 1 : Calc.passive(s, p) / e;
    },
    netWorth(s, p) {
      const assets = p.cash + p.home + p.assets.reduce((sum, a) => sum + assetValue(a), 0) + M.holdingValue(s, p);
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

  function makeAsset(state, card, deck) {
    return {
      id: newId(state), card: card.id, deck, name: card.name, icon: card.icon, kind: card.kind,
      cost: card.cost, value: card.cost, mortgage: card.cost - card.down, cashflow: card.cashflow,
      base: card.cashflow, rate0: state.macro.rate, reIdx: state.market.reIndex, risk: card.risk || 1,
    };
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
    D.strategy.forEach((c) => {
      if (M.LEVELS[c.level] > lv) return;
      if (c.mode && c.mode !== state.config.victory) return;
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
    };
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
      state.players.push(makePlayer(state, pc, i, prof, cfg.roleMode === 'skill'));
    });

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
      if (state.config.victory === 'bankrupt' && Calc.cashflow(state, p) < 0) {
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
    const amount = (salary + Calc.passive(state, p) - Calc.expenses(p)) * PAYDAY_MONTHS;
    const st = stat(p);
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

  function doodadCost(p, card) {
    const factor = p.skill === 'factory' ? 0.7 : 1;
    return {
      amount: Math.round((card.amount * factor) / 100) * 100,
      payment: card.installment ? Math.round((card.installment.payment * factor) / 100) * 100 : 0,
    };
  }

  function taxAmount(state, p) {
    return Math.round((p.salary * 3 * 0.05 + Math.max(0, Calc.passive(state, p)) * 3 * 0.1) / 100) * 100;
  }

  function checkFreedom(state, p) {
    if (p.free || p.bankrupt || state.phase === 'gameover') return;
    const passive = Calc.passive(state, p);
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
    const metric = state.config.victory === 'freedom'
      ? (p) => Calc.freedom(state, p) * 1e12 + Calc.netWorth(state, p)
      : (p) => Calc.netWorth(state, p);
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
        const count = type === 'small' && p.skill === 'sales' ? 2 : 1;
        const cards = [];
        for (let i = 0; i < count; i++) cards.push(draw(state, type));
        state.pending = { type: 'deal', deck: type, cards };
        break;
      }
      case 'doodad': {
        const id = draw(state, 'doodad');
        const card = getCard('doodad', id);
        let insured = false;
        if (card.accident && hasCard(p, 'insurance')) {
          useCard(p, 'insurance');
          insured = true;
          log(state, 'log_insured', { name: p.name, card: card.name });
        }
        state.pending = { type: 'doodad', card: id, insured };
        break;
      }
      case 'life': {
        const card = getCard('life', draw(state, 'life'));
        let note = null;
        if (card.effect === 'layoff' && p.skill === 'civil') {
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
        if (note) log(state, 'log_skill', { name: p.name });
        log(state, 'log_life', { name: p.name, card: card.name });
        state.pending = { type: 'life', card: card.id, note };
        break;
      }
      case 'learning':
        state.pending = { type: 'quiz', q: draw(state, 'quiz') };
        break;
      case 'tax': {
        const amount = taxAmount(state, p);
        payCash(state, p, amount);
        stat(p).tax += amount;
        log(state, 'log_tax', { name: p.name, amount: money(amount) });
        state.pending = { type: 'tile', tile: type, params: { amount: money(amount) } };
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
      case 'auction':
        startAuction(state, 'big', draw(state, 'big'), p.id);
        break;
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

  function loanPayment(amount, months, rate) {
    return Math.round((amount * rate) / (1 - Math.pow(1 + rate, -months)));
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
        }
        break;
      }
      case 'doodad': {
        if (pend.insured) break;
        const card = getCard('doodad', pend.card);
        const cost = doodadCost(p, card);
        if (action.choice === 'installment' && card.installment) {
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
      p.liabilities.forEach((l) => {
        if (!l.floating) return;
        l.payment = Math.max(Math.round(l.base * 0.5), Math.round(l.base + (l.balance * (m.rate - l.rate0)) / 1200));
      });
      p.assets = p.assets.filter((a) => {
        if (a.kind === 'loan') return true;
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
    marginCheck(state, events);
    // 破產淘汰制：資不抵債（淨資產比起點再少 6 個月以上的薪資）也算破產
    if (state.config.victory === 'bankrupt') {
      state.players.forEach((p) => {
        if (p.bankrupt || state.phase === 'gameover') return;
        if (Calc.netWorth(state, p) < Math.min(0, p.nw0 || 0) - INSOLVENT_MONTHS * p.salary) {
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
    state.players.forEach((p) => checkFreedom(state, p));
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
        const r = M.trade(state, p, id, action.side, action.amount);
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

  MT.Engine = {
    createGame, dispatch, getCard, roundInfo, doodadCost, peek, minBid, loanPayment, checkOffer, assetValue, takeoverPrice,
    MARGIN_LEVERAGE, MARGIN_RATE, MAINTENANCE, BANK_SPREAD, SAVE_VERSION,
    Calc, LOAN_UNIT, CHILD_COST, QUIZ_REWARD, CB_REWARD, PAYDAY_MONTHS, HAND_LIMIT, SHORT_NOTIONAL, lengthRounds,
  };
})();

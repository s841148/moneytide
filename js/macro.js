// 錢潮 MoneyTide © 2026 麥麥的遊戲工廠 保留所有權利 All rights reserved. 詳見 LICENSE
// 總經引擎與價格模型（GDD 第 7、8 章）。只處理數字，不碰畫面。
// 每季結算：世界新聞 → 景氣階段 → GDP/通膨/失業/油價/VIX → 央行利率 → 匯率 → 所有商品價格 → 因果鏈說明。
window.MT = window.MT || {};

(function () {
  const R = MT.RNG;
  const D = MT.DATA;

  const LEVELS = { easy: 0, medium: 1, hard: 2 };
  const VOL_MULT = { easy: 0.7, medium: 1, hard: 1.3 };

  // 景氣階段轉換機率（GDD 7.2；試玩調整：擴張期較長、衰退期較短，接近真實經濟）
  const PHASE_NEXT = {
    recovery: [['recovery', 0.55], ['expansion', 0.45]],
    expansion: [['expansion', 0.75], ['overheat', 0.2], ['recession', 0.05]],
    overheat: [['overheat', 0.5], ['expansion', 0.2], ['recession', 0.3]],
    recession: [['recession', 0.45], ['recovery', 0.55]],
  };
  // 各階段的目標值：GDP、通膨、大盤每季基本報酬、VIX、油價每季趨勢
  // 長期平均大盤每季約 +2.8%，扣掉偏負面的歷史事件後，大盤 ETF 年化約 6–7%
  const TARGET = {
    recovery: { gdp: 2.5, cpi: 1.5, ret: 0.06, vix: 18, oil: 0.01 },
    expansion: { gdp: 4, cpi: 2.3, ret: 0.04, vix: 13, oil: 0.02 },
    overheat: { gdp: 3.2, cpi: 4, ret: 0.02, vix: 16, oil: 0.03 },
    recession: { gdp: -1.5, cpi: 1, ret: -0.03, vix: 28, oil: -0.05 },
  };
  const REBOUND = 0.4; // 新聞事件造成的漲跌，下一季回補 40%（市場常常反應過度）

  const byId = {};
  D.instruments.forEach((i) => { byId[i.id] = i; });

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function r2(x) { return Math.round(x * 100) / 100; }
  function gauss(state) {
    let u = 0;
    while (u === 0) u = R.next(state);
    const v = R.next(state);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function tx(zh, en, p) { return p ? { zh, en, p } : { zh, en }; }
  function pct(x, digits) { return (x >= 0 ? '+' : '') + (x * 100).toFixed(digits == null ? 1 : digits) + '%'; }

  function snapshot(m) {
    return {
      phase: m.phase, gdp: m.gdp, cpi: m.cpi, rate: m.rate, usRate: m.usRate, unemp: m.unemp, fx: m.fx, oil: m.oil, vix: m.vix,
      usdjpy: m.usdjpy, eurusd: m.eurusd, usdcny: m.usdcny,
    };
  }

  // 其他貨幣：用「對美元」的匯率表示，換成台幣時再乘上美元/台幣
  //   usdjpy 1 美元換幾日圓、eurusd 1 歐元換幾美元、usdcny 1 美元換幾人民幣；jpRate / euRate / cnRate 各國央行利率
  const FX_START = { usdjpy: 150, eurusd: 1.08, usdcny: 7.2, jpRate: 0.25, euRate: 2.5, cnRate: 1.5 };

  function init(state) {
    state.macro = Object.assign({ phase: 'recovery', gdp: 2.0, cpi: 1.8, rate: 2.25, usRate: 3.75, unemp: 4.2, fx: 31.5, oil: 75, vix: 18, cbDoneRound: 0 }, FX_START);
    const prices = {}, history = {}, last = {};
    D.instruments.forEach((i) => { prices[i.id] = i.price; history[i.id] = [i.price]; last[i.id] = 0; });
    state.market = { prices, history, last, contrib: {}, pressure: {}, intra: {}, roundRateMove: 0, macroHistory: [snapshot(state.macro)], reIndex: 1 };
    state.report = null;
  }

  // ── 查詢 ──
  function available(state) {
    const lv = LEVELS[state.config.difficulty];
    return D.instruments.filter((i) => LEVELS[i.level] <= lv);
  }
  function isTradable(state, id) {
    const i = byId[id];
    return !!i && LEVELS[i.level] <= LEVELS[state.config.difficulty];
  }
  function yieldOf(state, i) {
    const m = state.macro;
    if (i.id === 'TD') return Math.max(0.002, (m.rate - 0.4) / 100);
    if (i.id === 'USD') return Math.max(0.002, (m.usRate - 0.4) / 100);
    if (i.id === 'JPY') return Math.max(0.0005, (m.jpRate - 0.1) / 100);
    if (i.id === 'EUR') return Math.max(0.002, (m.euRate - 0.4) / 100);
    if (i.id === 'CNY') return Math.max(0.005, (m.cnRate + 0.3) / 100);
    if (i.id === 'BOND') return Math.max(0.005, (m.usRate + 0.4) / 100);
    return i.yield;
  }
  // 1 單位外幣值多少台幣
  function ccyTWD(m, ccy) {
    switch (ccy) {
      case 'USD': return m.fx;
      case 'JPY': return m.fx / m.usdjpy;
      case 'EUR': return m.fx * m.eurusd;
      case 'CNY': return m.fx / m.usdcny;
      default: return 1;
    }
  }
  function fxOf(state, i) { return ccyTWD(state.macro, i.ccy); }
  function priceTWD(state, id) { return state.market.prices[id] * fxOf(state, byId[id]); }
  function holdingValue(state, p) {
    let v = 0;
    for (const id in p.holdings) v += p.holdings[id] * priceTWD(state, id);
    return v;
  }
  // 每檔持股每月的股息 / 利息
  function incomeLines(state, p) {
    const out = [];
    for (const id in p.holdings) {
      const monthly = (p.holdings[id] * priceTWD(state, id) * yieldOf(state, byId[id])) / 12;
      if (monthly >= 1) out.push({ id, monthly: Math.round(monthly) });
    }
    return out;
  }
  function dividendMonthly(state, p) { return incomeLines(state, p).reduce((s, l) => s + l.monthly, 0); }

  function costs(i) {
    switch (i.type) {
      case 'stock': return { buy: 0.001425, sell: 0.004425 };
      case 'etf': case 'bond': return { buy: 0.001425, sell: 0.002425 };
      case 'fund': return { buy: 0.015, sell: 0 }; // 基金申購手續費 1.5%
      case 'commodity': case 'fx': return { buy: i.spread, sell: i.spread };
      default: return { buy: 0, sell: 0 };
    }
  }

  function addIntra(state, id, key, v) {
    const it = state.market.intra[id] || (state.market.intra[id] = {});
    it[key] = (it[key] || 0) + v;
  }

  // 股票、ETF、債券 ETF 以「股」為單位，只能買整數股（台股 1 張 = 1,000 股）
  function byShares(i) { return i.type === 'stock' || i.type === 'etf' || i.type === 'bond'; }
  function lotSize(i) { return byShares(i) && i.ccy === 'TWD' ? 1000 : 1; }

  // 買進 units 股要付多少台幣（含滑價與手續費）
  function buyCost(state, id, units) {
    const i = byId[id];
    const fx = fxOf(state, i);
    const p0 = state.market.prices[id];
    const impact = (units * p0 * fx) / i.liquidity;
    const gross = units * p0 * (1 + impact / 2) * fx;
    return Math.ceil(gross * (1 + costs(i).buy));
  }
  // 現金最多買得起幾股
  function maxShares(state, p, id) {
    const i = byId[id];
    let n = Math.floor(p.cash / (priceTWD(state, id) * (1 + costs(i).buy)));
    while (n > 0 && buyCost(state, id, n) > p.cash) n -= 1;
    return Math.max(0, n);
  }

  // ── 交易：buy 以台幣金額下單（以股計價的商品會換成整數股），或用 byUnits 指定股數；sell 以單位數下單 ──
  function trade(state, p, id, side, amount, byUnits) {
    if (!isTradable(state, id)) return { error: 'bad_phase' };
    const i = byId[id];
    const fx = fxOf(state, i);
    const c = costs(i);
    const fixed = i.type === 'deposit' || i.type === 'fx';
    const p0 = state.market.prices[id];

    if (side === 'buy' && (byUnits || byShares(i))) {
      let units;
      if (byUnits) units = Math.floor(amount);
      else {
        // 用金額下單：換算成買得起的整數股
        const budget = Math.min(Math.floor(amount), p.cash);
        units = Math.floor((budget * (1 - c.buy)) / (p0 * fx * (1 + budget / i.liquidity / 2)));
        while (units > 0 && buyCost(state, id, units) > budget) units -= 1;
      }
      if (!(units > 0)) return { error: 'bad_amount' };
      const total = buyCost(state, id, units);
      if (p.cash < total) return { error: 'not_enough_cash' };
      const impact = (units * p0 * fx) / i.liquidity;
      const p1 = p0 * (1 + impact);
      const fee = total - Math.round(units * p0 * (1 + impact / 2) * fx);
      state.market.prices[id] = p1;
      state.market.pressure[id] = (state.market.pressure[id] || 0) + impact;
      if (impact) addIntra(state, id, 'trade', impact);
      p.cash -= total;
      p.holdings[id] = (p.holdings[id] || 0) + units;
      p.cost[id] = (p.cost[id] || 0) + total;
      return { units, fee, amount: total };
    }

    if (side === 'buy') {
      amount = Math.floor(amount);
      if (!(amount > 0)) return { error: 'bad_amount' };
      if (p.cash < amount) return { error: 'not_enough_cash' };
      const fee = amount * c.buy;
      const net = amount - fee;
      const impact = fixed ? 0 : net / i.liquidity;
      const p1 = p0 * (1 + impact);
      const fill = (p0 + p1) / 2;
      const units = net / (fill * fx);
      state.market.prices[id] = p1;
      state.market.pressure[id] = (state.market.pressure[id] || 0) + impact;
      if (impact) addIntra(state, id, 'trade', impact);
      p.cash -= amount;
      p.holdings[id] = (p.holdings[id] || 0) + units;
      p.cost[id] = (p.cost[id] || 0) + amount;
      return { units, fee, amount };
    }

    const have = p.holdings[id] || 0;
    const units = Math.min(amount, have);
    if (!(units > 0)) return { error: 'bad_amount' };
    const impact = fixed ? 0 : (units * p0 * fx) / i.liquidity;
    const p1 = p0 * (1 - impact);
    const fill = (p0 + p1) / 2;
    const gross = units * fill * fx;
    const fee = gross * c.sell;
    const proceeds = gross - fee;
    const basis = (p.cost[id] || 0) * (units / have);
    state.market.prices[id] = p1;
    state.market.pressure[id] = (state.market.pressure[id] || 0) - impact;
    if (impact) addIntra(state, id, 'trade', -impact);
    p.cash += proceeds;
    if (have - units < 1e-6) {
      delete p.holdings[id];
      delete p.cost[id];
    } else {
      p.holdings[id] = have - units;
      p.cost[id] -= basis;
    }
    return { units, fee, proceeds, gain: proceeds - basis };
  }

  // ── 事件衝擊 ──
  function shockFor(i, shocks) {
    let s = 0;
    const equity = i.type === 'stock' || i.type === 'etf' || i.type === 'fund';
    for (const k in shocks) {
      const v = shocks[k];
      if (k === i.id) s += v;
      else if (k === 'all' && equity) s += v * Math.max(0.3, i.beta);
      else if (k === 'tw' && equity && i.ccy === 'TWD') s += v * Math.max(0.3, i.beta);
      else if (k.indexOf('sector:') === 0 && k.slice(7) === i.sector) s += v;
    }
    return s;
  }

  // 市場消息、地緣政治、攻擊卡：立即改變價格（與總經數字），回傳每位玩家受到的影響
  // key = 漲跌原因分析裡的分類（news / geo / attack）
  function applyNews(state, card, key) {
    const before = state.players.map((p) => holdingValue(state, p));
    const ef = card.effect;
    const m = state.macro;
    D.instruments.forEach((i) => {
      const s = shockFor(i, ef.shocks || {});
      if (s) {
        state.market.prices[i.id] = Math.max(i.price * 0.02, state.market.prices[i.id] * (1 + s));
        addIntra(state, i.id, key || 'news', s);
      }
    });
    const x = ef.macro || {};
    if (x.fx) m.fx = clamp(m.fx * (1 + x.fx), 26, 36);
    if (x.oil) m.oil = clamp(m.oil * (1 + x.oil), 30, 150);
    if (x.vix) m.vix = clamp(m.vix + x.vix, 10, 80);
    if (x.cpi) m.cpi = clamp(m.cpi + x.cpi, -1, 10);
    if (x.gdp) m.gdp = clamp(m.gdp + x.gdp, -6, 8);
    if (x.usRate) m.usRate = r2(clamp(m.usRate + x.usRate, 0, 8));
    moveCcy(m, x);
    // 制裁：凍結商品，期間無法賣出
    if (ef.freeze) {
      if (!state.market.frozen) state.market.frozen = {};
      for (const id in ef.freeze) state.market.frozen[id] = Math.max(state.market.frozen[id] || 0, state.round + ef.freeze[id] - 1);
    }
    return state.players.map((p, k) => ({ id: p.id, delta: Math.round(holdingValue(state, p) - before[k]) }));
  }

  // 事件對其他貨幣的衝擊：jpy / eur / cny 為該貨幣的漲跌（正數 = 升值）
  function moveCcy(m, x) {
    if (x.jpy) m.usdjpy = clamp(m.usdjpy / (1 + x.jpy), 100, 180);
    if (x.eur) m.eurusd = clamp(m.eurusd * (1 + x.eur), 0.8, 1.5);
    if (x.cny) m.usdcny = clamp(m.usdcny / (1 + x.cny), 6, 8);
  }

  function isFrozen(state, id) {
    return !!(state.market.frozen && state.market.frozen[id] >= state.round);
  }

  // 預先擲出下一季的景氣階段（「經濟研究報告」卡可以預看）
  function rollPhase(state) {
    let x = R.next(state);
    for (const [next, prob] of PHASE_NEXT[state.macro.phase]) {
      if (x < prob) return next;
      x -= prob;
    }
    return state.macro.phase;
  }

  // ── 央行 ──
  function cbTarget(m) { return clamp(1.75 + 1.5 * (m.cpi - 2) + 0.5 * (m.gdp - 2.5) - 0.3 * (m.unemp - 4.5), 0, 8); }
  function cbDecide(state) {
    const m = state.macro;
    const diff = cbTarget(m) - m.rate + gauss(state) * 0.15;
    let move = 0;
    if (Math.abs(diff) >= 0.2) move = clamp(Math.round(diff / 0.25) * 0.25, -0.5, 0.5);
    if (m.rate + move < 0) move = -m.rate;
    return r2(move);
  }
  // 央行會議格：立即調整利率，利率敏感的商品馬上反應
  function applyRate(state, move) {
    const m = state.macro;
    m.rate = r2(clamp(m.rate + move, 0, 8));
    state.market.roundRateMove += move;
    if (!move) return;
    D.instruments.forEach((i) => {
      if (i.ccy !== 'TWD' || !i.sens.rate) return;
      const r = i.sens.rate * move;
      state.market.prices[i.id] *= 1 + r;
      addIntra(state, i.id, 'rate', r);
    });
  }

  // ── 每季結算 ──
  // forcedPhase：事先預測好的景氣階段（沒給就當場擲）
  function settle(state, worldCard, forcedPhase) {
    const m = state.macro;
    const mk = state.market;
    const before = snapshot(m);
    const vm = VOL_MULT[state.config.difficulty];
    const ev = worldCard ? worldCard.effect : null;
    const evm = (ev && ev.macro) || {};

    // 1. 景氣階段
    const phase = (ev && ev.phase) || forcedPhase || rollPhase(state);
    m.phase = phase;
    const T = TARGET[phase];

    // 2. 總經變數（先走正常趨勢，再加上新聞事件的衝擊）
    m.gdp = clamp(m.gdp + (T.gdp - m.gdp) * 0.4 + gauss(state) * 0.4 + (evm.gdp || 0), -6, 8);
    m.oil = clamp(m.oil * Math.exp(T.oil - 0.1 * Math.log(m.oil / 75) + gauss(state) * 0.07) * (1 + (evm.oil || 0)), 30, 150);
    const oilEffect = ((m.oil - 75) / 75) * 2.5;
    m.cpi = clamp(m.cpi + (T.cpi + oilEffect - m.cpi) * 0.35 + gauss(state) * 0.2 + (evm.cpi || 0), -1, 10);
    m.unemp = clamp(m.unemp - (m.gdp - 2.5) * 0.12 + gauss(state) * 0.1, 2, 12);
    m.vix = clamp(m.vix + (T.vix - m.vix) * 0.5 + gauss(state) * 2 * vm + (evm.vix || 0), 10, 80);

    // 3. 央行（本季已在「央行會議」格開過會就不再決議）
    let move = m.cbDoneRound === state.round ? 0 : cbDecide(state);
    move += evm.rate || 0;
    const rateBefore = m.rate;
    m.rate = r2(clamp(m.rate + move, 0, 8));
    mk.roundRateMove += m.rate - rateBefore;
    const usTarget = clamp(3.0 + 1.5 * (m.cpi - 2) + 0.5 * (m.gdp - 2.5), 0, 8);
    let usMove = clamp(Math.round((usTarget - m.usRate) / 0.25) * 0.25, -0.5, 0.5) + (evm.usRate || 0);
    m.usRate = r2(clamp(m.usRate + usMove, 0, 8));
    usMove = m.usRate - before.usRate;

    // 4. 匯率：美台利差越大、市場越恐慌，美元越強
    const dFx = 0.004 * (m.usRate - m.rate - 1.25) + 0.0015 * (m.vix - before.vix) - 0.06 * Math.log(m.fx / 31)
      + gauss(state) * 0.01 * vm + (evm.fx || 0);
    m.fx = clamp(m.fx * (1 + dFx), 26, 36);

    // 4b. 其他貨幣：日本利率很低且恐慌時日圓升值（避險），歐元跟著美歐利差，人民幣受央行管理、波動小
    m.jpRate = r2(clamp(m.jpRate + (0.5 - m.jpRate) * 0.1 + gauss(state) * 0.05, 0, 3));
    m.euRate = r2(clamp(m.euRate + Math.round(((m.usRate - 1) - m.euRate) * 0.3 / 0.25) * 0.25, 0, 6));
    m.cnRate = r2(clamp(m.cnRate + (1.5 - m.cnRate) * 0.2, 0, 4));
    const dJpy = 0.008 * (m.usRate - m.jpRate - 3) - 0.003 * (m.vix - before.vix) - 0.08 * Math.log(m.usdjpy / 140) + gauss(state) * 0.02 * vm;
    m.usdjpy = clamp(m.usdjpy * (1 + dJpy), 100, 180);
    const dEur = -0.006 * (m.usRate - m.euRate - 0.75) + 0.002 * (m.gdp - 2.5) - 0.08 * Math.log(m.eurusd / 1.1) + gauss(state) * 0.015 * vm;
    m.eurusd = clamp(m.eurusd * (1 + dEur), 0.8, 1.5);
    const dCny = 0.002 * (m.usRate - m.cnRate - 2) - 0.1 * Math.log(m.usdcny / 7) + gauss(state) * 0.005 * vm;
    m.usdcny = clamp(m.usdcny * (1 + dCny), 6, 8);
    moveCcy(m, evm);

    // 5. 商品價格
    const dRate = m.rate - rateBefore;
    const dOil = m.oil / before.oil - 1;
    const dVix = m.vix - before.vix;
    const fxRet = m.fx / before.fx - 1;
    const mkt = T.ret + 0.006 * (m.gdp - 2.5) - 0.02 * dRate + gauss(state) * 0.035 * (m.vix / 18) * vm;
    if (!mk.lastShock) mk.lastShock = {};
    const nextShock = {};

    D.instruments.forEach((i) => {
      const intra = mk.intra[i.id] || {};
      let c = {};
      if (i.type !== 'deposit' && i.type !== 'fx') {
        c = {
          market: i.beta * mkt,
          rate: i.type === 'bond' ? (-i.duration * usMove) / 100 : i.sens.rate * (i.ccy === 'USD' ? usMove : dRate),
          oil: i.sens.oil * dOil,
          fx: i.sens.fx * fxRet,
          vix: (i.sens.vix * dVix) / 10,
          event: ev && ev.shocks ? shockFor(i, ev.shocks) : 0,
          rebound: -REBOUND * (mk.lastShock[i.id] || 0),
          trade: -0.4 * (mk.pressure[i.id] || 0),
          noise: i.vol * vm * gauss(state),
          fee: i.fee ? -i.fee / 4 : 0,
        };
        let r = 0;
        for (const k in c) r += c[k];
        r = clamp(r, -0.6, 1.0);
        mk.prices[i.id] = Math.max(i.price * 0.02, mk.prices[i.id] * (1 + r));
      }
      // 記下本季的新聞衝擊，下一季部分回補
      nextShock[i.id] = (c.event || 0) + (intra.news || 0) + (intra.geo || 0) + (intra.attack || 0);
      // 合併本季中途發生的變化（市場消息、央行會議、玩家買賣）
      for (const k in intra) c[k] = (c[k] || 0) + intra[k];
      if (i.ccy !== 'TWD') c.fxTWD = ccyTWD(m, i.ccy) / ccyTWD(before, i.ccy) - 1; // 換回台幣時的匯率影響
      const h = mk.history[i.id];
      mk.last[i.id] = mk.prices[i.id] / h[h.length - 1] - 1;
      h.push(mk.prices[i.id]);
      if (h.length > 41) h.shift();
      mk.contrib[i.id] = c;
    });

    // 房價指數：長期緩漲，升息與衰退時下跌（升息 1 個百分點約跌 4%）
    const RE_PHASE = { recovery: 0, expansion: 0.01, overheat: 0.005, recession: -0.025 };
    mk.reIndex = Math.max(0.3, mk.reIndex * (1 + 0.01 - 0.04 * dRate + RE_PHASE[phase] + gauss(state) * 0.01 * vm));

    // 6. 通膨讓生活費上升，薪資只跟上一半
    const living = Math.max(0, m.cpi) / 400;
    state.players.forEach((p) => {
      if (p.bankrupt) return;
      p.living *= 1 + living;
      p.salary *= 1 + living * 0.5;
    });

    const after = snapshot(m);
    mk.macroHistory.push(after);
    if (mk.macroHistory.length > 41) mk.macroHistory.shift();

    const report = {
      round: state.round,
      before, after,
      rateMove: r2(mk.roundRateMove),
      usMove: r2(usMove),
      world: worldCard ? worldCard.id : null,
      living,
      movers: movers(state),
    };
    report.chains = buildChains(state, report, worldCard);
    state.report = report;

    mk.lastShock = nextShock;
    mk.pressure = {};
    mk.intra = {};
    mk.roundRateMove = 0;
    return report;
  }

  function movers(state) {
    return available(state)
      .filter((i) => i.type !== 'deposit' && i.type !== 'fx')
      .map((i) => ({ id: i.id, r: state.market.last[i.id] }))
      .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
      .slice(0, 4);
  }

  // ── 因果鏈（「💡 為什麼？」）──
  const PH = (id) => D.phases[id].name;

  function buildChains(state, rp, worldCard) {
    const chains = [];
    const a = rp.after;
    const b = rp.before;

    if (worldCard) {
      chains.push({ icon: worldCard.icon, title: worldCard.name, steps: worldCard.chain });
    }
    if (a.phase !== b.phase) {
      chains.push({
        icon: D.phases[a.phase].icon,
        title: tx('景氣從「' + PH(b.phase).zh + '」進入「' + PH(a.phase).zh + '」', 'The economy moved from ' + PH(b.phase).en + ' to ' + PH(a.phase).en),
        steps: [tx(D.phases[a.phase].desc.zh, D.phases[a.phase].desc.en, 'p_cycle')],
      });
    }
    if (rp.rateMove > 0) {
      chains.push({
        icon: '🏦',
        title: tx('央行升息 ' + rp.rateMove.toFixed(2) + ' 個百分點（利率 ' + a.rate.toFixed(2) + '%）', 'Central bank hikes ' + rp.rateMove.toFixed(2) + ' pts (rate ' + a.rate.toFixed(2) + '%)'),
        steps: [
          a.cpi > 2.2
            ? tx('通膨 ' + a.cpi.toFixed(1) + '% 高於 2% 目標 → 央行踩煞車', 'Inflation ' + a.cpi.toFixed(1) + '% is above the 2% target → the central bank brakes', 'p_brake')
            : tx('景氣升溫（GDP ' + a.gdp.toFixed(1) + '%），央行預先踩煞車，避免之後通膨升高', 'The economy is heating up (GDP ' + a.gdp.toFixed(1) + '%), so the central bank brakes early to head off inflation', 'p_brake'),
          tx('債券、公用事業股價格下跌', 'Bonds and utilities fall', 'p_rate_bond'),
          tx('借錢變貴 → 成長股（科技、電動車）估值下修', 'Costlier money → growth stocks (tech, EVs) re-rated'),
          tx('定存利率提高，銀行利差擴大', 'Deposit rates rise; banks earn wider spreads'),
          tx('台灣利率提高 → 吸引資金，台幣傾向升值', 'Higher Taiwan rates attract money → TWD tends to strengthen', 'p_capital_flow'),
        ],
      });
    } else if (rp.rateMove < 0) {
      chains.push({
        icon: '🏦',
        title: tx('央行降息 ' + (-rp.rateMove).toFixed(2) + ' 個百分點（利率 ' + a.rate.toFixed(2) + '%）', 'Central bank cuts ' + (-rp.rateMove).toFixed(2) + ' pts (rate ' + a.rate.toFixed(2) + '%)'),
        steps: [
          a.gdp < 2.5 || a.unemp > 4.5
            ? tx('景氣轉弱（GDP ' + a.gdp.toFixed(1) + '%、失業率 ' + a.unemp.toFixed(1) + '%）→ 央行踩油門', 'Weak economy (GDP ' + a.gdp.toFixed(1) + '%, unemployment ' + a.unemp.toFixed(1) + '%) → the central bank accelerates', 'p_accel')
            : tx('通膨降到 ' + a.cpi.toFixed(1) + '%，央行放鬆煞車', 'Inflation has cooled to ' + a.cpi.toFixed(1) + '%, so the central bank eases off the brake', 'p_accel'),
          tx('債券價格上漲', 'Bond prices rise', 'p_rate_bond'),
          tx('借錢變便宜 → 股市有支撐', 'Cheaper money supports stocks'),
          tx('定存利息變少，現金的吸引力下降', 'Deposits earn less; cash is less attractive', 'p_inflation_cash'),
        ],
      });
    }
    const dOil = a.oil / b.oil - 1;
    if (Math.abs(dOil) >= 0.15) {
      chains.push({
        icon: '🛢️',
        title: tx('油價 ' + b.oil.toFixed(0) + ' → ' + a.oil.toFixed(0) + ' 美元（' + pct(dOil, 0) + '）', 'Oil ' + b.oil.toFixed(0) + ' → ' + a.oil.toFixed(0) + ' USD (' + pct(dOil, 0) + ')'),
        steps: dOil > 0 ? [
          tx('運輸與製造成本上升 → 通膨壓力增加', 'Transport and production costs rise → inflation pressure', 'p_oil'),
          tx('能源股受惠；航運、食品成本上升', 'Energy gains; shipping and food costs rise'),
        ] : [
          tx('油價下跌 → 物價壓力減輕', 'Cheaper oil → less price pressure', 'p_oil'),
          tx('能源股下跌；航運與一般企業成本降低', 'Energy falls; shipping and others save on costs'),
        ],
      });
    }
    if (a.vix - b.vix >= 8) {
      chains.push({
        icon: '😱',
        title: tx('市場恐慌：VIX 升到 ' + a.vix.toFixed(0), 'Market fear: VIX jumps to ' + a.vix.toFixed(0)),
        steps: [
          tx('投資人賣股票 → 資金逃向黃金與公債', 'Investors sell stocks → money flees to gold and bonds', 'p_safe'),
          tx('高 Beta 股票跌最多', 'High-beta stocks fall the most', 'p_risk_return'),
          tx('美元通常走強，新興市場受壓', 'The dollar usually strengthens; emerging markets suffer'),
        ],
      });
    } else if (b.vix - a.vix >= 8) {
      chains.push({
        icon: '😌',
        title: tx('恐慌消退：VIX 降到 ' + a.vix.toFixed(0), 'Fear fades: VIX drops to ' + a.vix.toFixed(0)),
        steps: [tx('資金從避險資產回到股市', 'Money leaves safe havens for stocks', 'p_safe')],
      });
    }
    const dFx = a.fx / b.fx - 1;
    if (Math.abs(dFx) >= 0.02) {
      chains.push({
        icon: '💱',
        title: dFx > 0
          ? tx('台幣貶值：美元/台幣 ' + b.fx.toFixed(2) + ' → ' + a.fx.toFixed(2), 'TWD weakens: USD/TWD ' + b.fx.toFixed(2) + ' → ' + a.fx.toFixed(2))
          : tx('台幣升值：美元/台幣 ' + b.fx.toFixed(2) + ' → ' + a.fx.toFixed(2), 'TWD strengthens: USD/TWD ' + b.fx.toFixed(2) + ' → ' + a.fx.toFixed(2)),
        steps: dFx > 0 ? [
          tx('美國利率比台灣高 ' + (a.usRate - a.rate).toFixed(2) + ' 個百分點 → 資金流向美國', 'US rates exceed Taiwan’s by ' + (a.usRate - a.rate).toFixed(2) + ' pts → money flows to the US', 'p_capital_flow'),
          tx('出口股受惠；美元資產換回台幣變多', 'Exporters gain; dollar assets are worth more in TWD', 'p_fx_trade'),
        ] : [
          tx('資金流入台灣 → 台幣需求增加', 'Money flows into Taiwan → more demand for TWD', 'p_supply'),
          tx('出口股受壓；美元資產換回台幣變少', 'Exporters suffer; dollar assets are worth less in TWD', 'p_fx_trade'),
        ],
      });
    }
    if (rp.living > 0.004) {
      chains.push({
        icon: '🛒',
        title: tx('物價上漲，生活費增加 ' + pct(rp.living, 2), 'Prices rose; living costs up ' + pct(rp.living, 2)),
        steps: [tx('通膨 ' + a.cpi.toFixed(1) + '%：薪水只跟上一半，現金的購買力變小', 'Inflation ' + a.cpi.toFixed(1) + '%: wages keep up only halfway, and cash buys less', 'p_inflation_cash')],
      });
    }
    if (!chains.length) {
      chains.push({
        icon: D.phases[a.phase].icon,
        title: tx('本季市場平靜，景氣處於「' + PH(a.phase).zh + '」', 'A quiet quarter in the ' + PH(a.phase).en + ' phase'),
        steps: [tx(D.phases[a.phase].desc.zh, D.phases[a.phase].desc.en, 'p_cycle')],
      });
    }
    return chains;
  }

  // 舊存檔：補上其他貨幣與新商品
  function migrate(state) {
    const m = state.macro;
    Object.keys(FX_START).forEach((k) => { if (m[k] == null) m[k] = FX_START[k]; });
    const mk = state.market;
    D.instruments.forEach((i) => {
      if (mk.prices[i.id] != null) return;
      mk.prices[i.id] = i.price;
      mk.history[i.id] = [i.price];
      mk.last[i.id] = 0;
    });
    (mk.macroHistory || []).forEach((h) => Object.keys(FX_START).forEach((k) => { if (h[k] == null) h[k] = m[k]; }));
  }

  MT.Macro = {
    migrate, ccyTWD, byShares, lotSize, buyCost, maxShares,
    init, settle, trade, applyNews, applyRate, cbDecide, cbTarget, isFrozen, rollPhase,
    available, isTradable, yieldOf, fxOf, priceTWD, holdingValue, incomeLines, dividendMonthly, costs,
    byId, LEVELS,
  };
})();

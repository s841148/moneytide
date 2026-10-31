// 錢潮 MoneyTide © 2026 麥麥的遊戲工廠 保留所有權利 All rights reserved. 詳見 LICENSE
// 電腦 AI 對手（GDD 第 12 章）。每次只決定「下一個動作」，由畫面一步一步執行，玩家才看得懂 AI 在做什麼。
// decide(state) → { action, reason }，reason 是雙語的決策理由，會寫進紀錄。
window.MT = window.MT || {};

(function () {
  const E = MT.Engine;
  const C = E.Calc;
  const M = MT.Macro;
  const D = MT.DATA;

  // 投資性格
  //   reserve：保留幾個月支出當預備金；dealROI：機會卡最低年報酬率；loan：借款月付最多可占新資產現金流的比例（0 = 不借錢）
  //   attack：會不會用攻擊卡；illegal：會不會用違法卡；installment：會不會分期；invest：每次拿多少比例的閒錢去投資
  //   auctionROI：拍賣時要求的最低報酬率（越低代表越敢出高價）
  const STYLES = {
    conservative: {
      icon: '🐢', name: { zh: '穩健阿姨', en: 'Steady Auntie' },
      desc: { zh: '偏好定存、債券、高股息，幾乎不借錢', en: 'Deposits, bonds and dividends; almost never borrows' },
      reserve: 6, dealROI: 0.15, loan: 0, attack: false, illegal: false, installment: false, invest: 0.5, auctionROI: 0.16,
    },
    value: {
      icon: '💎', name: { zh: '價值老爹', en: 'Value Pops' },
      desc: { zh: '跌深了才買、長期持有、賺夠了才賣', en: 'Buys after drops, holds long, sells big winners' },
      reserve: 3, dealROI: 0.12, loan: 0.6, attack: false, illegal: false, installment: false, invest: 0.4, auctionROI: 0.13,
    },
    momentum: {
      icon: '🚀', name: { zh: '衝衝哥', en: 'Rocket Bro' },
      desc: { zh: '追漲殺跌、愛借錢、愛分期', en: 'Chases winners, dumps losers, loves loans' },
      reserve: 1, dealROI: 0.08, loan: 1.0, attack: true, illegal: false, installment: true, invest: 0.7, auctionROI: 0.09,
    },
    macro: {
      icon: '🌐', name: { zh: '宏觀先生', en: 'Mr. Macro' },
      desc: { zh: '看景氣與利率輪動資產', en: 'Rotates assets with the cycle and rates' },
      reserve: 3, dealROI: 0.11, loan: 0.7, attack: true, illegal: false, installment: false, invest: 0.5, auctionROI: 0.12,
    },
    speculator: {
      icon: '🦊', name: { zh: '狐狸', en: 'The Fox' },
      desc: { zh: '愛用攻擊卡和違法手段，愛賭題材股', en: 'Loves attack cards, shady tricks and hot stocks' },
      reserve: 1.5, dealROI: 0.1, loan: 0.9, attack: true, illegal: true, installment: true, invest: 0.6, auctionROI: 0.08,
    },
  };

  // 強度：quiz 答對率、noise 做出隨機（較差）決定的機率、cb 猜央行時的誤差
  //       scam 識破詐騙的機率
  const LEVELS = {
    easy: { quiz: 0.5, noise: 0.35, cb: 0.6, bid: [0.8, 1.4], scam: 0.4 },
    normal: { quiz: 0.75, noise: 0.15, cb: 0.25, bid: [0.95, 1.1], scam: 0.7 },
    hard: { quiz: 0.95, noise: 0.03, cb: 0.05, bid: [1, 1], scam: 0.95 },
  };
  // 各性格會買的保單
  const POLICIES = {
    conservative: ['medical', 'property', 'life'],
    value: ['medical', 'property'],
    macro: ['medical'],
    momentum: [],
    speculator: [],
  };

  // 宏觀先生各階段偏好的商品
  const PHASE_PICKS = {
    recovery: ['TW50', 'CHIP', 'BANK', 'TECH', 'EMKT'],
    expansion: ['TW50', 'CHIP', 'TECH', 'SHIP', 'WORLD'],
    overheat: ['OIL', 'GOLD', 'BANK', 'DEF'],
    recession: ['BOND', 'GOLD', 'FOOD', 'UTIL', 'TD'],
  };
  const SAFE_PICKS = ['HDIV', 'TD', 'BOND', 'UTIL', 'FOOD', 'TW50'];
  const SPEC_PICKS = ['BIO', 'CAR', 'SHIP', 'CHIP', 'EMKT'];

  // 每回合的計數（不存檔，避免同一回合重複做太多事）
  const memo = {};
  function mem(s) {
    const k = s.round + '-' + s.current;
    if (!memo[k]) {
      Object.keys(memo).forEach((x) => delete memo[x]);
      memo[k] = { buys: 0, sells: 0, cards: 0, fails: {} };
    }
    return memo[k];
  }

  function tx(zh, en) { return { zh, en }; }
  function pct(x) { return (x >= 0 ? '+' : '') + (x * 100).toFixed(0) + '%'; }
  function fmt(n) { return MT.fmtMoney(n); }
  function chance(x) { return Math.random() < x; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function actorOf(s) {
    const pd = s.pending;
    if (s.phase === 'resolve' && pd) {
      if (pd.type === 'auction') return s.players[pd.turn];
      if (pd.type === 'offer') return s.players[pd.to];
    }
    return s.players[s.current];
  }

  function reserveOf(p) { return C.expenses(p) * STYLES[p.ai.style].reserve; }
  function spare(p) { return p.cash - reserveOf(p); }
  function act(action, reason) { return { action, reason }; }
  function nameOf(id) { return M.byId[id].name; }

  // ── 自由階段（擲骰前 / 回合結束前）──
  function repayLoans(s, p, st, m) {
    if (m.fails.REPAY || p.bankLoan <= 0) return null;
    const units = Math.min(Math.ceil(p.bankLoan / E.LOAN_UNIT), Math.floor((p.cash - reserveOf(p) * 1.2 - 50000) / E.LOAN_UNIT));
    if (units >= 1) {
      return act({ type: 'REPAY', units }, tx('有多的現金，先還銀行借款，省下 12% 的利息', 'Spare cash — repay the bank loan and save 12% interest'));
    }
    return null;
  }

  function payoffDebts(s, p, st, m) {
    if (m.fails.PAYOFF || st.installment) return null;
    const l = p.liabilities.find((x) => x.lender == null && x.balance < 1000000 && x.balance <= spare(p) - 50000);
    if (!l) return null;
    return act({ type: 'PAYOFF', id: l.id }, tx('提前還清「' + l.name.zh + '」，每月支出少 ' + fmt(l.payment), 'Pay off "' + l.name.en + '" early — ' + fmt(l.payment) + ' less each month'));
  }

  function opponents(s, p) { return s.players.filter((x) => x !== p && !x.bankrupt); }

  function oppHoldingOf(s, p, id) {
    return opponents(s, p).reduce((sum, o) => sum + (o.holdings[id] || 0) * M.priceTWD(s, id), 0);
  }

  function playCards(s, p, st, lv, m) {
    if (m.fails.PLAY_CARD || m.cards >= 1 || !p.hand.length) return null;
    const mac = s.macro;
    const play = (id, target, reason) => {
      m.cards += 1;
      return act({ type: 'PLAY_CARD', index: p.hand.indexOf(id), target: target || {} }, reason);
    };
    const has = (id) => p.hand.indexOf(id) >= 0;

    if (has('hedge') && M.holdingValue(s, p) > 100000 && (mac.phase === 'overheat' || mac.phase === 'recession' || mac.vix > 25)) {
      return play('hedge', null, tx('景氣看起來不妙，先做避險', 'Things look shaky — time to hedge'));
    }
    if (has('research')) return play('research', null, tx('先研究一下景氣再投資', 'Research the cycle before investing'));
    if (has('insider') && st.illegal) return play('insider', null, tx('偷看一下內線消息……應該不會被抓吧？', 'A little insider peek… surely nobody will notice?'));
    if (!st.attack || chance(lv.noise)) return null;

    const opp = opponents(s, p);
    if (!opp.length) return null;
    if (has('poaching')) {
      const rich = opp.slice().sort((a, b) => b.salary - a.salary)[0];
      return play('poaching', { player: rich.id }, tx(rich.name + ' 薪水最高，挖角他的客戶！', rich.name + ' earns the most — poach their clients!'));
    }
    if (has('takeover')) {
      let best = null;
      opp.forEach((o) => o.assets.filter((a) => a.kind !== 'loan').forEach((a) => {
        const pay = E.takeoverPrice(a);
        const roi = (a.cashflow * 12) / Math.max(1, pay);
        if (pay <= spare(p) && roi >= st.dealROI && (!best || roi > best.roi)) best = { o, a, roi };
      }));
      if (best) {
        return play('takeover', { player: best.o.id, asset: best.a.id },
          tx('併購 ' + best.o.name + ' 的「' + best.a.name.zh + '」，報酬率 ' + pct(best.roi), 'Take over ' + best.o.name + '’s "' + best.a.name.en + '" — ' + pct(best.roi) + ' return'));
      }
    }
    const stocks = M.available(s).filter((i) => i.type === 'stock' && !p.holdings[i.id]);
    const target = stocks.map((i) => ({ i, v: oppHoldingOf(s, p, i.id) })).sort((a, b) => b.v - a.v)[0];
    if (has('short_attack') && target && target.v > 0) {
      return play('short_attack', { inst: target.i.id }, tx('對手重押 ' + target.i.name.zh + '，放空狙擊！', 'Opponents are loaded on ' + target.i.name.en + ' — short attack!'));
    }
    if (has('rumor') && st.illegal && target && target.v > 0) {
      return play('rumor', { inst: target.i.id }, tx('放點風聲讓 ' + target.i.name.zh + ' 跌一下……', 'Let’s spread a little rumour about ' + target.i.name.en + '…'));
    }
    if (has('lobbying')) {
      const bySector = {};
      M.available(s).forEach((i) => {
        if (!D.sectors[i.sector]) return;
        bySector[i.sector] = (bySector[i.sector] || 0) + oppHoldingOf(s, p, i.id) - (p.holdings[i.id] || 0) * M.priceTWD(s, i.id);
      });
      const sec = Object.keys(bySector).sort((a, b) => bySector[b] - bySector[a])[0];
      if (sec && bySector[sec] > 0) {
        return play('lobbying', { sector: sec }, tx('遊說政府對「' + D.sectors[sec].zh + '」加關稅，對手重傷', 'Lobby for tariffs on ' + D.sectors[sec].en + ' — opponents get hurt'));
      }
    }
    return null;
  }

  function sellLogic(s, p, st, lv, m) {
    if (m.fails.TRADE || m.sells >= 1) return null;
    const style = p.ai.style;
    for (const id in p.holdings) {
      if (M.isFrozen(s, id)) continue;
      const value = p.holdings[id] * M.priceTWD(s, id);
      const cost = p.cost[id] || value;
      const last = s.market.last[id];
      let reason = null;
      if (style === 'momentum' && last < -0.06) reason = tx(nameOf(id).zh + ' 上季跌 ' + pct(last) + '，停損出場！', nameOf(id).en + ' fell ' + pct(last) + ' — cut the loss!');
      if (style === 'value' && value > cost * 1.6) reason = tx(nameOf(id).zh + ' 已經賺了 ' + pct(value / cost - 1) + '，獲利了結', nameOf(id).en + ' is up ' + pct(value / cost - 1) + ' — take profits');
      if (style === 'speculator' && (value > cost * 1.4 || value < cost * 0.7)) reason = tx(nameOf(id).zh + ' 漲跌夠大了，換下一個題材', nameOf(id).en + ' has moved enough — next hot story');
      if (style === 'macro' && id !== 'TD' && M.byId[id].type !== 'fx' && PHASE_PICKS[s.macro.phase].indexOf(id) < 0) {
        reason = tx('現在是' + D.phases[s.macro.phase].name.zh + '期，' + nameOf(id).zh + ' 不適合了，換掉', 'In ' + D.phases[s.macro.phase].name.en + ', ' + nameOf(id).en + ' no longer fits — rotate out');
      }
      if (reason) {
        m.sells += 1;
        return act({ type: 'TRADE', id, side: 'sell', amount: p.holdings[id] }, reason);
      }
    }
    return null;
  }

  // 每月倒貼現金的資產（升息或景氣差造成）：用略低於市價的價格賣掉止血
  function sellAssets(s, p, m) {
    if (m.fails.SELL_ASSET) return null;
    const turnKey = s.round + '-' + s.current;
    const a = p.assets.find((x) => E.SALE_FEE[x.kind] && x.cashflow < 0 && x.listed !== turnKey
      && E.saleQuote(x, E.assetValue(x) * 0.95).net >= 0);
    if (!a) return null;
    const price = Math.round(E.assetValue(a) * 0.95 / 10000) * 10000;
    return act({ type: 'SELL_ASSET', id: a.id, price },
      tx('「' + a.name.zh + '」每月倒貼現金，打九五折掛牌賣掉', '"' + a.name.en + '" drains cash every month — list it 5% below value'));
  }

  // 保險與勞退自提：一開局就安排好
  function planLogic(s, p, m) {
    if (m.fails.INSURE && m.fails.PENSION_SELF) return null;
    const style = p.ai.style;
    const want = POLICIES[style].slice();
    if (p.children > 0 && want.indexOf('life') < 0 && style !== 'speculator') want.push('life');
    if (!m.fails.INSURE) {
      const k = want.find((x) => !p.policies[x]);
      if (k && p.cash > C.expenses(p)) {
        return act({ type: 'INSURE', kind: k, on: true }, tx('每月花一點保費，避免一次大損失', 'A small monthly premium beats one big loss'));
      }
    }
    // 提早退休（FIRE）：被動收入加上打折後的年金，已經付得起退休後的支出
    if (!m.fails.RETIRE && s.config.retire && !p.retired && s.round >= E.earliestRetire(s)) {
      const q = E.pensionQuote(s, p);
      const after = C.expenses(p) - p.living * 0.2 - p.tax - C.childCost(p) - C.selfPension(p);
      if (C.realPassive(s, p) + q.total >= after * 1.1) {
        return act({ type: 'RETIRE' }, tx('被動收入加年金已經夠生活，提早退休！', 'Passive income plus pension covers my costs — retiring early!'));
      }
    }
    // 穩健、價值型：設定台灣 50 定期定額
    if (!m.fails.DCA_SET && (style === 'conservative' || style === 'value') && !(p.dca || []).length && C.cashflow(s, p) > 10000) {
      return act({ type: 'DCA_SET', id: style === 'conservative' ? 'HDIV' : 'TW50', monthly: 5000 }, tx('每月定期定額 5,000，不用猜時機', 'Invest 5,000 a month automatically — no market timing'));
    }
    // 想要有自己的家：穩健阿姨買套房、價值老爹買三房（頭期款存夠、買了現金流還是正的）
    const homeKind = style === 'conservative' ? 'small' : style === 'value' ? 'family' : null;
    if (!m.fails.BUY_HOME && homeKind && !(p.home > 0)) {
      const q = E.homeQuote(s, p, homeKind);
      if (p.cash > (q.down + q.closing) * 1.5 && C.cashflow(s, p) + q.change > C.expenses(p) * 0.15) {
        return act({ type: 'BUY_HOME', kind: homeKind }, homeKind === 'small'
          ? tx('頭期款存夠了，買間小房子自住', 'Down payment saved — buying a small home')
          : tx('頭期款存夠了，買間三房給家人住', 'Down payment saved — buying a family flat'));
      }
    }
    if (!m.fails.PENSION_SELF && !p.retired && !p.pension.self && (style === 'conservative' || style === 'value' || style === 'macro') && C.cashflow(s, p) > p.salary * 0.1) {
      return act({ type: 'PENSION_SELF', on: true }, tx('勞退自提 6%：省稅又能複利，越早開始越好', 'Add 6% to my pension: tax savings and compounding — the earlier the better'));
    }
    return null;
  }

  // 連鎖事業：景氣好時擴張，到連鎖規模就選好時機上市
  function bizLogic(s, p, st, lv, m) {
    if (m.fails.UPGRADE && m.fails.IPO) return null;
    const style = p.ai.style;
    const phase = s.macro.phase;
    const bold = style === 'momentum' || style === 'speculator' || ((style === 'macro' || style === 'value') && phase === 'expansion');
    for (const a of p.assets) {
      if (!a.chain) continue;
      if (a.stage >= 3 && !m.fails.IPO && (phase === 'expansion' || phase === 'overheat' || s.round >= s.config.rounds - 1)) {
        const q = E.ipoQuote(s, a);
        if (q.net > 0) return act({ type: 'IPO', id: a.id }, tx('本益比 ' + q.pe + ' 倍，趁景氣好上市！', 'P/E of ' + q.pe + ' — list while the market is hot!'));
      }
      const info = E.upgradeInfo(s, a);
      if (!info || m.fails.UPGRADE || !bold || phase === 'recession') continue;
      if (p.cash >= info.cost + C.expenses(p) * st.reserve) {
        return act({ type: 'UPGRADE', id: a.id }, tx('擴張成「' + info.name.zh + '」，成功率 ' + Math.round(info.chance * 100) + '%', 'Expand to "' + info.name.en + '" — ' + Math.round(info.chance * 100) + '% chance'));
      }
    }
    return null;
  }

  // 房價過熱時獲利了結：衝衝哥、狐狸、價值老爹把漲多的房子開高一點賣掉
  function flipLogic(s, p, m) {
    if (m.fails.SELL_ASSET || s.macro.phase !== 'overheat') return null;
    if (['momentum', 'speculator', 'value'].indexOf(p.ai.style) < 0) return null;
    const turnKey = s.round + '-' + s.current;
    const a = p.assets.find((x) => x.kind === 'realestate' && E.assetValue(x) >= x.cost * 1.25 && x.listed !== turnKey);
    if (!a) return null;
    const price = Math.round(E.assetValue(a) * 1.05 / 10000) * 10000;
    if (E.saleQuote(a, price, s.round).net <= 0) return null;
    return act({ type: 'SELL_ASSET', id: a.id, price },
      tx('房市過熱，「' + a.name.zh + '」漲了 ' + pct(E.assetValue(a) / a.cost - 1) + '，開價 ' + fmt(price) + ' 獲利了結', 'The property market is overheating — "' + a.name.en + '" is up ' + pct(E.assetValue(a) / a.cost - 1) + '; listing at ' + fmt(price) + ' to take profit'));
  }

  // 向其他玩家提議買下他們有現金流的房子（每位電腦玩家至少隔 4 輪才提一次）
  const offerMemo = {};
  function offerLogic(s, p, m) {
    if (m.fails.OFFER || ['speculator', 'momentum', 'value'].indexOf(p.ai.style) < 0) return null;
    const last = offerMemo[s.config.seed + p.id];
    if (last != null && s.round - last < 4 && s.round >= last) return null;
    for (const o of opponents(s, p)) {
      const a = o.assets.find((x) => x.kind === 'realestate' && x.cashflow > 0 && !x.underwater);
      if (!a) continue;
      const price = Math.round(((E.assetValue(a) - a.mortgage) * 1.1) / 10000) * 10000;
      if (price < 10000 || price > spare(p)) continue;
      offerMemo[s.config.seed + p.id] = s.round;
      return act({ type: 'OFFER', to: o.id, deal: { give: { cash: price, asset: null, card: null }, get: { cash: 0, asset: a.id, card: null } } },
        tx('想跟 ' + o.name + ' 買下「' + a.name.zh + '」，出價 ' + fmt(price) + '（比淨值多 1 成）', 'Offering ' + o.name + ' ' + fmt(price) + ' for "' + a.name.en + '" (10% over its equity)'));
    }
    return null;
  }

  // 價值老爹用限價單：到價停利、跌 1 成自動撿便宜
  function orderLogic(s, p, m) {
    if (m.fails.ORDER_PLACE || p.ai.style !== 'value' || (p.orders || []).length >= 2) return null;
    const has = (id, side) => (p.orders || []).some((o) => o.id === id && o.side === side);
    for (const id in p.holdings) {
      const i = M.byId[id];
      const units = Math.floor(p.holdings[id]);
      if (!M.byShares(i) || units < 1 || has(id, 'sell')) continue;
      const avg = (p.cost[id] || 0) / p.holdings[id] / M.fxOf(s, i);
      const limit = Math.max(s.market.prices[id] * 1.1, avg * 1.3);
      return act({ type: 'ORDER_PLACE', id, side: 'sell', units, limit },
        tx('「' + i.name.zh + '」掛 ' + limit.toFixed(2) + ' 的限價賣單，到價自動停利', 'Limit sell on "' + i.name.en + '" at ' + limit.toFixed(2) + ' — take profit automatically'));
    }
    if (M.isTradable(s, 'TW50') && !has('TW50', 'buy')) {
      const limit = s.market.prices.TW50 * 0.9;
      const units = Math.floor((spare(p) * 0.3) / (limit * 1.01));
      if (units >= 10) {
        return act({ type: 'ORDER_PLACE', id: 'TW50', side: 'buy', units, limit },
          tx('台灣 50 如果跌 1 成，自動買進 ' + units + ' 股（限價單）', 'If the Taiwan 50 drops 10%, buy ' + units + ' shares automatically (limit order)'));
      }
    }
    return null;
  }

  // 宏觀先生的外幣配置：恐慌或衰退換日圓避險；美台利差大時存美元
  function fxLogic(s, p, m) {
    if (p.ai.style !== 'macro' || m.fails.TRADE || m.fxDone) return null;
    m.fxDone = true;
    const mac = s.macro;
    const want = (mac.phase === 'recession' || mac.vix > 28) && M.isTradable(s, 'JPY') ? 'JPY'
      : mac.usRate - mac.rate > 1.5 && M.isTradable(s, 'USD') ? 'USD' : null;
    for (const id of ['USD', 'JPY', 'EUR', 'CNY']) {
      if (p.holdings[id] && id !== want) {
        return act({ type: 'TRADE', id, side: 'sell', amount: p.holdings[id] }, tx('情勢變了，把「' + nameOf(id).zh + '」換回台幣', 'Conditions changed — converting "' + nameOf(id).en + '" back to TWD'));
      }
    }
    if (want && !p.holdings[want]) {
      const amount = Math.floor(spare(p) * 0.2);
      if (amount >= 50000) {
        return act({ type: 'TRADE', id: want, side: 'buy', amount }, want === 'JPY'
          ? tx('景氣差、市場恐慌，換一些日圓避險（' + fmt(amount) + '）', 'Weak economy and fear — moving ' + fmt(amount) + ' into yen as a safe haven')
          : tx('美國利率比台灣高 ' + (mac.usRate - mac.rate).toFixed(1) + '%，存美元賺利差', 'US rates are ' + (mac.usRate - mac.rate).toFixed(1) + '% above Taiwan’s — holding dollars for the spread'));
      }
    }
    return null;
  }

  function buyTarget(s, p) {
    const style = p.ai.style;
    const avail = M.available(s);
    const ok = (id) => avail.some((i) => i.id === id);
    const held = (id) => (p.holdings[id] || 0) * M.priceTWD(s, id);
    if (style === 'conservative') {
      const list = SAFE_PICKS.filter(ok).map((id) => M.byId[id]).sort((a, b) => M.yieldOf(s, b) - M.yieldOf(s, a));
      const i = list.find((x) => held(x.id) < 2000000) || list[0];
      return i && { id: i.id, reason: tx('穩穩存「' + i.name.zh + '」，年配息 ' + (M.yieldOf(s, i) * 100).toFixed(1) + '%', 'Steady money into "' + i.name.en + '", yielding ' + (M.yieldOf(s, i) * 100).toFixed(1) + '%') };
    }
    if (style === 'value') {
      const list = avail.filter((i) => (i.type === 'stock' || i.type === 'etf') && i.beta <= 1.4 && s.market.last[i.id] < -0.04)
        .sort((a, b) => s.market.last[a.id] - s.market.last[b.id]);
      if (list.length) {
        const i = list[0];
        return { id: i.id, reason: tx(i.name.zh + ' 跌了 ' + pct(s.market.last[i.id]) + '，別人恐懼時我貪婪', i.name.en + ' fell ' + pct(s.market.last[i.id]) + ' — be greedy when others are fearful') };
      }
      return ok('TW50') && { id: 'TW50', reason: tx('沒有便宜貨，就買大盤 ETF 長期持有', 'No bargains — buy the index ETF and hold') };
    }
    if (style === 'momentum') {
      const list = avail.filter((i) => ['stock', 'etf', 'fund'].indexOf(i.type) >= 0 && s.market.last[i.id] > 0.04)
        .sort((a, b) => s.market.last[b.id] - s.market.last[a.id]);
      const i = list[0];
      return i && { id: i.id, reason: tx(i.name.zh + ' 上季漲 ' + pct(s.market.last[i.id]) + '，追進！', i.name.en + ' rose ' + pct(s.market.last[i.id]) + ' — jump on board!') };
    }
    if (style === 'macro') {
      const list = PHASE_PICKS[s.macro.phase].filter(ok).sort((a, b) => held(a) - held(b));
      const id = list[0];
      return id && { id, reason: tx('景氣' + D.phases[s.macro.phase].name.zh + '，配置「' + nameOf(id).zh + '」', D.phases[s.macro.phase].name.en + ' phase — allocate to "' + nameOf(id).en + '"') };
    }
    const list = SPEC_PICKS.filter(ok);
    const id = list.length && pick(list);
    return id && { id, reason: tx('賭一把「' + nameOf(id).zh + '」！', 'Rolling the dice on "' + nameOf(id).en + '"!') };
  }

  function buyLogic(s, p, st, lv, m) {
    if (m.fails.TRADE || m.buys >= 1) return null;
    const amount = Math.floor(spare(p) * st.invest);
    if (amount < 30000) return null;
    let target = buyTarget(s, p);
    if (chance(lv.noise)) {
      const any = M.available(s).filter((i) => i.type !== 'deposit');
      const i = pick(any);
      target = { id: i.id, reason: tx('隨便買點「' + i.name.zh + '」好了', 'Eh, let’s buy some "' + i.name.en + '"') };
    }
    if (!target) return null;
    m.buys += 1;
    const inst = M.byId[target.id];
    const marginOK = M.LEVELS[s.config.difficulty] >= 1 && (inst.type === 'stock' || inst.type === 'etf');
    if (marginOK && (p.ai.style === 'momentum' || p.ai.style === 'speculator') && chance(0.5)) {
      return act({ type: 'TRADE', id: target.id, side: 'margin', amount: Math.floor(amount / 2) },
        tx(target.reason.zh + '（融資加碼，賺賠都放大 2.5 倍）', target.reason.en + ' (on margin: 2.5× gains and losses)'));
    }
    return act({ type: 'TRADE', id: target.id, side: 'buy', amount }, target.reason);
  }

  // ── 處理卡片 ──
  function dealROI(card, paid) { return (card.cashflow * 12) / Math.max(1, paid); }

  function resolveDeal(s, p, st, lv, m) {
    const pd = s.pending;
    // 報酬高得不合理的機會：看得出來就是詐騙
    const scam = pd.cards.map((id) => E.getCard(pd.deck, id)).find((c) => c.scam);
    if (scam && pd.cards.length === 1 && chance(lv.scam)) {
      return act({ type: 'CHOOSE', choice: 'pass' }, tx('「保證」高報酬？年報酬 ' + pct(dealROI(scam, scam.down)) + ' 太不合理，八成是詐騙', '"Guaranteed" ' + pct(dealROI(scam, scam.down)) + ' a year? Too good to be true — likely a scam'));
    }
    const cards = pd.cards.map((id, i) => ({ card: E.getCard(pd.deck, id), i }))
      .filter((x) => !(x.card.scam && pd.cards.length > 1 && chance(lv.scam)))
      .sort((a, b) => dealROI(b.card, b.card.down) - dealROI(a.card, a.card.down));
    if (!cards.length) return act({ type: 'CHOOSE', choice: 'pass' }, tx('報酬高得不合理，不碰', 'Too good to be true — pass'));
    const best = cards[0];
    const roi = dealROI(best.card, best.card.down);
    const isBiz = best.card.kind === 'business';
    const risky = isBiz && (best.card.risk || 1) > 1;
    if (!chance(lv.noise)) {
      if (p.ai.style === 'conservative' && risky) {
        return act({ type: 'CHOOSE', choice: 'pass' }, tx('這種生意太看景氣，倒閉風險高，不碰', 'Too cyclical — high risk of failure, I’ll pass'));
      }
      if (p.ai.style === 'macro' && isBiz && (s.macro.phase === 'overheat' || s.macro.phase === 'recession')) {
        return act({ type: 'CHOOSE', choice: 'pass' }, tx('景氣' + D.phases[s.macro.phase].name.zh + '，開店容易虧，先不買', D.phases[s.macro.phase].name.en + ' phase — a bad time to open a business'));
      }
    }
    const want = chance(lv.noise) ? chance(0.5) : roi >= st.dealROI;
    if (!want || m.fails.CHOOSE) {
      return act({ type: 'CHOOSE', choice: 'pass' }, tx('報酬率 ' + pct(roi) + '，不夠好，不買', pct(roi) + ' return isn’t good enough — pass'));
    }
    if (p.cash >= best.card.down) {
      return act({ type: 'CHOOSE', choice: 'buy', index: best.i }, tx('年報酬率 ' + pct(roi) + '，買下來！', pct(roi) + ' annual return — buying it!'));
    }
    // 現金不夠：先賣投資（穩健型、價值型），或向銀行借款（月付要比新資產的現金流小）
    if (!m.fails.TRADE && (p.ai.style === 'conservative' || p.ai.style === 'value')) {
      const id = Object.keys(p.holdings).find((x) => !M.isFrozen(s, x));
      if (id) return act({ type: 'TRADE', id, side: 'sell', amount: p.holdings[id] }, tx('賣掉「' + nameOf(id).zh + '」湊頭期款', 'Sell "' + nameOf(id).en + '" to fund the down payment'));
    }
    const need = best.card.down - p.cash;
    const units = Math.ceil(need / E.LOAN_UNIT);
    // 銀行規定借款後現金流不能為負：先算銀行最多肯借幾筆，借不夠就別借
    const bankMax = Math.floor(C.cashflow(s, p) / (E.LOAN_UNIT * C.loanRate(p)));
    if (st.loan > 0 && !m.fails.LOAN && units <= bankMax && units * E.LOAN_UNIT * C.loanRate(p) <= best.card.cashflow * st.loan) {
      return act({ type: 'LOAN', units }, tx('借錢買！報酬率 ' + pct(roi) + ' 比銀行利率 12% 高（槓桿）', 'Borrow to buy! ' + pct(roi) + ' beats the 12% bank rate (leverage)'));
    }
    // 至少有一位對手出得起起標價，拍賣才有意義
    const canAuction = pd.deck === 'big' && opponents(s, p).some((o) => o.cash >= best.card.down * 0.6) && chance(0.5);
    if (canAuction) return act({ type: 'CHOOSE', choice: 'auction' }, tx('買不起，拿去拍賣看看', 'Can’t afford it — let’s auction it'));
    return act({ type: 'CHOOSE', choice: 'pass' }, tx('現金不夠，只好放棄', 'Not enough cash — pass'));
  }

  function resolveAuction(s, p, st, lv) {
    const pd = s.pending;
    const card = E.getCard(pd.deck, pd.card);
    const min = E.minBid(pd);
    const [lo, hi] = lv.bid;
    const maxBid = Math.min((card.cashflow * 12) / st.auctionROI * (lo + Math.random() * (hi - lo)), p.cash - reserveOf(p) * 0.5);
    if (min <= maxBid) {
      return act({ type: 'CHOOSE', choice: 'bid', amount: min }, tx('出價 ' + fmt(min) + '，報酬率還有 ' + pct(dealROI(card, min)), 'Bid ' + fmt(min) + ' — still a ' + pct(dealROI(card, min)) + ' return'));
    }
    return act({ type: 'CHOOSE', choice: 'fold' }, tx('超過我願意付的價格了，放棄（小心贏家詛咒）', 'Above my limit — I’m out (beware the winner’s curse)'));
  }

  function itemValue(giver, items) {
    let v = items.cash || 0;
    if (items.asset) {
      const a = giver.assets.find((x) => x.id === items.asset);
      if (a) v += a.cost - a.mortgage + a.cashflow * 12;
    }
    if (items.card) v += 40000;
    return v;
  }

  function resolveOffer(s, p, st, lv) {
    const pd = s.pending;
    const from = s.players[pd.from];
    const d = pd.deal;
    if (d.loan) {
      const l = d.loan;
      const payment = E.loanPayment(l.amount, l.months, l.rate);
      if (l.dir === 'lend') {
        // 對方借錢給我
        const ok = l.rate <= C.loanRate(p) && C.cashflow(s, p) - payment >= 0;
        return act({ type: 'CHOOSE', choice: ok ? 'accept' : 'decline' }, ok
          ? tx('利率 ' + (l.rate * 100).toFixed(1) + '% 比銀行便宜，借！', (l.rate * 100).toFixed(1) + '% is cheaper than the bank — I’ll borrow!')
          : tx('每月還款太重，或利率比銀行還貴，不借', 'Payments too heavy or pricier than the bank — no thanks'));
      }
      // 對方向我借錢：先做信用審核
      const credit = C.cashflow(s, from) - payment;
      const ok = l.rate >= 0.01 && p.cash - l.amount >= reserveOf(p) && credit >= 0;
      return act({ type: 'CHOOSE', choice: ok ? 'accept' : 'decline' }, ok
        ? tx('信用審核通過，借你，每月收利息', 'Credit check passed — I’ll lend and collect interest')
        : credit < 0
          ? tx('你每月現金流不夠還款，借你風險太高（違約風險）', 'Your cashflow can’t cover the payments — too much default risk')
          : tx('利率太低或我需要保留現金，不借', 'Rate too low or I need my cash — no loan'));
    }
    const gain = itemValue(from, d.give || {}) - itemValue(p, d.get || {});
    const need = lv === LEVELS.hard ? itemValue(p, d.get || {}) * 0.05 : lv === LEVELS.easy ? -itemValue(p, d.get || {}) * 0.2 : 0;
    const ok = gain >= need && !(d.get && d.get.cash > p.cash);
    return act({ type: 'CHOOSE', choice: ok ? 'accept' : 'decline' }, ok
      ? tx('算了一下，這筆交易對我有利，成交', 'By my numbers this deal favours me — deal')
      : tx('這筆交易不划算，拒絕', 'Not worth it — declined'));
  }

  function resolve(s, p, st, lv) {
    const pd = s.pending;
    const m = mem(s);
    switch (pd.type) {
      case 'deal': return resolveDeal(s, p, st, lv, m);
      case 'auction': return resolveAuction(s, p, st, lv);
      case 'offer': return resolveOffer(s, p, st, lv);
      case 'doodad': {
        if (pd.insured) return act({ type: 'CHOOSE', choice: 'ok' }, tx('還好有保險！', 'Glad I had insurance!'));
        const card = E.getCard('doodad', pd.card);
        const cost = E.doodadCost(p, card);
        // 衝動型：沒有分期又現金不夠，就刷卡只繳最低
        if (!card.installment && st.installment && p.cash < cost.amount && cost.amount >= 3000) {
          return act({ type: 'CHOOSE', choice: 'card' }, tx('先刷卡，只繳最低應繳就好', 'Put it on the card and pay the minimum'));
        }
        const inst = card.installment && (st.installment || p.cash < cost.amount);
        return act({ type: 'CHOOSE', choice: inst ? 'installment' : 'pay' }, inst
          ? tx('分期付款，每月只要 ' + fmt(cost.payment) + '！', 'Installments — only ' + fmt(cost.payment) + ' a month!')
          : tx('一次付清，不要背負債', 'Pay in full — no new debt'));
      }
      case 'quiz': {
        const q = E.getCard('quiz', pd.q);
        const right = chance(LEVELS[p.ai.level].quiz);
        const wrong = [0, 1, 2].filter((x) => x !== q.answer);
        return act({ type: 'CHOOSE', choice: 'answer', index: right ? q.answer : pick(wrong) });
      }
      case 'cb': {
        const mac = s.macro;
        const diff = M.cbTarget(mac) - mac.rate + (Math.random() - 0.5) * 2 * lv.cb;
        const guess = diff >= 0.2 ? 'hike' : diff <= -0.2 ? 'cut' : 'hold';
        const word = { hike: tx('升息', 'a hike'), hold: tx('不變', 'a hold'), cut: tx('降息', 'a cut') }[guess];
        return act({ type: 'CHOOSE', choice: guess }, tx('通膨 ' + mac.cpi.toFixed(1) + '%、GDP ' + mac.gdp.toFixed(1) + '%，我猜' + word.zh, 'Inflation ' + mac.cpi.toFixed(1) + '%, GDP ' + mac.gdp.toFixed(1) + '% — I guess ' + word.en));
      }
      default:
        return act({ type: 'CHOOSE', choice: 'ok' });
    }
  }

  function decide(s) {
    if (s.phase === 'gameover') return null;
    const p = actorOf(s);
    if (!p || !p.ai) return null;
    const st = STYLES[p.ai.style];
    const lv = LEVELS[p.ai.level];
    if (s.phase === 'resolve') return resolve(s, p, st, lv);
    const m = mem(s);
    return repayLoans(s, p, st, m)
      || payoffDebts(s, p, st, m)
      || planLogic(s, p, m)
      || (s.phase === 'action' && bizLogic(s, p, st, lv, m))
      || (s.phase === 'roll' && playCards(s, p, st, lv, m))
      || sellAssets(s, p, m)
      || (s.phase === 'action' && flipLogic(s, p, m))
      || sellLogic(s, p, st, lv, m)
      || (s.phase === 'action' && fxLogic(s, p, m))
      || (s.phase === 'action' && orderLogic(s, p, m))
      || (s.phase === 'action' && offerLogic(s, p, m))
      || (s.phase === 'action' && buyLogic(s, p, st, lv, m))
      || act({ type: s.phase === 'roll' ? 'ROLL' : 'END_TURN' });
  }

  // 動作失敗時記下來，下一次就不再嘗試同一類動作
  function noteFail(s, action) {
    mem(s).fails[action.type] = true;
  }

  MT.AI = { decide, noteFail, actorOf, STYLES, LEVELS };
})();

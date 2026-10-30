// 錢潮 MoneyTide © 2026 麥麥的遊戲工廠 保留所有權利 All rights reserved. 詳見 LICENSE
// M3：策略手牌與地緣政治卡。
// 策略卡 kind：attack 攻擊 / defense 防禦 / intel 情報 / special 特殊
//   target：出牌時要選的目標（stock 一檔股票、sector 一個產業、player 一位玩家、asset 對手的一項資產）
//   count：牌庫中的張數；level：最低開放難度（攻擊卡在初級關閉）
//   auto：不用主動打出，條件符合時自動使用
window.MT = window.MT || {};
MT.DATA = MT.DATA || {};

MT.DATA.strategy = [
  // ── 攻擊 ──
  { id: 'short_attack', kind: 'attack', icon: '🎯', target: 'stock', count: 2, level: 'medium',
    name: { zh: '放空狙擊', en: 'Short Attack' },
    desc: { zh: '指定一檔股票，立刻 −15%。你放空了 50 萬元，跌多少就賺多少。', en: 'Pick a stock: it drops 15% now. You shorted 500k, so you profit from the fall.' },
    lesson: { zh: '[[short_selling]]讓人在下跌時也能賺錢；但現實中如果股價反而上漲，虧損沒有上限。', en: '[[short_selling]] profits from falls — but in reality, if the price rises instead, losses are unlimited.' } },
  { id: 'rumor', kind: 'attack', icon: '🗣️', target: 'stock', count: 2, level: 'medium', illegal: true, risk: 0.3, fine: 100000,
    name: { zh: '散布謠言', en: 'Spread a Rumor' },
    desc: { zh: '指定一檔股票，立刻 −10%。但有 30% 機率被金管會查到：罰款 10 萬元，股價恢復。', en: 'Pick a stock: it drops 10%. 30% chance regulators catch you: 100k fine and the price recovers.' },
    lesson: { zh: '散布不實消息影響股價是[[market_manipulation]]，在台灣可處 3 年以上有期徒刑。', en: 'Spreading false news to move prices is [[market_manipulation]] — a serious crime in Taiwan and most countries.' } },
  { id: 'takeover', kind: 'attack', icon: '🦈', target: 'asset', count: 1, level: 'medium',
    name: { zh: '惡意併購', en: 'Hostile Takeover' },
    desc: { zh: '以「總價 × 1.2」強制買下對手的一項房地產或事業（你承接貸款，並把差額付給對方）。', en: 'Force-buy an opponent’s property or business at 1.2× its price (you take over the loan and pay them the difference).' },
    lesson: { zh: '[[merger]]常用「溢價」說服股東賣出；被收購的一方雖然拿到錢，卻失去了未來的現金流。', en: 'A [[merger]] often pays a premium; the seller gets cash but loses future cashflow.' } },
  { id: 'lobbying', kind: 'attack', icon: '🏛️', target: 'sector', count: 2, level: 'medium',
    name: { zh: '貿易戰遊說', en: 'Trade-War Lobbying' },
    desc: { zh: '遊說政府對某個產業加徵關稅：該產業立刻 −10%，物價小幅上升。', en: 'Lobby for tariffs on an industry: it falls 10% at once and prices tick up.' },
    lesson: { zh: '[[tariff]]保護了部分產業，但成本常轉嫁給消費者，造成通膨。', en: '[[tariff|Tariffs]] protect some industries, but costs pass to consumers as inflation.' } },
  { id: 'poaching', kind: 'attack', icon: '🧲', target: 'player', count: 2, level: 'medium',
    name: { zh: '挖角', en: 'Poaching' },
    desc: { zh: '挖走對手的重要客戶：對手下一次發薪日的薪資減半。', en: 'Steal an opponent’s key client: their next payday salary is halved.' },
    lesson: { zh: '只靠[[active_income]]的人，收入很容易受別人影響；[[passive_income]]比較不怕被挖角。', en: 'People living on [[active_income]] are vulnerable; [[passive_income]] is harder to poach.' } },

  // ── 情報 ──
  { id: 'insider', kind: 'intel', icon: '🕵️', target: null, count: 2, level: 'easy', illegal: true, risk: 0.25, fine: 50000,
    name: { zh: '內線消息', en: 'Insider Tip' },
    desc: { zh: '偷看下一季的世界新聞。但有 25% 機率被抓：罰款 5 萬元。', en: 'Peek at next quarter’s world news. 25% chance you are caught: 50k fine.' },
    lesson: { zh: '利用未公開的重大消息買賣股票是[[insider_trading]]，在台灣是重罪。', en: 'Trading on undisclosed material news is [[insider_trading]] — a serious crime.' } },
  { id: 'research', kind: 'intel', icon: '📑', target: null, count: 3, level: 'easy',
    name: { zh: '經濟研究報告', en: 'Economic Research' },
    desc: { zh: '研究總體經濟數據，預先知道下一季的景氣階段。', en: 'Study the data and learn next quarter’s business-cycle phase in advance.' },
    lesson: { zh: '合法的研究分析是投資的基本功：看懂[[business_cycle]]，就知道不同資產適合的時機。', en: 'Legal research is the investor’s foundation: read the [[business_cycle]] to time different assets.' } },

  // ── 防禦 ──
  { id: 'hedge', kind: 'defense', icon: '🛡️', target: null, count: 3, level: 'easy',
    name: { zh: '避險部位', en: 'Hedge Position' },
    desc: { zh: '本季結算時，你的投資部位虧損減半。', en: 'At this quarter’s settlement, your portfolio losses are halved.' },
    lesson: { zh: '[[hedging]]就像幫投資買保險：要付出成本，但能在下跌時保護你。', en: '[[hedging]] is insurance for investments: it costs something, but protects you in a fall.' } },
  { id: 'insurance', kind: 'defense', icon: '☂️', target: null, count: 4, level: 'easy', auto: true,
    name: { zh: '保險', en: 'Insurance' },
    desc: { zh: '自動抵銷下一次「意外」支出（維修、醫療、家電故障、住院）。', en: 'Automatically covers your next accident (repairs, medical, broken appliance, hospital).' },
    lesson: { zh: '[[insurance]]把無法預測的大損失，換成可以預測的小成本。', en: '[[insurance]] swaps an unpredictable big loss for a predictable small cost.' } },
  { id: 'legal', kind: 'defense', icon: '⚖️', target: null, count: 2, level: 'medium', auto: true,
    name: { zh: '法務團隊', en: 'Legal Team' },
    desc: { zh: '自動擋下下一張對你使用的攻擊卡。', en: 'Automatically blocks the next attack card played on you.' },
    lesson: { zh: '企業會花錢聘請法務，預防風險比事後補救便宜。', en: 'Companies pay for lawyers because preventing risk is cheaper than repairing damage.' } },

  // ── 特殊 ──
  { id: 'bailout', kind: 'special', icon: '🛟', target: null, count: 1, level: 'easy', auto: true, mode: 'bankrupt',
    name: { zh: '政府紓困', en: 'Government Bailout' },
    desc: { zh: '快要破產時自動使用：銀行免除部分借款讓你活下來，但之後每月稅金增加薪資的 10%。', en: 'Used automatically when you would go bankrupt: part of your bank loan is forgiven, but your monthly tax rises by 10% of salary.' },
    lesson: { zh: '紓困能救急，但也可能讓人更敢冒險，這叫[[moral_hazard]]。', en: 'Bailouts save the day but can encourage more risk-taking — [[moral_hazard]].' } },
];

// 可被「貿易戰遊說」指定的產業
MT.DATA.sectors = {
  tech: { zh: '科技', en: 'Tech' },
  finance: { zh: '金融', en: 'Finance' },
  energy: { zh: '能源', en: 'Energy' },
  consumer: { zh: '民生消費', en: 'Consumer' },
  shipping: { zh: '航運', en: 'Shipping' },
  biotech: { zh: '生技', en: 'Biotech' },
  defense: { zh: '國防', en: 'Defence' },
  utility: { zh: '公用事業', en: 'Utilities' },
  ev: { zh: '電動車', en: 'EVs' },
};

MT.DATA.cards = MT.DATA.cards || {};

// 🌍 地緣政治卡（踩到「地緣政治」格時抽，立即影響市場）
// effect.freeze：被凍結的商品與輪數（制裁期間無法賣出）
MT.DATA.cards.geo = [
  { id: 'g_1990', real: true, year: 1990, icon: '🏜️', name: { zh: '波斯灣戰爭：伊拉克入侵科威特', en: 'Gulf War: Iraq Invades Kuwait' },
    effect: { macro: { oil: 0.5, vix: 12, cpi: 0.8 }, shocks: { 'sector:energy': 0.15, DEF: 0.12, GOLD: 0.05, all: -0.06 } },
    trivia: { zh: '1990 年 8 月伊拉克入侵科威特，國際油價在幾個月內翻倍，全球股市下跌。', en: 'Iraq invaded Kuwait in August 1990; oil prices doubled within months and global stocks fell.' },
    chain: [
      { zh: '產油區爆發戰爭 → 原油供應中斷 → 油價大漲', en: 'War in an oil region → supply disrupted → oil soars', p: 'p_supply' },
      { zh: '油價推升物價 → 通膨壓力', en: 'Oil lifts prices → inflation pressure', p: 'p_oil' },
      { zh: '恐慌 → 黃金、國防股上漲', en: 'Fear → gold and defence rise', p: 'p_safe' },
    ] },
  { id: 'g_2001', real: true, year: 2001, icon: '🗽', name: { zh: '九一一恐怖攻擊', en: 'September 11 Attacks' },
    effect: { macro: { vix: 18, gdp: -0.8, usRate: -0.5 }, shocks: { all: -0.1, DEF: 0.15, GOLD: 0.05, SHIP: -0.08 } },
    trivia: { zh: '攻擊發生後，紐約證交所休市 4 個交易日。重新開市後一週內，美國道瓊指數下跌約 14%。', en: 'The NYSE closed for four trading days. In the week after reopening, the Dow fell about 14%.' },
    chain: [
      { zh: '突發衝擊 → 恐慌指數飆升', en: 'Sudden shock → fear index spikes', p: 'p_safe' },
      { zh: '央行降息穩定市場', en: 'Rate cuts to calm markets', p: 'p_accel' },
      { zh: '各國增加國防支出 → 國防股上漲', en: 'Defence spending rises → defence stocks gain' },
    ] },
  { id: 'g_2014', real: true, year: 2014, icon: '🗺️', name: { zh: '克里米亞危機與經濟制裁', en: 'Crimea Crisis and Sanctions' },
    effect: { macro: { vix: 6, oil: 0.05 }, shocks: { EMKT: -0.1, DEF: 0.06, GOLD: 0.03 }, freeze: { EMKT: 2 } },
    trivia: { zh: '俄羅斯併吞克里米亞後，歐美對俄羅斯實施[[sanctions]]，盧布大幅貶值，投資俄羅斯的資金一度難以撤出。', en: 'After Russia annexed Crimea, the West imposed [[sanctions]]; the rouble plunged and money invested in Russia became hard to pull out.' },
    chain: [
      { zh: '經濟制裁 → 相關資產被凍結、難以賣出', en: 'Sanctions → related assets frozen and hard to sell', p: 'p_risk_return' },
      { zh: '新興市場風險升高 → 資金撤出', en: 'Emerging-market risk rises → money leaves', p: 'p_capital_flow' },
    ] },
  { id: 'g_2016', real: true, year: 2016, icon: '🇬🇧', name: { zh: '英國脫歐公投', en: 'Brexit Referendum' },
    effect: { macro: { vix: 8, fx: 0.01 }, shocks: { all: -0.04, GOLD: 0.06, BOND: 0.03, BANK: -0.05 } },
    trivia: { zh: '2016 年 6 月英國公投決定脫離歐盟，結果出乎市場預期，英鎊單日暴跌超過 8%。', en: 'In June 2016 the UK unexpectedly voted to leave the EU; the pound fell more than 8% in a day.' },
    chain: [
      { zh: '出乎意料的投票結果 → 不確定性大增', en: 'Unexpected result → uncertainty surges', p: 'p_safe' },
      { zh: '資金逃向黃金與公債', en: 'Money flees to gold and bonds', p: 'p_safe' },
    ] },
  { id: 'g_2019', real: true, year: 2019, icon: '🔥', name: { zh: '沙烏地油田遭無人機攻擊', en: 'Drone Strike on Saudi Oil Facilities' },
    effect: { macro: { oil: 0.15, vix: 4 }, shocks: { 'sector:energy': 0.08, SHIP: -0.03 } },
    trivia: { zh: '2019 年 9 月沙烏地阿拉伯的煉油設施遭攻擊，一度讓全球約 5% 的石油供應中斷，油價單日大漲約 15%。', en: 'In September 2019 an attack on Saudi facilities briefly cut about 5% of world oil supply; prices jumped about 15% in a day.' },
    chain: [
      { zh: '供應突然減少 → 油價跳漲', en: 'Sudden supply loss → oil jumps', p: 'p_supply' },
      { zh: '產能修復後，油價很快回落', en: 'Prices fell back once output was restored', p: 'p_forward' },
    ] },
  { id: 'g_2021', real: true, year: 2021, icon: '🚢', name: { zh: '長賜輪卡住蘇伊士運河', en: 'Ever Given Blocks the Suez Canal' },
    effect: { macro: { oil: 0.04, cpi: 0.2 }, shocks: { SHIP: 0.15, FOOD: -0.02 } },
    trivia: { zh: '2021 年 3 月貨櫃輪「長賜號」在蘇伊士運河擱淺 6 天，數百艘船被堵住，凸顯全球供應鏈的脆弱。', en: 'In March 2021 the Ever Given blocked the Suez Canal for six days, stranding hundreds of ships and exposing fragile supply chains.' },
    chain: [
      { zh: '重要航道堵塞 → 運力變少 → 運費上漲', en: 'Key lane blocked → less capacity → freight rates rise', p: 'p_supply' },
      { zh: '航運股受惠，進口商品成本上升', en: 'Shipping gains; import costs rise' },
    ] },
  { id: 'g_2022', real: true, year: 2022, icon: '🔒', name: { zh: '先進晶片出口管制', en: 'Advanced Chip Export Controls' },
    effect: { macro: { vix: 4 }, shocks: { CHIP: -0.12, 'sector:tech': -0.04, EMKT: -0.04 } },
    trivia: { zh: '2022 年 10 月美國限制先進晶片與製造設備出口到中國，半導體產業股價大幅波動，全球供應鏈加速重組。', en: 'In October 2022 the US restricted advanced chips and tools to China; chip stocks swung and supply chains reorganised.' },
    chain: [
      { zh: '[[geopolitics|地緣]]競爭 → 技術出口限制', en: '[[geopolitics|Geopolitical]] rivalry → tech export limits' },
      { zh: '晶片公司失去部分市場 → 股價下跌', en: 'Chipmakers lose part of a market → shares fall' },
    ] },
  { id: 'g_opec', icon: '🛢️', name: { zh: '產油國聯盟宣布大減產', en: 'Oil Cartel Announces Deep Cuts' },
    effect: { macro: { oil: 0.2, cpi: 0.5 }, shocks: { 'sector:energy': 0.1, SHIP: -0.05, CAR: 0.04 } },
    trivia: { zh: '（虛構事件）產油國聯手減少產量來推高油價——這是用「控制供給」影響價格。', en: '(Fictional) Producers cut output together to lift prices — controlling supply to move price.' },
    chain: [
      { zh: '供給減少 → 油價上漲', en: 'Less supply → higher oil', p: 'p_supply' },
      { zh: '油價推升通膨 → 央行升息壓力增加', en: 'Oil lifts inflation → pressure to hike', p: 'p_oil' },
    ] },
  { id: 'g_sanction', icon: '⛔', name: { zh: '北域聯邦制裁南洋共和國', en: 'Northland Sanctions Southsea' },
    effect: { macro: { vix: 8, fx: 0.01 }, shocks: { EMKT: -0.12, GOLD: 0.04, DEF: 0.05 }, freeze: { EMKT: 2 } },
    trivia: { zh: '（虛構事件）制裁讓投資南洋的資金被凍結 2 輪，期間無法賣出新興市場 ETF。', en: '(Fictional) Sanctions freeze money invested in Southsea for 2 rounds — the EM ETF can’t be sold.' },
    chain: [
      { zh: '[[sanctions]] → 資金被凍結', en: '[[sanctions]] → money frozen', p: 'p_risk_return' },
      { zh: '[[liquidity]]消失：想賣也賣不掉', en: '[[liquidity]] vanishes: you can’t sell even if you want to' },
    ] },
  { id: 'g_rare', icon: '🪨', name: { zh: '南洋共和國限制稀土出口', en: 'Southsea Restricts Rare-Earth Exports' },
    effect: { macro: { cpi: 0.3, vix: 5 }, shocks: { 'sector:tech': -0.08, 'sector:ev': -0.12, DEF: -0.03 } },
    trivia: { zh: '（虛構事件）稀土是製造晶片、電動車馬達和飛彈的關鍵材料，供應集中在少數國家就是風險。', en: '(Fictional) Rare earths are key to chips, EV motors and missiles; concentrated supply is a risk.' },
    chain: [
      { zh: '關鍵原料被限制 → 科技與電動車成本上升', en: 'Key materials restricted → tech and EV costs rise', p: 'p_supply' },
      { zh: '供應鏈集中＝沒有分散風險', en: 'Concentrated supply = no diversification', p: 'p_risk_return' },
    ] },
  { id: 'g_summit', icon: '🤝', name: { zh: '國際和解高峰會', en: 'International Peace Summit' },
    effect: { macro: { vix: -8, oil: -0.08 }, shocks: { all: 0.04, EMKT: 0.06, DEF: -0.06, GOLD: -0.03 } },
    trivia: { zh: '（虛構事件）緊張局勢緩和，資金離開避險資產、回到股市。', en: '(Fictional) Tensions ease and money leaves safe havens for stocks.' },
    chain: [
      { zh: '風險下降 → 恐慌指數回落', en: 'Less risk → fear eases', p: 'p_safe' },
      { zh: '黃金、國防股回落；股市上漲', en: 'Gold and defence fall; stocks rise' },
    ] },
  { id: 'g_election', icon: '🗳️', name: { zh: '北域聯邦大選：主張保護主義的候選人勝選', en: 'Northland Election: Protectionist Wins' },
    effect: { macro: { vix: 5, fx: 0.015 }, shocks: { CHIP: -0.06, SHIP: -0.05, EMKT: -0.05, DEF: 0.04 } },
    trivia: { zh: '（虛構事件）大國的選舉結果會改變貿易政策，市場常在選前就開始緊張。', en: '(Fictional) A big country’s election can change trade policy; markets often get nervous beforehand.' },
    chain: [
      { zh: '預期[[tariff]]增加 → 出口與航運受壓', en: 'More [[tariff|tariffs]] expected → exporters and shipping suffer', p: 'p_fx_trade' },
      { zh: '不確定性 → 資金保守', en: 'Uncertainty → cautious money', p: 'p_safe' },
    ] },
  { id: 'g_1979', real: true, year: 1979, icon: '🕌', name: { zh: '伊朗革命與第二次石油危機', en: 'Iranian Revolution and the Second Oil Crisis' },
    effect: { macro: { oil: 0.4, cpi: 1.5, vix: 8 }, shocks: { 'sector:energy': 0.12, CAR: -0.08, SHIP: -0.06 } },
    trivia: { zh: '1979 年伊朗革命讓石油產量大減，油價在約一年內翻倍，再次引發全球通膨。美國聯準會隨後大幅升息對抗通膨。', en: 'The 1979 Iranian Revolution cut oil output and prices roughly doubled within a year, reigniting inflation. The Fed then raised rates sharply to fight it.' },
    chain: [
      { zh: '產油國動盪 → 供應減少 → 油價翻倍', en: 'Turmoil in an oil producer → less supply → oil doubles', p: 'p_supply' },
      { zh: '油價推升物價 → 央行被迫升息', en: 'Oil lifts prices → forced rate hikes', p: 'p_oil' },
    ] },
  { id: 'g_2011', real: true, year: 2011, icon: '🌊', name: { zh: '日本 311 大地震', en: 'Japan’s 3/11 Earthquake' },
    effect: { macro: { vix: 10, gdp: -0.5 }, shocks: { CHIP: -0.06, CAR: -0.08, GOLD: 0.03 } },
    trivia: { zh: '2011 年 3 月 11 日東日本大地震引發海嘯與福島核災，許多電子與汽車零件工廠停工，全球[[supply_chain]]受到衝擊。', en: 'The 11 March 2011 earthquake triggered a tsunami and the Fukushima disaster; parts factories shut and global [[supply_chain|supply chains]] were hit.' },
    chain: [
      { zh: '關鍵零件工廠停工 → 供應鏈中斷', en: 'Key parts plants stop → supply chains break', p: 'p_supply' },
      { zh: '恐慌 → 資金轉向避險資產', en: 'Fear → money moves to safe havens', p: 'p_safe' },
    ] },
  { id: 'g_hormuz', icon: '🚢', name: { zh: '荷莫茲海峽緊張升溫', en: 'Tensions Flare in the Strait of Hormuz' },
    effect: { macro: { oil: 0.18, vix: 9, cpi: 0.4 }, shocks: { 'sector:energy': 0.1, SHIP: -0.08, GOLD: 0.04, DEF: 0.05 } },
    trivia: { zh: '（虛構情境）全球約五分之一的石油經過荷莫茲海峽，這個[[chokepoint]]一有風吹草動，油價就跳升。', en: '(Fictional scenario) About a fifth of the world’s oil passes Hormuz; any trouble at this [[chokepoint]] spikes oil.' },
    chain: [
      { zh: '航道風險 → 油輪保險費上升 → 油價跳升', en: 'Shipping-lane risk → tanker insurance up → oil jumps', p: 'p_supply' },
      { zh: '油價上漲 → 通膨壓力', en: 'Pricier oil → inflation pressure', p: 'p_oil' },
    ] },
];

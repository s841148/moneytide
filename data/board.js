// 錢潮 MoneyTide © 2026 麥麥的遊戲工廠 保留所有權利 All rights reserved. 詳見 LICENSE
// 內圈「老鼠賽跑」棋盤：24 格，第 0 格是起點（發薪日）。
// 說明文字中的 [[名詞id]] 會變成可點擊的名詞解釋。
window.MT = window.MT || {};
MT.DATA = MT.DATA || {};

MT.DATA.tileTypes = {
  payday: {
    icon: '💰', color: 'gold',
    name: { zh: '發薪日', en: 'Payday' },
    desc: { zh: '經過或停在這裡，就領到半年（6 個月）的[[cashflow]]（收入 − 支出）。同時各項[[liability]]會減少。', en: 'Pass or land here to collect 6 months of [[cashflow]] (income − expenses). Your [[liability|debts]] also shrink.' },
  },
  small: {
    icon: '🏠', color: 'green',
    name: { zh: '小型機會', en: 'Small Deal' },
    desc: { zh: '抽一張小型投資機會：小套房、小生意。買下會產生[[passive_income]]的[[asset]]，是脫離[[rat_race]]的關鍵。', en: 'Draw a small investment: a studio flat or small business. Buying an [[asset]] that produces [[passive_income]] is how you escape the [[rat_race]].' },
  },
  big: {
    icon: '🏢', color: 'teal',
    name: { zh: '大型機會', en: 'Big Deal' },
    desc: { zh: '抽一張大型投資機會，金額大、現金流也大，通常需要[[down_payment]]與[[mortgage]]。', en: 'Draw a big investment with large cashflow. Usually needs a [[down_payment]] and a [[mortgage]].' },
  },
  market: {
    icon: '📰', color: 'blue',
    name: { zh: '市場消息', en: 'Market News' },
    desc: { zh: '個股或產業的消息，會讓[[stock]]價格大漲或大跌。', en: 'Company or industry news that moves [[stock]] prices.' },
  },
  geo: {
    icon: '🌍', color: 'red',
    name: { zh: '地緣政治', en: 'Geopolitics' },
    desc: { zh: '戰爭、[[sanctions]]、[[tariff]]等國際事件，會影響油價、匯率和[[safe_haven]]。', en: 'Wars, [[sanctions]] and [[tariff|tariffs]] that move oil, currencies and [[safe_haven|safe havens]].' },
  },
  cb: {
    icon: '🏦', color: 'purple',
    name: { zh: '央行會議', en: 'Central Bank' },
    desc: { zh: '[[central_bank]]召開利率會議，決定[[rate_hike|升息]]、降息或不變，影響所有人的貸款和投資。', en: 'The [[central_bank]] decides whether to [[rate_hike|raise]], cut or hold [[interest_rate|rates]], affecting everyone.' },
  },
  doodad: {
    icon: '💸', color: 'orange',
    name: { zh: '意外支出', en: 'Doodad' },
    desc: { zh: '生活中的花費和誘惑。可以一次付清，有些可以[[installment]]——但分期會增加每月支出。', en: 'Life’s expenses and temptations. Pay now or use [[installment|installments]] — which raise monthly expenses.' },
  },
  learning: {
    icon: '🎓', color: 'indigo',
    name: { zh: '進修', en: 'Learning' },
    desc: { zh: '回答一題金融知識問答，答對可以獲得獎金。投資自己也是一種投資！', en: 'Answer a finance quiz question to earn a reward. Investing in yourself pays off!' },
  },
  auction: {
    icon: '🔨', color: 'brown',
    name: { zh: '拍賣所', en: 'Auction' },
    desc: { zh: '翻開一張大型機會，所有玩家公開競標。小心出價太高的「贏家詛咒」！', en: 'A big deal goes up for auction among all players. Beware the winner’s curse!' },
  },
  exchange: {
    icon: '🤝', color: 'cyan',
    name: { zh: '交易所', en: 'Exchange' },
    desc: { zh: '抽一張策略卡。任何時候都可以按「🤝 玩家交易」和其他玩家交換資產、卡片，或借錢給別人收利息（小心[[default_risk]]）。', en: 'Draw a strategy card. On your turn you can always press "🤝 Trade" to swap assets or cards with players, or lend money for interest (beware [[default_risk]]).' },
  },
  life: {
    icon: '👶', color: 'pink',
    name: { zh: '人生事件', en: 'Life Event' },
    desc: { zh: '結婚、生小孩、加薪、裁員……人生的變化會改變你的收入與[[expense]]。', en: 'Marriage, kids, raises, layoffs… life changes your income and [[expense|expenses]].' },
  },
  tax: {
    icon: '🧾', color: 'gray',
    name: { zh: '報稅季', en: 'Tax Season' },
    desc: { zh: '依本季薪資與[[passive_income]]補繳[[tax]]。', en: 'Pay [[tax]] on this quarter’s salary and [[passive_income]].' },
  },
};

// 人生事件 3 格（第 2、11、22 格），平均分布在一圈裡
MT.DATA.board = [
  'payday', 'small', 'life', 'market', 'learning', 'small', 'geo', 'doodad',
  'payday', 'big', 'market', 'life', 'small', 'cb', 'doodad', 'exchange',
  'payday', 'small', 'geo', 'tax', 'big', 'learning', 'life', 'auction',
];

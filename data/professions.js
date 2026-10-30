// 錢潮 MoneyTide © 2026 麥麥的遊戲工廠 保留所有權利 All rights reserved. 詳見 LICENSE
// 職業資料（每月金額，單位：新台幣）。
// 總支出 = living + tax + 各項負債的每月還款。home = 自住房價值（不產生現金流）。
// floating：浮動利率房貸，月付會隨央行利率調整。
window.MT = window.MT || {};
MT.DATA = MT.DATA || {};

MT.DATA.professions = [
  {
    id: 'factory', icon: '🏭',
    name: { zh: '工廠作業員', en: 'Factory Worker' },
    salary: 32000, living: 21000, tax: 1000, cash: 30000, home: 0,
    liabilities: [{ name: { zh: '機車貸款', en: 'Scooter loan' }, balance: 30000, payment: 3000 }],
    skill: { name: { zh: '刻苦耐勞', en: 'Frugal' }, desc: { zh: '意外支出卡金額 −30%', en: 'Doodad costs −30%' } },
  },
  {
    id: 'civil', icon: '🏛️',
    name: { zh: '公務員', en: 'Civil Servant' },
    salary: 48000, living: 31000, tax: 3000, cash: 80000, home: 0,
    liabilities: [],
    skill: { name: { zh: '鐵飯碗', en: 'Iron Rice Bowl' }, desc: { zh: '不會被裁員', en: 'Immune to layoffs' } },
  },
  {
    id: 'teacher', icon: '👩‍🏫',
    name: { zh: '教師', en: 'Teacher' },
    salary: 52000, living: 32000, tax: 3000, cash: 60000, home: 0,
    liabilities: [{ name: { zh: '學生貸款', en: 'Student loan' }, balance: 200000, payment: 3000 }],
    skill: { name: { zh: '終身學習', en: 'Lifelong Learner' }, desc: { zh: '問答答錯也能拿一半獎金', en: 'Half the quiz reward even when wrong' } },
  },
  {
    id: 'nurse', icon: '🩺',
    name: { zh: '護理師', en: 'Nurse' },
    salary: 55000, living: 30000, tax: 3000, cash: 50000, home: 0,
    liabilities: [{ name: { zh: '汽車貸款', en: 'Car loan' }, balance: 400000, payment: 7000 }],
    skill: { name: { zh: '危機處理', en: 'Crisis Care' }, desc: { zh: '每局一次抵銷負面人生事件', en: 'Cancel one bad life event per game' } },
  },
  {
    id: 'sales', icon: '💼',
    name: { zh: '業務員', en: 'Salesperson' },
    salary: 40000, living: 27000, tax: 2000, cash: 40000, home: 0,
    liabilities: [{ name: { zh: '汽車貸款', en: 'Car loan' }, balance: 500000, payment: 6000 }],
    skill: { name: { zh: '人脈廣', en: 'Networker' }, desc: { zh: '小型機會抽 2 選 1', en: 'Draw 2 small deals, keep 1' } },
  },
  {
    id: 'engineer', icon: '💻',
    name: { zh: '軟體工程師', en: 'Software Engineer' },
    salary: 85000, living: 30000, tax: 8000, cash: 150000, home: 10000000,
    liabilities: [{ name: { zh: '房屋貸款（浮動利率）', en: 'Home mortgage (floating)' }, floating: true, balance: 8000000, payment: 20000 }],
    skill: { name: { zh: '科技洞察', en: 'Tech Insight' }, desc: { zh: '可預看下一張市場消息', en: 'Preview the next market news card' } },
  },
  {
    id: 'lawyer', icon: '⚖️',
    name: { zh: '律師', en: 'Lawyer' },
    salary: 140000, living: 45000, tax: 20000, cash: 200000, home: 18000000,
    liabilities: [{ name: { zh: '房屋貸款（浮動利率）', en: 'Home mortgage (floating)' }, floating: true, balance: 15000000, payment: 40000 }],
    skill: { name: { zh: '法務專家', en: 'Legal Expert' }, desc: { zh: '攻擊卡對你的效果減半，並能擋下惡意併購', en: 'Attacks on you are halved, and hostile takeovers are blocked' } },
  },
  {
    id: 'doctor', icon: '👨‍⚕️',
    name: { zh: '醫師', en: 'Doctor' },
    salary: 180000, living: 50000, tax: 30000, cash: 100000, home: 24000000,
    liabilities: [
      { name: { zh: '房屋貸款（浮動利率）', en: 'Home mortgage (floating)' }, floating: true, balance: 20000000, payment: 50000 },
      { name: { zh: '學生貸款', en: 'Student loan' }, balance: 1000000, payment: 8000 },
    ],
    skill: { name: { zh: '高信用評等', en: 'Prime Credit' }, desc: { zh: '銀行借款利率較低', en: 'Lower bank loan rate' } },
  },
  {
    id: 'equal', icon: '🧑',
    name: { zh: '上班族', en: 'Office Worker' },
    salary: 60000, living: 38000, tax: 4000, cash: 100000, home: 0,
    liabilities: [],
    skill: null,
  },
];

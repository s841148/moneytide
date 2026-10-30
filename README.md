# 🌊 錢潮 MoneyTide

一款教金融觀念的桌遊式網頁遊戲：從「老鼠賽跑」走向財務自由。
A board-and-card web game that teaches personal finance, macroeconomics and investing.

## 怎麼玩 / How to play

- **線上直接玩**：打開本專案的 GitHub Pages 網址即可，電腦、平板、手機都能玩。
- **離線玩**：下載後點兩下 `index.html`，不需要安裝任何東西。
- 第一次玩建議先按開局畫面的「🎓 新手教學」。

## 特色 / Features

- 1–4 人，可以同一台裝置輪流玩，也可以 **🌐 網路連線對戰**（建立房間、輸入 5 碼代碼加入）
- 5 種投資性格的電腦對手，3 種強度
- 景氣循環、利率、匯率、油價等總體經濟會影響股票、ETF、債券、黃金、房地產
- 真實歷史事件（1929 大蕭條、2008 金融海嘯、2020 疫情……）與地緣政治卡
- 121 個金融名詞，每個都有一句話解釋、生活比喻與遊戲中的影響
- 槓桿風險：浮動利率、融資斷頭、事業倒閉、資不抵債
- 賽後複盤：和「每次發薪都買台灣 50 ETF」的大盤對照組比較
- 繁體中文 / English

## 技術 / Tech

純 HTML / CSS / JavaScript，沒有建置步驟。音效與音樂用 Web Audio 即時合成；網路連線使用 WebRTC（透過 [PeerJS](https://peerjs.com/) 公開服務配對）。

設計細節請見 [GDD-遊戲設計文件.md](GDD-遊戲設計文件.md)。

> 遊戲中的公司、部分事件與國家為虛構，內容僅供教育用途，不構成任何投資建議。
> Companies and some events are fictional. For education only — not investment advice.

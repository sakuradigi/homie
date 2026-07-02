# Homie 作業通 🎒

> 幫助台灣國小家長用 AI 檢查作業、朗讀繪本的網頁工具

🔗 **立即使用**：https://sakuradigi.github.io/homie

不需要安裝任何 App，手機瀏覽器直接開啟即可。

---

## 為什麼做這個？

身為家長，陪孩子寫作業有兩個高頻痛點：

1. **作業量大、答案不確定** — 國語填空、英語造句、數學應用題，家長不一定每題都有把握
2. **繪本要唸給孩子聽** — 孩子識字量不足，家長得逐字唸，費時又容易唸錯

現有 AI 工具（Gemini、ChatGPT）能做到這些，但 UX 不是為這個場景設計的：跳題、跳頁、朗讀無法中斷、無法從指定位置開始……

KidAI 就是為這個場景專門打造的。

---

## 功能

### 📝 解題助手
- 拍攝作業照片（支援多頁連續拍攝）
- AI 逐題辨識並回答，附簡短說明
- 支援數學、國語、英語、生活 / 自然等科目
- 解題結果以清楚格式呈現

### 📖 繪本朗讀
- 拍攝繪本頁面，自動去除頁碼、書名等雜訊
- 段落高亮 + 逐段朗讀
- 點擊任意段落，從該處開始播放
- 可調語速、可切換語音
- 支援中文 / 英文繪本

### 其他
- 支援三家 AI 供應商：Gemini / Claude / OpenAI，自備 API Key 即可切換
- 照片上傳前自動壓縮（長邊 1600px），大幅降低費用與等待時間
- 最近 10 筆歷史紀錄（localStorage，不上傳）
- 解題完成後一鍵「新題目」清除重來
- 模型自由選擇（見下方費用說明）

---

## 使用方式

**Step 1 — 申請 API Key（三家擇一）**

- Gemini（推薦入門）：[Google AI Studio](https://aistudio.google.com/app/apikey)，免費方案每分鐘 60 次請求，不需信用卡
- Claude：[Anthropic Console](https://console.anthropic.com/)
- OpenAI：[OpenAI Platform](https://platform.openai.com/api-keys)

> 你的消費者版訂閱（Gemini / Claude / ChatGPT）和 API 是兩個不同系統，互不影響。

**Step 2 — 開啟網頁，填入 API Key**

填入後點「儲存」，之後每次開啟會自動帶入（存在你的瀏覽器，不傳到任何伺服器）。

**Step 3 — 選模型，開始拍照**

---

## 模型選擇與費用參考

| 供應商 | 模型 | 建議用途 | 估計費用 / 次 |
|--------|------|---------|-------------|
| Gemini | 3.5 Flash（預設）| 日常作業，快速 | ~$0.005 |
| Gemini | 3.5 Pro | 最高準確度 | ~$0.02 |
| Claude | Haiku 4.5 | 快速、最省 | ~$0.001 |
| Claude | Sonnet 4.6 | 均衡推薦 | ~$0.006 |
| Claude | Opus 4.8 | 最強 | ~$0.03 |
| OpenAI | GPT-5.4 Mini / Nano | 均衡 / 最省 | ~$0.002 / ~$0.0005 |
| OpenAI | GPT-4.1 / 4.1 Mini | 穩定 | ~$0.005 / ~$0.001 |

> 費用從你自己的供應商帳號扣，不經過本站。照片會先在瀏覽器內壓縮，實際費用通常低於上表。

---

## 隱私

- 圖片直接從你的瀏覽器傳送至你選擇的 AI 供應商（Google / Anthropic / OpenAI），**不經過本站任何伺服器**
- API Key 存在你瀏覽器的 localStorage，不上傳
- 本站不收集任何使用資料

---

## 技術架構

- 純單頁 HTML，零後端、零資料庫
- Gemini / Claude / OpenAI Vision API — 圖片辨識 + 解題
- 瀏覽器內 canvas 圖片壓縮（上傳前長邊縮至 1600px）
- Web Speech API — 瀏覽器原生 TTS
- localStorage — 歷史紀錄暫存（最近 10 筆，文字 only）
- marked.js + DOMPurify — Markdown 安全渲染

---

## 版本紀錄

見 [CHANGELOG.md](./CHANGELOG.md)

---

## 開發者

Vincent Lu — 為自己孩子做的工具，開源分享給有同樣需求的家長。

如有 bug 或功能建議，歡迎開 [Issue](https://github.com/sakuradigi/Kidai/issues)。

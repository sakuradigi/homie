# KidAI — 作業助手 · 繪本朗讀

幫助台灣國小家長用 AI 檢查作業、朗讀繪本的網頁工具。

🔗 **Live Demo**: https://sakuradigi.github.io/Kidai

---

## 功能

### 📝 解題助手
- 拍攝作業照片（支援連續多頁）
- AI 逐題辨識並回答，附解題說明
- 支援數學、國語、英語、生活/自然等科目

### 📖 繪本朗讀
- 拍攝繪本頁面（自動去除頁碼、書名等雜訊）
- 段落高亮 + 逐段朗讀
- 點擊任意段落從該處開始
- 可調語速與語音

---

## 使用方式

1. 前往 [Google AI Studio](https://aistudio.google.com/app/apikey) 申請免費 Gemini API Key
2. 開啟網頁，填入 API Key（僅傳送至 Google，不經過本站）
3. 選擇模型（建議從 Gemini 2.0 Flash 開始）
4. 拍照或上傳圖片，開始使用

---

## 模型選擇與費用參考

| 模型 | 建議用途 | 估計費用/次 |
|------|---------|------------|
| Gemini 2.0 Flash | 日常作業，速度快 | ~$0.001 |
| Gemini 3.5 Flash | 複雜題目，更準確 | ~$0.005 |
| Gemini 2.5 Flash | 平衡選項 | ~$0.003 |
| Gemini 2.5 Pro | 最高準確度 | ~$0.02 |

> Google AI Studio 有免費額度（每分鐘60次），個人使用基本不需付費。

---

## 技術

- 純單頁 HTML，無後端，無資料庫
- 串接 Google Gemini Vision API
- TTS 使用瀏覽器原生 Web Speech API
- 歷史紀錄存於 localStorage（最近10筆）

---

## 版本

見 [CHANGELOG.md](./CHANGELOG.md)

---

## 開發者

Vincent Lu — 為自己孩子做的工具，開源分享。

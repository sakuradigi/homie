# Homie 作業通 — 現況與待辦

> 更新：2026-10-15（v0.17.0）。2026-07-06 那份程式碼審查（v0.3.1）的 A～E 項目已全部處理完畢，細節見 CHANGELOG.md。

## 架構現況

- 單檔 `index.html`（約 3,500 行）＋ `about.html`、`sw.js`、`manifest.json`；零後端、零 build step
- 資料都在使用者瀏覽器：localStorage（設定、歷史紀錄文字、花費、單字快取）、IndexedDB `homie` v2（`mistakes` 錯題本、`thumbs` 歷史縮圖）
- 外部服務只有使用者自己選的 AI 供應商（Gemini／Claude／OpenAI；含 Gemini／OpenAI TTS），以及跟讀模式用的 Chrome 語音辨識（聲音送 Google）
- 測試：`test_homie.mjs`（jsdom＋fake-indexeddb，約 300 項）；版本號三處一致由測試把關，每版打 git tag

## 尚未實機驗證（需要在 S24U 上確認）

- Gemini 3.8 TTS（`/v1beta/interactions`）與 OpenAI TTS 的真實呼叫、瀏覽器能否直接呼叫（CORS）
- Claude 5.5 的 `fallbacks: "default"`（需要 `anthropic-beta` header 的 CORS）
- 從相簿分享到 Homie（share_target，需加到主畫面）
- 跟讀模式的語音辨識準確度、評分門檻
- 照片裁切的觸控手感、查單字點擊準確度、分享到 LINE

## 待辦（依價值排序）

1. **生字詞卡**：陪讀講解過的詞語、錯題本的生字整理成卡片，可複習與小測驗
2. **注音支援**：國語作業的注音題辨識與講解
3. **單價表更新**：Gemini 3.8 Flash 據報 2027-01-01 起調漲（$1.50／$7.50），屆時更新 `PRICES`
4. **index.html 區塊目錄**：檔案已大，在檔頭加區塊索引方便維護（不拆檔）

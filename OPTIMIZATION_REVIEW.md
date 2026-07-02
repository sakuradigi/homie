# Homie 作業通 — 程式碼審查與優化建議

> 審查日期：2026-07-02 · 對象：index.html (v0.3.1)、README.md、deploy.sh

## 總評

架構方向正確：零後端單檔 HTML、API Key 存於使用者瀏覽器、費用由使用者自己的 Key 承擔。這是本專案最大的資產，**不建議改變**。以下建議全部在「維持單檔、零後端」前提下進行。

---

## A. 確定的 Bug（建議優先修）

### A1. 恢復歷史紀錄會重複寫入歷史 ⚠️ 最嚴重
`restoreHistory()` → `renderHomeworkResult()` / `renderReadingResult()` → 內部又呼叫 `saveHistory()`。
每點一次歷史紀錄就多寫一筆重複資料，點 10 次後整個歷史清單全是同一筆。
**修法**：`saveHistory` 從 render 函式中抽出，只在 `runHomework` / `runReading` 成功後呼叫。

### A2. 每頁的語速／語音選單只有第一頁有效
`buildTTSControls()` 為每頁建立 `speed-${pageIdx}` / `voice-${pageIdx}`，但 `speakNext()` 一律讀 `document.querySelector('.speed-select')`（永遠是第一個）。第二頁以後的選單是裝飾品，且產生重複 id。
**修法**：改為單一全域控制列（放在「從頭朗讀全文」旁），移除每頁重複的選單。程式更少、UI 更乾淨。

### A3. 英文繪本的歷史紀錄恢復後變中文朗讀
`restoreHistory(prefix, item.full)` 對 rd 一律傳 `'zh'`。
**修法**：`saveHistory` 時多存 `readLang`，恢復時帶回。

### A4. 分頁 regex 過於嚴格
`text.split(/===第\d+頁===/)` 無法容忍模型輸出 `=== 第 1 頁 ===`（含空格）或英文繪本時輸出 `=== Page 1 ===`。整份文字會被當成一頁。
**修法**：`/===\s*(?:第\s*\d+\s*頁|Page\s*\d+)\s*===/i`

---

## B. 成本與效能優化（效益最大的一項）

### B1. 上傳前壓縮圖片 ⭐ 單一最大改善點
目前 `FileReader.readAsDataURL` 直接送原始照片。現代手機一張 12MP 照片 base64 後 4–8MB：

- **Gemini 按圖片解析度切 tile 計費**，原圖 token 成本可達壓縮後的 5–10 倍
- 上傳時間長（行動網路下 10–30 秒），是目前「分析中…」等待的主因
- 多頁時容易撞到 request size 上限

**修法**：加一個 ~25 行的 canvas 壓縮函式，長邊縮至 1600px（作業小字仍清晰）、JPEG quality 0.85，在 `addImages` / `handleFileInput` 統一套用。預期效果：費用降 60–85%、上傳時間降 70%+。這一項就值回整次審查。

### B2. Gemini Key 改用 header
`?key=${key}` 放 URL 易留存於各種 log。改用 `x-goog-api-key` header，一行修改。

### B3. `max_tokens: 4096` 可能截斷多頁作業
5 頁以上的逐題解答可能被切掉尾巴。建議提高到 8192，並在回應被截斷時（`finish_reason`）提示使用者分批拍攝。

---

## C. 穩健性與安全

### C1. AI 回應直接 innerHTML — XSS 風險
`marked.parse(text)` 未經 sanitize 就插入 DOM。攻擊面確實存在：一張惡意設計的「作業單」上印的文字會被 OCR 進模型輸出，再被渲染成 HTML。歷史紀錄 preview 同樣未跳脫。
**修法**：加載 DOMPurify（cdnjs，與 marked 同來源），`DOMPurify.sanitize(marked.parse(text))`。

### C2. 語音清單用 setTimeout(300) 賭時序
iOS/Android 上 `getVoices()` 首次常回空陣列。改用 `voiceschanged` 事件（目前 onload 裡已掛了空的 handler，補上邏輯即可）。

### C3. iOS Safari 長文朗讀中斷
Safari 對長 utterance 有 ~15 秒靜音中斷問題。目前逐段朗讀的設計已天然緩解，但建議段落再依句號細切（>100 字時），順便讓高亮更精準。

### C4. 其他小項
- 儲存空 API Key 也會顯示「已儲存」→ 加非空驗證
- `escapeHtml()`、`updateSpeed()`、`switchProvider` 內 `childNodes[1]` 清空後又整段 innerHTML 覆寫 → 三處死碼，刪除
- 429（rate limit）錯誤訊息對家長不友善 → 攔截後顯示「請求太頻繁，請等一分鐘」
- 切換分頁時不會停止朗讀 → `switchTab` 加 `stopTTS()`

---

## D. 產品層（低成本高感受）

### D1. 半套的雙語介面
`toggleLang` 只翻譯有 `data-zh/en` 的元素；shoot bar、bottom sheet、歷史紀錄、費用徽章、alert、錯誤訊息全是寫死中文。
**建議**：二選一——(a) 收斂成單一 `t(key)` 字典函式，全站走同一機制；(b) 若實際使用者都是台灣家長，**直接移除 EN 切換**，刪掉 30+ 行維護負擔。傾向 (b)。

### D2. PWA 化（加到主畫面）
加 `manifest.json` + 極簡 service worker（只 cache 外殼），家長可「加入主畫面」當 App 用，也消除 marked CDN 掛掉時全站失效的單點故障。約 40 行。

### D3. 串流回應（中期）
Gemini/Claude/OpenAI 皆支援 SSE 串流。逐字顯示可讓 10 秒的等待體感減半。改動集中在三個 call 函式，中等工作量，建議 B1 之後再做。

---

## E. 文件與工程衛生

- **README 與程式碼脫節**：README 模型表還是 2.0/2.5 Flash 四款、預設 2.0 Flash；程式碼實際是 3.5 Flash/Pro 兩款，且已支援 Claude/OpenAI 三家，README 完全沒提。功能表也缺「多供應商」。
- `HISTORY_KEY` 仍用 `kidai_*` 前綴（改名遺留）。保留可向下相容，但註記即可。
- `deploy.sh`：無變更時 `git commit` 失敗但仍執行 push 並顯示成功；建議先 `git diff --quiet` 檢查。另補 `.gitignore`（.DS_Store）。

---

## 建議執行順序

| 批次 | 內容 | 工作量 | 效益 |
|------|------|--------|------|
| 1 | A1–A4 四個 bug | 小 | 修正錯誤行為 |
| 2 | B1 圖片壓縮 + B2 + B3 | 小 | 費用 -60~85%、速度大增 |
| 3 | C1 DOMPurify + C4 小項 | 小 | 安全與體驗 |
| 4 | D1 語言策略 + E 文件同步 | 小 | 維護成本下降 |
| 5 | D2 PWA、D3 串流 | 中 | 產品升級 |

**不建議做的事**：拆分 CSS/JS 檔案、引入框架、加後端 proxy。目前規模（~1000 行）單檔完全可維護，拆分只會增加部署複雜度，違背專案初衷。

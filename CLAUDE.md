# Homie 作業通 — AI 協作規範

本專案由 Vincent 與 AI（Claude）協作開發。任何 AI 在修改本專案時必須遵守：

## 版本紀錄（強制）

- **每次修改完成後，必須同步更新 `CHANGELOG.md`**，不可遺漏。
- 版本號格式：`v主版本.功能迭代.小修正`
  - 新功能 → 功能迭代 +1（如 v0.6.0 → v0.7.0）
  - 純修 bug／文案 → 小修正 +1（如 v0.6.0 → v0.6.1）
- 日期用當天實際日期（先用指令確認，勿憑印象）。
- 分類寫在「新增／修正／移除」小節下。

## 發版連動

- 改了 `index.html` / `about.html` 等會被快取的檔案 → **同步 bump `sw.js` 的 `CACHE` 版本字串**（如 `homie-v0.7.0`），否則舊用戶拿不到新版。
- `deploy.sh` 會在 CHANGELOG.md 未更新時擋下部署。

## 架構原則（不可違反）

- 純前端單檔架構：零後端、零資料庫、零 build step。不拆分 CSS/JS、不引入框架。
- API Key 只存使用者瀏覽器 localStorage，照片不經任何伺服器。
- AI 回應必須經 `DOMPurify.sanitize()` 再進 innerHTML。
- 介面語言：繁體中文 only（EN 切換已於 v0.4.0 移除）。

## 檔案地圖

| 檔案 | 用途 |
|------|------|
| `index.html` | 工具本體（首頁），含頂部可收合介紹區 |
| `about.html` | 介紹／銷售子頁 |
| `sw.js` / `manifest.json` | PWA |
| `CHANGELOG.md` | 版本紀錄（每次修改必更） |
| `OPTIMIZATION_REVIEW.md` | 2026-07-06 程式碼審查報告 |
| `deploy.sh` | 一鍵部署（含 CHANGELOG 檢查） |

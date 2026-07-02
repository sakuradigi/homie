#!/bin/bash
# Homie 作業通 — 一鍵部署腳本
# 用法：bash deploy.sh "說明這次改了什麼"

cd "$(dirname "$0")" || exit 1

if [ -z "$(git status --porcelain)" ]; then
  echo "ℹ️ 沒有變更，不需部署。"
  exit 0
fi

MSG=${1:-"更新"}

git add .
git commit -m "$MSG" || exit 1

if git push; then
  echo ""
  echo "✅ 已推上 GitHub！"
  echo "🌐 網站約 60 秒後更新：https://sakuradigi.github.io/homie"
else
  echo ""
  echo "❌ Push 失敗，請檢查 GitHub 認證或網路連線。"
  exit 1
fi

#!/bin/bash
# Homie 作業通 — 一鍵部署腳本
# 用法：bash deploy.sh "說明這次改了什麼"

cd /Users/vincentlu/Claude/Projects/Homie

MSG=${1:-"更新"}

git add .
git commit -m "$MSG"
git push

echo ""
echo "✅ 已推上 GitHub！"
echo "🌐 網站約 60 秒後更新：https://sakuradigi.github.io/homie"

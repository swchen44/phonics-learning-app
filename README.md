# Phonics 聽音跟讀 App

GitHub Pages 靜態 Web App。Unit 1 提供附插圖的短母音練習、拼讀、錄音跟讀，以及每輪各五題的聽力與朗讀測驗。聽力顯示答對題數，朗讀錄音後可重聽及比對示範音，並記錄完成題數。學生進度儲存在 IndexedDB，支援 JSON 備份與還原。

## 啟用 GitHub Pages

Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。main 分支推送後工作流程自動部署。

網址：https://swchen44.github.io/phonics-learning-app/

## 本機執行

`python3 -m http.server 8080`，瀏覽 http://localhost:8080 。

## 目前限制

只有 Unit 1 示範；其餘 31 單元尚未製作。使用裝置內建英文語音合成，非經校訂的獨立音素音檔。錄音供學生重聽，不會自動評分，且重整後不保留音檔。進度存在瀏覽器 IndexedDB，可能因清除網站資料而遺失；請定期匯出 JSON。

新增單元時，在 `app.js` 的 `units` 加入單元資料與至少五個不同的單字，再於 `pictures.svg` 加入相對應的插圖。每個開放單元共用聽力、朗讀與進度流程。

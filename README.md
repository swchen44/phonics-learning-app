# Phonics 聽音跟讀 App

GitHub Pages 靜態 Web App。第一版實作 Short Vowels Unit 1：聽音、拼讀、麥克風錄音重聽、聽力選擇題、IndexedDB 學生進度、JSON 備份與還原。

## 啟用 GitHub Pages

Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。main 分支推送後工作流程自動部署。

網址：https://swchen44.github.io/phonics-learning-app/

## 本機執行

`python3 -m http.server 8080`，瀏覽 http://localhost:8080 。

## 目前限制

只有 Unit 1 示範；其餘 31 單元尚未製作。使用裝置內建英文語音合成，非經校訂的獨立音素音檔。錄音供學生重聽，不會自動評分，且重整後不保留音檔。進度存在瀏覽器 IndexedDB，可能因清除網站資料而遺失；請定期匯出 JSON。
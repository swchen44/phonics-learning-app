# Phonics 聽音跟讀

以繁體中文輔助學習的美式自然發音 App。教材是自編的四冊 32 單元，共 161 個附圖單字。每單元提供聽音、拼讀、錄音跟讀、五題聽力、五題聽力打字與五題朗讀。綜合測驗可在同一冊勾選多個單元與題型，隨機出十題。課程順序參考 [IES 基礎閱讀技能指南](https://ies.ed.gov/ncee/wwc/PracticeGuide/21/)。

[開啟 GitHub Pages](https://swchen44.github.io/phonics-learning-app/)

## 從新電腦啟動

```sh
git clone https://github.com/swchen44/phonics-learning-app.git
cd phonics-learning-app
python -m http.server 8080
```

開啟 <http://localhost:8080>。前端無需安裝套件。允許瀏覽器使用麥克風即可測試錄音。正式站用 HTTPS，開發時用 `localhost`，直接開啟 HTML 檔案會影響麥克風、插圖和離線快取。

## 備份、重置和還原

1. 在「學生與本機進度」按「匯出 JSON 備份」。備份包含所有學生的學習事件、綜合測驗題目、分數與錯題。錄音和發音評估設定留在原瀏覽器，JSON 備份不包含這兩項。
2. 如要清除這個 App 的學生資料，先關閉同一網站的其他分頁。在 Chrome 或 Edge 開啟開發人員工具，選 **Application → IndexedDB → `phonics-progress` → Delete database**。重新整理後，應看到新的「學生 1」和空白進度。
3. 如要還原，按「匯入備份」選 JSON。相同學生 ID 的學習事件會被備份覆蓋，綜合測驗紀錄會合併，既有題目的本機錄音與評分會保留。

如果只是看不到新版，先強制重新整理。仍載入舊版時，在 **Application → Service Workers** 取消註冊這個 App 的 Service Worker，再重新整理。清除學生資料與重新載入程式是分開的操作。

## 交接修改

| 要改什麼 | 從這裡開始 |
| --- | --- |
| 單元、音素、翻譯、小圖 | `curriculum.js`。每單元至少五個不同的單字。插圖欄位可用 emoji，或用 `#名稱` 連到 `pictures.svg` 的 `<symbol>`。|
| 測驗、錄音、備份與進度 | `app.js`。各單元共用測驗邏輯。保留現有單元 ID，舊的 IndexedDB 和 JSON 才能對應原有單元。|
| 版面與離線 | `index.html`、`styles.css`、`manifest.webmanifest`。新增前端檔案時，更新 `sw.js` 的快取清單和版本。|
| 發音判定 | `pronunciation.js` 負責送出錄音，`api/pronunciation.js` 負責呼叫評估服務與解讀結果。|

交接時提供 Git 分支或提交編號、要改的單元、測過的流程，以及是否已配置發音判定。新接手的人先讀本檔，依上方步驟啟動，再做下列驗收。

## 驗收與部署

1. 執行 `git diff --check`，再用 `node --check` 檢查修改過的 JavaScript。
2. 打開網站，切換第 1、16、32 單元。各做一輪聽力、打字與朗讀。打字作答前應只顯示首字母與慢速播放。再勾選 Unit 3、Unit 4 與多種題型，完成十題綜合測驗並確認歷史紀錄。
3. 檢查窄螢幕下的單元選單和測驗選項。備份後用新瀏覽器設定檔匯入，確認原有進度可讀。
4. GitHub 專案的 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。推送 `main` 後，等 **Deploy GitHub Pages** 成功，再打開公開網站確認新內容。
5. 要回復上一個上線版本，在 `main` 用 `git revert <要回復的提交>` 建立回復提交，再推送並確認部署。這會保留 Git 歷史，瀏覽器中的學習資料另由備份處理。

## 啟用朗讀發音判定

未設定評估服務時，各單元可錄音、重聽及比對示範音。要在每題錄完後顯示發音判定，需有 Azure Speech 資源與 Azure Function App。

1. 用 Node.js 22 的 Azure Functions 部署 `api/`，在 Function App 的應用程式設定加入 `AZURE_SPEECH_RESOURCE` 與 `AZURE_SPEECH_KEY`，並允許 `https://swchen44.github.io` 的跨來源請求。Speech 金鑰留在後端。
2. 在朗讀測驗開啟「發音判定設定」，填寫 `/api/pronunciation` 的 HTTPS 網址和該函式專用的存取金鑰，再按「儲存設定」。設定留在這個瀏覽器，可用「清除設定」移除。
3. 勾選「啟用發音判定」。啟用後，每題最多 10 秒的朗讀錄音會送至 Microsoft Azure 分析。重新載入頁面後要重新勾選，使用碼會保留。
4. 用真人錄音分別測試清楚發音、念錯母音和無聲錄音。確認每題顯示判定或重錄提示，關閉判定後仍可在本機錄音。

目前判定以美式英文的單字和音素準確度為準。兩者都達 60 且服務未標示錯誤時，顯示「念得清楚」。聽不清楚或服務失敗時會提示重錄。這是練習回饋，門檻可在取得真人測試資料後調整。[Microsoft Speech 短音訊評估說明](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short)

綜合測驗交卷後會保留十題內容和每道朗讀題最後提交的錄音。打開歷史紀錄可逐題回放或刪除錄音。刪除錄音會保留原題和分數。已啟用評估且伺服器有判定的題目使用伺服器分數，其餘朗讀題可在紀錄中人工標記「念對」或「需再練習」。總分按已評分題目換算百分制。

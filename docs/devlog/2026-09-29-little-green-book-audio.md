# ENG-008 施工紀錄｜小綠書 U01–U04 固定音檔

- 日期：2026-09-29
- 對應規格：[SDD-008](../sdd/008-little-green-book-audio.md)
- 結果：v2026.09.29.4 已 commit、push、部署並通過線上 smoke test；代表音檔獲使用者確認，較完整聽評與窄螢幕仍列發布後 QA
- 預定版本：`2026.09.29.4`

## 施工節點

### N0｜施工前盤點

- 先讀工程索引與 ENG-007 SDD／know-how，確認四課目前各有 10／10／10／12 句，標記為裝置語音。
- 工作樹只保留使用者提供的未追蹤 PDF；不會加入課程、TTS 文字或版本控制。
- 已確認既有產音工具會跳過 `preGeneratedAudio: false` 課程；要生成這批課，必須在所有四組完整後再切換狀態。
- 本機 Edge TTS、Kokoro Python 環境與 `ffprobe` 可用。Edge 請求僅包含 42 句原創英文，Kokoro 在本機生成。

### N1｜先建立 SDD

- 建立 SDD-008，定義 42 句 × 四聲線、每聲線 A/B 配對、manifest、資料傳輸邊界、離線及驗收範圍。
- 明列本輪不製作真人錄音、不送 PDF、口語加強替代表達保留裝置語音、不執行整體商用稽核。

### N2｜施工進行中

- 四課 JSON 的 `preGeneratedAudio` 改為 `true`，建立索引時四課都標記為固定音檔課。
- 沿用 `tools/generate-voices.mjs`，沒有修改產音器或覆寫舊音檔。處理範圍由原先 51 堂擴成 55 堂合成課，但產生器只補本批四課的缺檔。
- Kokoro 在本機生成美式／英式各 42 段；Edge TTS 產生美式／英式各 42 段。Edge 只收到 42 句原創英文；Kokoro 推論在本機完成。
- 新增 168 個 MP3，合計約 2.96 MB、播放約 8.1 分鐘。口語加強替代說法仍走裝置 TTS。

### N3｜音檔、索引與自動驗證

- 產音器將四課四種聲線逐句寫入 manifest。逐課比對句 ID 與順序，每組精確 42 段。
- 逐檔呼叫 ffprobe：168/168 可解析且 duration > 0；無音檔缺漏。
- 增加/更新 `test/little-green-book-lessons.test.mjs`，保證四課索引宣告固定音檔，manifest 有四組完整 voice sets。
- `npm run check` 通過：62 個 JavaScript 模組、73/73 Node 測試、內容驗證 115 課／1,916 句／12,684 個音檔。
- `js/version.js` 與 package release metadata 升至 `2026.09.29.4`；service worker 使用共享版本計算新快取代號，沒有新增 shell 模組。

### N4｜播放器與資料請求驗收

- 新來源載入 `l1-08` 課程頁，30 分鐘核心與 10/10 句正常；固定音檔課顯示離線下載入口，不再標示 device-only。
- 課程播放器的 voice selector 顯示美式與英式的「自然 Kokoro／146 wpm」及「清晰 edge-tts／114 wpm」兩種選項；L1 自動選清晰 voice。
- 實際播放後本地伺服器記錄取得 `/content/audio/edge-gb/l1-08/s1.mp3` 與 `/content/audio/kokoro-gb/l1-08/s1.mp3`，兩者 HTTP 200。
- 桌面課程頁與播放器驗收通過；本次尚未重做 390×844 viewport。沒有真實手機／Safari／Android 實測。

### N4b｜發布後 390×844 響應式 QA（2026-09-29）

- 在正式站以瀏覽器 viewport 模擬 390×844，檢查 U01–U04（`l1-08`～`l1-11`）課程頁、U01／U03 播放器及聲線選單。所有被測畫面的 `innerWidth`、`clientWidth`、`scrollWidth` 均為 390，沒有水平溢出。
- 目視檢查 `l1-08` 課程頁、播放器、聲線選單排版；沒有發現文字與控制項重疊。此結果僅是瀏覽器尺寸模擬，不宣稱真實手機觸控／Safari／Android 已驗收。
- 168 個正式站 manifest 音檔端點均完成 HEAD 請求：168/168 回應 200 且 `audio/mpeg`。這只確認服務端可取用，並非 168 段真人聽感測試。
- 使用者先前確認的範圍仍僅為代表句 `Did you say nine or nineteen?` 的四種合成聲線。A/B、`eight / eighteen`、否定、縮讀等其他聽評類別仍需人工確認。

### N5｜來源與人工聽評界線

- SDD 記錄 [Kokoro 模型卡](https://huggingface.co/hexgrad/Kokoro-82M) 的 Apache-2.0 權重資訊，並記錄 [edge-tts](https://github.com/rany2/edge-tts) 使用 Microsoft Edge 線上 TTS、程式主要為 LGPL-3.0。
- 本機產音環境版本：`kokoro` 0.9.4、`edge-tts` 7.2.8。
- Edge wrapper 授權不能代表 Microsoft 服務或語音輸出的商用權利；整體商用審查仍未做。
- 使用者收到 `Did you say nine or nineteen?` 四種聲線版本後回覆「音檔 ok」。記錄為該代表句及四種聲線已獲使用者確認；不擴張解讀成逐一聽完全部 168 段。
- 尚未取得 `eight / eighteen`、否定、縮讀及其他 A/B 句的人工聽評；`ffprobe` 僅證明檔案可解析，不能替代發音、角色辨識及自然度判斷。這些項目與 390×844 窄螢幕列為本次發布後待補 QA。

## SDD 驗收狀態

| 條件 | 結果 | 證據／限制 |
|---|---|---|
| A1 四課 × 四聲線完整音檔 | 通過 | 168/168；既有檔案採 skip-existing |
| A2 MP3 及 manifest 完整 | 通過 | 逐檔 ffprobe，四課清單順序相同 |
| A3 自動驗證 | 通過 | `npm run check`，73/73、content OK |
| A4 播放器固定聲線 | 通過 | 桌面 selector 有四種聲音；Edge GB、Kokoro GB 檔案請求 200 |
| A5 真人音質／辨識度聽評 | 部分通過 | 使用者確認 `Did you say nine or nineteen?` 四種聲線；其他 A/B、`eight / eighteen`、否定及縮讀未取得人工聽評 |
| A6 版號與響應式 UI | 部分通過 | 版號 `2026.09.29.4`；桌面與 390×844 瀏覽器模擬已驗，實體手機／Safari／Android 未測 |
| A7 工程追溯 | 通過 | SDD、devlog、know-how、測試、索引互連 |
| A8 推送與發布 | 通過 | `e52e666` 推送至 `main`；Firebase Hosting 正式站回報 v2026.09.29.4，課程頁／更新切換／音檔端點通過 smoke test |

### N6｜提交、推送與部署後 smoke test

- `npm run deploy` 再次執行全部檢查：62 個 JavaScript 模組語法檢查通過、73/73 Node 測試通過、內容驗證 115 課／1,916 句／12,684 個音檔通過。
- 建立功能提交 `e52e666`（`feat: add fixed audio for green book units`），推送 `main`：`2ab4a59..e52e666`。
- Firebase Hosting 專案 `echo-english-20260814` 部署成功，正式站為 [Echo English](https://echo-english-20260814.web.app)。
- 正式站 `js/version.js` 回報 `2026.09.29.4`；課程 `l1-08` 顯示 30 分鐘核心路線及 10/10 句，lesson JSON `preGeneratedAudio` 為 true。
- 測試頁偵測到舊快取 v2026.09.29.3 與新版 v2026.09.29.4，觸發「重新載入更新」後切換成功；播放器顯示英／美式 Kokoro 與 Edge TTS 聲線選項。
- 正式站 Edge GB `l1-08/s1.mp3` 與 Kokoro US `l1-11/s12.mp3` 均回應 HTTP 200、`audio/mpeg`。此為服務端可取得性，不代表逐段聽感驗證。
- PDF 沒有加入 Git 提交；Firebase Hosting ignore 規則包含 `**/*.pdf`，部署仍保留使用者 PDF 僅在本機未追蹤的狀態。
- 瀏覽器模擬 390×844 已驗收；真機、Safari／Android，以及 A/B、`eight / eighteen`、否定與縮讀等剩餘人工聽評未完成，保留為發布後限制。

## 發布狀態

- v2026.09.29.4 已部署至 [Firebase Hosting](https://echo-english-20260814.web.app)，功能 commit `e52e666` 已推送至 `main`。代表音檔取得使用者核可；發布不代表尚列出的部分人工聽評與響應式 QA 已完成。
- 使用者 PDF 未追蹤、未送往 TTS、未列入 manifest 或部署。

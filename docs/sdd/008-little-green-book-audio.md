# SDD-008｜小綠書 U01–U04 固定課程音檔

- 狀態：v2026.09.29.4 已提交、推送並部署；390×844 瀏覽器模擬 QA 與人工聽評表已補；代表音檔獲使用者確認；其他人工聽評及實體手機仍待驗
- 日期：2026-09-29
- 工程項目：ENG-008
- 上游規格：[SDD-005](005-little-green-book-u01-u04-editorial.md)、[SDD-007](007-little-green-book-u01-u04-app-lessons.md)

## 背景

U01–U04 已加入 App，但尚未預生成固定音檔，播放依賴每台裝置各自的系統語音。既有原創課程使用 `kokoro-us`、`kokoro-gb`、`edge-us`、`edge-gb` 四組核心聲音；本工程沿用相同音訊格式、命名、語速、manifest 與播放器，不新增語音引擎或資料模型。

## 需求

### LGA-01｜四課提供完整核心聲音

- 對象限定 `l1-08`～`l1-11` 的 42 句主要對話。
- 每句產生 Kokoro 美式／英式與 Edge TTS 美式／英式四個版本，共 168 個 MP3。
- 對話 A/B 使用現有聲線配對：Kokoro `af_heart`／`am_michael`、`bf_emma`／`bm_george`；Edge 使用現有 US／GB 女聲與男聲。
- 沿用 L1 Edge 教學語速設定及既有 MP3 編碼／單聲道輸出規格。

### LGA-02｜保留口語加強的現行播放方式

- 42 句主要課文改為固定音檔課，播放器依學習者口音／聲線設定讀取 manifest。
- `spokenPractice` 的額外替代說法不屬於 42 句核心課文，仍使用裝置 TTS；UI 繼續明示此限制。
- 不重新生成其他課程，不覆寫任何既有音檔。

### LGA-03｜來源、資料傳輸與音質界線

- Kokoro 在本機執行，不上傳文本。
- Edge TTS 只接收這 42 句原創英文文字，以產生美式及英式音檔；不傳送中文、PDF、個資、API key 或學習紀錄。
- 產音完成不等於真人品質驗收。數字對比、否定、縮讀、角色辨識與自然度需另外逐句人工聽評，問題音檔需修正後重產。
- `eight / eighteen` 目前出現在 `l1-10` 的任務／口說練習，使用裝置 TTS，並非這 168 段固定 MP3；聽評需分開記錄裝置與所選語音，不可把裝置語音結果歸因於固定音檔。
- 音檔是合成語音，不標示為真人錄音。

### 音訊來源與授權紀錄

- [Kokoro-82M 模型卡](https://huggingface.co/hexgrad/Kokoro-82M) 將模型權重標為 Apache-2.0。這只記錄上游模型卡提供的權重授權資訊，不代表已對全部推論套件相依、聲線包或生成輸出做整體法律判定。
- [edge-tts 專案](https://github.com/rany2/edge-tts) 說明它連接 Microsoft Edge 的線上文字轉語音服務；其[程式授權檔](https://raw.githubusercontent.com/rany2/edge-tts/master/LICENSE) 對主要程式碼標為 LGPL-3.0（其中 SRT composer 為 MIT）。這是 wrapper 程式碼的授權，不等同 Microsoft 服務或聲音輸出的使用授權。
- 本輪只記錄產音來源，不宣稱 Edge 服務及生成音檔已完成商用稽核；正式商用前需另行核對 Microsoft 服務條款及整體相依授權。

### LGA-04｜可重現建置與離線相容

- 只有 168 段完整存在並通過驗證後，才將四課標記為預生成音檔課。
- manifest 每課需恰有 42 個句子 ID 對應到四個核心 voice sets；不能以部分音檔切換課程狀態。
- `content/index.json`、README 音檔／課程資訊與 App／Service Worker 版本同步更新。
- 發布包排除附件 PDF；新課音檔可被 service worker 與既有離線下載功能取得。

## 非目標

- 不製作真人錄音或聲音複製，不從 PDF 擷取或傳送音訊。
- 不為澳洲、印度等額外口音生成小綠書音檔。
- 不替口語加強替代表達額外製作音檔。
- 不把檔案可解析等同真人發音／辨識度驗收；商用整體稽核另案。

## 資料流程

```text
42 句原創 lesson JSON
  ├─ Kokoro：本機 → kokoro-us / kokoro-gb
  └─ Edge TTS：僅英文句子 → edge-us / edge-gb
                         ↓
content/audio/<voice>/<lesson>/<sentence>.mp3
                         ↓
manifest 完整性與音檔驗證
                         ↓
lesson/index 標記預生成音檔 → 既有播放器／離線快取
```

## 驗收條件

- [x] A1：四課主對話總計 42 句，四組各 42 段，共 168 段 MP3；產音器只建立缺檔，未重製舊課。
- [x] A2：每一檔可由 ffprobe 解析、長度大於 0，manifest 順序與課程句子一致。
- [x] A3：`npm run check` 與新增的課程音訊完整性斷言通過。
- [x] A4：四課已切換固定音檔狀態；播放器可選取四組聲音，口語加強仍使用裝置語音。
- [x] A5a：使用者已確認四種聲線的代表句 `Did you say nine or nineteen?`；此核可只涵蓋該句，不代表其餘 167 段均已人工聽完。
- [ ] A5b：逐一檢查四組固定音檔中的 A/B 角色辨識、否定及縮讀並記下真人聽評與修正結果；本輪仍未取得人工確認。
- [ ] A5c：在 `l1-10` 任務頁聽裝置 TTS 的 `eight / eighteen` 對比，記錄裝置與語音名稱；此結果不歸類為固定音檔 QA。
- [x] A6a：PWA 本地版號已同步為 `2026.09.29.4`；桌面課程頁、播放器及四種聲線選單已檢查。
- [x] A6b：正式站 390×844 瀏覽器模擬檢查 U01–U04 課程頁，並檢查播放器（U01、U03）及聲線選單；內容寬度均為 390px，未發現水平溢出，代表畫面已目視檢查。
- [ ] A6c：實體手機、Safari／iOS 與 Android 硬體 QA 未執行；模擬 viewport 不等於真機觸控／語音檢查。
- [x] A7：SDD、devlog、know-how、程式／資料、測試與工程索引互相可追溯。
- [x] A8：commit `e52e666` 已推送 `main` 並部署至 Firebase Hosting；正式站版號、課程頁、更新切換與代表音檔端點 smoke test 通過。

施工節點與實際聽評結果見 [ENG-008 施工紀錄](../devlog/2026-09-29-little-green-book-audio.md)。

聽評空白表見[U01–U04 音檔人工聽評表](../research/audio-listening-review-template.md)；表單本身不代表已完成聽評。

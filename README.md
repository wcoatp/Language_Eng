# Echo — 英語聽說訓練 PWA

從「聽得懂」練到「說得出」。可安裝到電腦、平板、手機,離線可用,核心功能不需要任何 API。

靈感來自 [人人都能用英語](https://github.com/ZuodaoTech/everyone-can-use-english) 與「一千小時」的訓練哲學:
不背方法論,直接用真實內容練;訓練單位是**句子**不是單字;進度就是**累積時數**。

---

## 訓練循環

每個句子都走同一條路,重點在第三步:

```
① 原速盲聽        不顯示文字,先讓耳朵自己解碼
② 慢速 (70/55/45%)  聽不懂就放慢,把每個字抓出來
③ 回到原速 ★      關鍵一步 — 把慢速解析出的內容對回真實語流
④ 對答案          顯示英文、中文與連讀提示
⑤ 跟讀錄音        錄下自己的聲音
⑥ 原音 / 我的 A/B 比對 + 語音辨識比對分數
⑦ 自評三選一 → 進入間隔複習佇列
```

沒掌握的句子隔天會再出現(SM-2 間隔複習),掌握的句子間隔逐次拉長。

## 功能

| | 說明 | 需要 API? |
|---|---|---|
| **聽力訓練** | 上面的七步循環,108 課 1840 句 | 否 |
| **每日課程** | 每日約 500 字原創故事,同一主題可連載 1–3 日 | 否 |
| **連續播放** | 完整課文或自訂任意多句,可調速度與句間停頓 | 否 |
| **真人錄音課程** | 60 課取自 VOA 公有領域錄音,附中文與逐句時間軸 | 否 |
| **多口音朗讀** | 美/英/澳/印/愛爾蘭/南非/加拿大/紐西蘭,可變速 | 否 |
| **跟讀評分** | 瀏覽器內建語音辨識,逐字標出漏掉的詞 | 否 |
| **間隔複習** | 聽力優先:先播再顯示答案 | 否 |
| **角色扮演對話** | app 唸一角,你唸另一角,辨識比對 | 否 |
| **匯入文章** | 貼上任何英文,自動切句與判定難度 | 否 |
| **課程包匯入** | 把自己的影片/podcast 在 Mac 切成課程,AirDrop 到手機 | 否 |
| **YouTube 精聽** | 嵌入官方播放器做變速與單句循環,不下載任何內容 | 否 |
| **AI 備課** | 匯入時順便產生翻譯、連讀提示、理解測驗 | 是(只跑一次) |
| **自由對話** | 開口即興聊天,附中文即時糾正 | 是 |
| **進度追蹤** | 一千小時計數、連續天數、12 週熱力圖 | 否 |

## 課程內容

108 課、1840 句,難度 L1 到 L5 遞增。分成兩類:

**原創課程(39 課)** — 我們自己寫的情境對話、短文與每日故事。其中 18 課內建 11 組預生成語音、涵蓋 8 種口音;
其餘 21 課使用裝置內建英語語音,不增加大型音檔也能立即朗讀與離線使用。

**真人錄音課程(60 課)** — 取自 [VOA Learning English](https://learningenglish.voanews.com)。
VOA 是美國政府作品,**明確屬於公有領域**,可作教育與商業用途重製,註明來源即可 —— 這是唯一能合法內建在
公開 repo 裡的真人素材。涵蓋 Ask a Teacher(聽眾問答)、Words and Their Stories(慣用語)、
Everyday Grammar、Health & Lifestyle、Science & Technology、America's National Parks、
As It Is、American Stories(愛倫坡小說朗讀)與 What It Takes(真人訪談,母語語速)。

每句都有中文翻譯、精確到 0.01 秒的時間軸,以及實測語速(WPM)。

### 每日課程

首頁會依裝置日期顯示當日課程;當天沒有新課時顯示最近一期。`課程 → 日 每日` 可查看完整課表,
每個主題以 1–3 日為一組,每一天有獨立標題、約 500 個英文單字、繁中逐句翻譯、三題理解題,
而且單篇本身都明確分成起、承、轉、合。完整播放一次會標記今日完成,多日故事完成後可直接前往下一日。

首批是 2026-08-06 到 2026-08-14 的 4 個原創主題、共 9 日:

- **The Blue Umbrella Plan / 藍傘共享計畫** — 3 日,從臨時借傘發展成社區互信計畫。
- **A Detour to Remember / 難忘的繞路旅行** — 2 日,兄妹在錯過轉車後設法趕到燈塔。
- **A Roof with a Purpose / 讓屋頂有新用途** — 2 日,辦公室團隊把強風造成的失敗變成更可靠的設計。
- **The Recipe in the Recording / 錄音裡的食譜** — 2 日,家人從舊手機聲音追查一份未完成的食譜。

課名只參考《大家說英語》公開目錄常見的短、具體、生活化節奏,不使用它的文章、情節或原標題。
研究來源包括 [2026 年 5 月](https://shop.studioclassroom.com/km/news/2881)、
[6 月](https://shop.studioclassroom.com/km/news/2889)、[7 月](https://shop.studioclassroom.com/km/news/2897)及
[8 月官方目錄](https://lt.studioclassroom.com/default.php)。完整原創規範、JSON schema 與發布流程見
[每日課程編輯規範](docs/daily-curriculum.md)。

### 難度怎麼判定

合成課程用文字判定(句長 + 用字頻率)。真人錄音不能只看文字 —— VOA 刻意使用有限詞彙,
但**用母語語速講出來**,所以純文字評分會把母語語速的訪談判成初級。真人課程改用
`scoreListening()`:文字難度與實測語速各佔一半。結果是 L2 平均 118 WPM(教學語速)、
L4 平均 178 WPM(真人訪談),階梯才符合耳朵實際的負擔。

---

## 安裝

網頁版直接用瀏覽器開,要安裝成 app:

- **iPhone / iPad** — Safari 開啟 → 分享 → 加入主畫面
- **Mac (Safari)** — 檔案 → 加入圖庫 / 加入 Dock
- **Windows / Mac (Chrome / Edge)** — 網址列右側的安裝圖示
- **Android** — Chrome 選單 → 安裝應用程式

安裝後離線可用,學習紀錄存在裝置本機。

### iOS 注意

iOS 上語音辨識(跟讀評分、口說對話)偶爾不穩,這是 Safari 的已知限制。
聽力訓練、變速、跟讀錄音與 A/B 比對都不受影響。真的卡住時可以改用鍵盤的麥克風聽寫輸入。

若朗讀沒聲音,到「設定 → 輔助使用 → 朗讀內容 → 語音」下載英語語音,音質也會好很多。

---

## 自由對話設定(選用)

自由對話用你自己的 API key,金鑰只存在這台裝置的 IndexedDB,直接送到你選的服務商,**不經過任何中間伺服器**。
語音辨識與朗讀仍然免費 — 花費只在文字。

設定 → 自由對話 → 選服務商 → 貼上金鑰 → 測試連線。

| 服務商 | 建議模型 | 每百萬 token(輸入/輸出) | 十分鐘對話約 |
|---|---|---|---|
| DeepSeek | V4-Flash | $0.14 / $0.28 | < $0.01 |
| OpenAI | GPT-5.6 Luna | $0.2 / $1.2 | ~$0.01 |
| Anthropic | Haiku 4.5 | $1 / $5 | ~$0.05 |
| Anthropic | Opus 5 | $5 / $25 | ~$0.25 |

日常口語練習用 Luna 或 V4-Flash 就很夠,成本幾乎可以忽略。糾錯要更細膩再往上換。
也可以選「自訂」填任何 OpenAI 相容端點。

> API key 與 ChatGPT / Claude 的訂閱是兩回事,訂閱額度無法用在這裡。

---

## 開發

沒有建置步驟,純靜態檔案。

```bash
python3 -m http.server 8000     # 或任何靜態伺服器
open http://localhost:8000
```

Service worker 需要 `http://localhost` 或 HTTPS,用 `file://` 開會少掉離線功能。

### 測試與內容驗證

測試使用 Node 內建的 test runner,不需要安裝相依套件:

```bash
npm run syntax       # 解析全部 JS 模組,不執行瀏覽器程式碼
npm test             # 純函式單元測試
npm run validate     # 課程、索引、音訊 manifest 與 MP3 完整性
npm run check        # 依序執行上面三項;CI 也跑這個命令
```

`validate` 是唯讀檢查。它會確認課程格式與 `content/index.json` 一致、每個真人課都有完整原音、
預生成語音課都有全部 11 組語音,並檢查 manifest 中每一段音檔都存在、磁碟上也沒有未登記的 MP3。
標記為 `preGeneratedAudio: false` 的裝置語音課則不應出現在音訊 manifest。每日課另會檢查真實日期、
450–550 字、24–40 句、逐句中文、起承轉合、三題理解題、系列日序與連續日期,並拒絕直接重用參考課名。
推送與 pull request 會透過 GitHub Actions 自動執行 `npm run check`。

### 從真人素材建立課程

`tools/align-media.mjs` 是共用引擎:吃任何影音檔或網址,用 whisper.cpp 產生**逐字時間戳**,
切成句子、用 ffmpeg 裁成單句音檔,輸出課程。

一次性安裝:

```bash
brew install whisper-cpp ffmpeg
mkdir -p models && curl -L -o models/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
```

兩種輸出模式,差別是法律上的:

```bash
# repo 模式 — 寫進 content/,會被公開發布。只能用在你有權重製的素材。
node tools/fetch-voa.mjs --list          # 看有哪些 VOA 系列
node tools/fetch-voa.mjs --plan          # 建立整套策展課程
node tools/fetch-voa.mjs --series what-it-takes --count 2

# pack 模式 — 產生 .echopack,只留在你的裝置上。你自己的電影、影集、podcast 用這個。
node tools/align-media.mjs ~/Movies/episode.mkv --title "某某影集 S01E01" --mode pack
```

`.echopack` 用 AirDrop 傳到 iPhone,在 app 的「課程 → 匯入」選檔即可。
音檔存進該裝置的 IndexedDB,**不上傳、不進版控**(`.gitignore` 已排除 `*.echopack`)。

M4 Max 上 15 分鐘的音檔約一分鐘轉完。

### 加新課程

把 JSON 放進 `content/lessons/`,然後重建索引:

```bash
node tools/build-index.mjs
```

驗證會檢查 id 與檔名一致、句子編號連續、對話有 speaker、標點是純 ASCII(彎引號會讓語音引擎念錯)。

課程 JSON 格式:

```json
{
  "id": "l1-01",
  "title": "Meeting Someone New",
  "titleZh": "初次見面",
  "level": 1,
  "type": "dialogue",
  "topic": "daily",
  "preGeneratedAudio": false,
  "summaryZh": "情境說明",
  "sentences": [
    { "id": "s1", "speaker": "A", "text": "Hi, I'm Ben.", "zh": "嗨,我是 Ben。", "note": "選填的連讀提示" }
  ],
  "questions": [
    { "q": "What is his name?", "options": ["Ben", "Dan", "Ken"], "answer": 0 }
  ]
}
```

`type: "article"` 時省略 `speaker`。`note` 只在真的有連讀/弱讀特徵時才寫。
新課若尚未生成 11 組音檔,請保留 `preGeneratedAudio: false`,App 會自動使用裝置語音。

每日故事還要加入 `daily` 與 `storyArc` metadata,並遵守約 500 字與 1–3 日系列規則。完整格式與編輯檢查表見
[docs/daily-curriculum.md](docs/daily-curriculum.md)。

### 預生成高音質語音

內建語音品質因裝置而異,手機上尤其明顯。專案已經預先產好 11 組音檔並一起版控:

- **edge-tts 8 組** — 美、英、澳、印、愛爾蘭、南非、加拿大、紐西蘭;清晰教學語速
- **Kokoro 2 組** — 美式、英式;自然對話語速
- **Chatterbox 1 組** — 美式;語氣起伏較大、語速較快

所以手機平板打開就是一致的高音質 — 不需要自己跑任何東西。真人錄音課固定播放原音,
不會套用合成語音。

要新增課程或其他口音時再跑產生器。edge-tts 使用輕量的專案 venv:

```bash
python3 -m venv .venv
.venv/bin/pip install edge-tts
```

需要重新生成 Kokoro 或 Chatterbox 時,另外建立神經語音環境(套件較大):

```bash
python3.11 -m venv .venv-tts
.venv-tts/bin/pip install kokoro chatterbox-tts
```

之後直接執行需要的語音集即可:

```bash
npm run audio                                             # edge 美式 + 英式
node tools/generate-voices.mjs --list                     # 列出 11 組語音
node tools/generate-voices.mjs --voice edge-au,edge-in    # 產生指定語音
node tools/generate-voices.mjs --voice kokoro-us --force  # 強制重做一組
```

已存在的檔案會跳過,所以加新課時只會產生缺的部分。對話課的 A/B 角色會自動用不同性別的聲音,
語速也依課程難度調整(L1 慢 18%,L5 快 6%)。

沒有音檔的口音或課程仍然可用,自動改用裝置內建語音 —— 匯入的文章就是走這條路。

### 重畫圖示

```bash
node tools/make-icons.mjs
```

---

## 部署

專案目前設定部署到 Firebase Hosting 專案 `echo-english-20260814`:

```bash
npm run deploy
```

部署前會自動執行完整測試與內容驗證。`firebase.json` 只發布 PWA 執行需要的靜態檔案;
本機模型、Python 環境、測試與開發工具不會上傳。

也可以推上 GitHub Pages:選 `main` / `root` 即可。全部路徑都是相對路徑,子目錄部署不會壞。

## YouTube 精聽

「課程 → ▶ YouTube」可以把任何 YouTube 英語教學影片變成精聽教材。
**不下載任何內容** —— 嵌入官方播放器,用 IFrame API 控制單句循環與變速,創作者照樣拿到觀看數。

逐字稿:在電腦版 YouTube 影片下方點「⋯ 更多 → 顯示轉錄稿」,整份複製貼上即可(含時間碼最好)。

> iOS 上 YouTube 播放器常常不接受變速(官方文件也說 `setPlaybackRate` 不保證生效)。
> app 會實際偵測並直接告訴你,不會假裝有放慢。需要慢速練習就用真人錄音課。

## 隱私

- 學習紀錄、錄音、匯入的文章、API key 全部存在瀏覽器本機的 IndexedDB
- 錄音只用於 A/B 比對,不會離開裝置
- 只有開啟自由對話或 AI 備課時才會發出網路請求,對象是你自己選的服務商
- 設定裡可以匯出備份(不含 API key)

## 技術

原生 ES modules,沒有框架、沒有相依套件、沒有建置流程。
Web Speech API(朗讀 + 辨識)、MediaRecorder(跟讀)、IndexedDB(紀錄)、Service Worker(離線)。

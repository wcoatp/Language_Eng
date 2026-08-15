# 每日課程編輯規範

Echo 的每日課程是一日一篇、約 500 個英文單字的原創故事。每篇本身都有起承轉合；同一主題可連載 1–3 日，但每天都必須有自己的事件、轉折與小結，不能只是把一篇文章任意切開。

## 標題研究與原創界線

命名節奏參考《大家說英語》公開目錄與官方出版頁，而不是文章內容：

- [2026 年 5 月官方預覽](https://shop.studioclassroom.com/km/news/2881)
- [2026 年 6 月官方預覽](https://shop.studioclassroom.com/km/news/2889)
- [2026 年 7 月官方預覽](https://shop.studioclassroom.com/km/news/2897)
- [2026 年 8 月官方目錄](https://lt.studioclassroom.com/default.php)

從這四個月 53 個公開標題觀察到的風格：英文標題多為 2–6 字，以短名詞片語、動作、生活問句、簡單祈使句或「人物：亮點」呈現；題材具體、語氣友善，通常只承諾一個生活事件。Echo 沿用這些編輯原則，但不重用原標題、角色、情節、句子或練習題。

`tools/daily-reference-titles.mjs` 保存公開標題的防重複清單。內容建置與驗證會拒絕完全相同的英文日標題或系列標題。

### Echo 標題規則

1. 英文日標題以 2–6 字為優先，最多 8 字。
2. 標題要能看出具體事件或疑問，避免過大的百科題目。
3. 問號與驚嘆號可以增加活力，但不應每篇都使用。
4. 中文副標可補充場景與情緒，不必逐字翻譯，也不能提前揭露結局。
5. 多日主題同時保留系列標題與每日獨立標題，不使用只有 `Part 1`、`Part 2` 的名稱。

## 每篇內容規格

- 450–550 個英文單字，編輯目標 480–520 字。
- 編輯目標約 28–36 句（技術容許 24–40 句），每句都有完整繁體中文翻譯。
- L2–L3 優先：句子適合逐句精聽，但全文仍要像自然故事。
- 固定三題理解題：明確資訊、因果或推論、人物選擇或主旨。
- 英文使用 ASCII 引號與連字號，避免語音引擎誤讀智慧標點。
- 首批使用 `preGeneratedAudio: false`，由裝置語音朗讀；日後可以生成高品質音檔。

### 起承轉合

| 段落 | 作用 | 常見內容 |
|---|---|---|
| 起 `setup` | 建立人物、場景與目標 | 誰想完成什麼，為什麼今天重要 |
| 承 `development` | 增加行動與阻力 | 嘗試、誤會、限制或新的線索 |
| 轉 `turn` | 改變人物原先判斷 | 意外、選擇、真相或失敗 |
| 合 `resolution` | 回應轉折並留下餘味 | 結果、人物改變與可帶走的想法 |

多日單元也要有跨日弧線：第一日建立目標，第二日擴大問題或改變理解，第三日呈現選擇的後果與收束。即使是三日故事，每一天仍必須完整走過一次小型起承轉合。

## JSON 格式

```json
{
  "id": "daily-2026-08-14",
  "title": "The Recipe's Last Line",
  "titleZh": "食譜的最後一句",
  "level": 3,
  "type": "article",
  "topic": "science",
  "summaryZh": "不揭露結局的中文故事摘要。",
  "preGeneratedAudio": false,
  "daily": {
    "date": "2026-08-14",
    "seriesId": "recipe-in-the-recording",
    "seriesTitle": "The Recipe in the Recording",
    "seriesTitleZh": "錄音裡的食譜",
    "day": 2,
    "totalDays": 2
  },
  "storyArc": {
    "setup": "s1",
    "development": "s8",
    "turn": "s17",
    "resolution": "s25"
  },
  "sentences": [
    { "id": "s1", "text": "The story begins here.", "zh": "故事從這裡開始。" }
  ],
  "questions": [
    { "q": "What changed?", "options": ["A", "B", "C"], "answer": 0 }
  ]
}
```

`storyArc` 的值是各段第一句的 ID；四個標記必須依序出現，`setup` 必須從 `s1` 開始。

## 發布流程

1. 依日期建立 `content/lessons/daily-YYYY-MM-DD.json`。
2. 執行 `npm run index` 產生含日期、系列與實際字數的摘要。
3. 執行 `npm run check`；它會檢查真實日期、字數、中文翻譯、故事四段、理解題、系列日序、連續日期及標題防重複。
4. 人工閱讀英文與中文，確認單篇和跨日故事都自然，因為結構檢查無法替代編輯判斷。
5. 執行 `npm run deploy` 發布到 Firebase Hosting。

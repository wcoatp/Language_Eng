# 工程索引

本索引是 Echo 後續施工的入口。流程：SDD → 施工節點 → 程式與測試 → know-how → 驗收紀錄。

## 功能索引

| 工程 ID | 功能／狀態 | SDD | 程式入口 | 驗證 | 施工／知識 |
|---|---|---|---|---|---|
| ENG-001 | 點字查詞與英中／英英切換：功能已納入 v2026.09.23.3 發布；真機觸控與 Safari／Android 仍待另案實測 | [SDD-001](../sdd/001-word-lookup.md) | [字典核心](../../js/dictionary.js)、[字卡 UI](../../js/word-lookup.js)、[內建詞庫](../../js/dictionary-data.js) | [12 項 Node 測試](../../test/dictionary.test.mjs)、[9 項瀏覽器檢查](../../tools/qa/word-lookup.html)、[驗收範圍與待測](../devlog/2026-09-22-word-lookup.md#需求驗收對照) | [節點紀錄](../devlog/2026-09-22-word-lookup.md)、[know-how](../know-how/word-lookup.md) |
| ENG-002 | 課前預習與餐點售完基礎任務：功能與四組音檔已納入 v2026.09.23.3；真機硬體與人工全音檔聽評仍列限制 | [SDD-002](../sdd/002-lesson-preparation.md) | [學習規則](../../js/learning.js)、[原子儲存](../../js/learning-store.js)、[預習](../../js/views/prepare.js)、[任務](../../js/views/task.js) | [12 項新增 Node 測試](../../test/learning.test.mjs)、[5 項瀏覽器資料庫測試](../../tools/qa/learning.html)、[UI 驗收對照](../devlog/2026-09-22-lesson-preparation.md#需求驗收對照) | [節點紀錄](../../docs/devlog/2026-09-22-lesson-preparation.md)、[know-how](../../docs/know-how/lesson-preparation.md) |
| ENG-003 | 課程補齊、全課預習、完整備份還原與正式發布：v2026.09.23.3 已部署；商用稽核排除 | [SDD-003](../sdd/003-complete-curriculum-backup-release.md) | [自動預習](../../js/learning.js)、[課程載入](../../js/content.js)、[預習 UI](../../js/views/prepare.js)、[完整備份](../../js/backup.js)、[原子還原](../../js/db.js)、[離線固定](../../js/storage.js) | [61 項 Node 測試](../../test/learning.test.mjs)、[備份瀏覽器 QA](../../tools/qa/backup.html)、[內容驗證](../../tools/validate-content.mjs)、[部署 smoke test](../devlog/2026-09-23-complete-release.md#n8-部署後-smoke-test完成) | [節點紀錄](../devlog/2026-09-23-complete-release.md)、[know-how](../know-how/complete-release.md) |
| ENG-004 | 小綠書 U01–U16 依序課程設計：16 單元藍圖與原創 8 回合對話草稿已完成；未加入 App、未發布 | [SDD-004](../sdd/004-little-green-book-curriculum-design.md) | [16 單元設計](../curriculum/little-green-book-unit-sequence.md)；未變更程式 | [覆蓋、回合與既有回歸紀錄](../devlog/2026-09-28-little-green-book-design.md) | [節點紀錄](../devlog/2026-09-28-little-green-book-design.md)、[know-how](../know-how/little-green-book-curriculum.md) |
| ENG-005 | 小綠書 U01–U04 教學審稿與口語增補：詞卡、10–12 回合雙語稿、3 題理解、三層提示及可選自然說法；未加入 App、未發布 | [SDD-005](../sdd/005-little-green-book-u01-u04-editorial.md) | [U01–U04 審稿稿件](../curriculum/little-green-book-u01-u04-editorial.md)；未變更程式 | [內容與口語增補驗收紀錄](../devlog/2026-09-28-little-green-book-u01-u04-editorial.md) | [節點紀錄](../devlog/2026-09-28-little-green-book-u01-u04-editorial.md)、[know-how](../know-how/little-green-book-editorial.md) |
| ENG-006 | 30 分鐘核心課與分層練習：規則涵蓋 115 課；長篇保留全文但聚焦核心句，短課全文納入；v2026.09.29.3 已發布 | [SDD-006](../sdd/006-thirty-minute-core-lessons.md) | [核心計畫](../../js/learning.js)、[課程路線](../../js/views/lesson.js)、[核心／全文精聽](../../js/views/listen.js)、[路由](../../js/app.js) | [全課測試](../../test/lesson-plan.test.mjs)、[初版驗收](../devlog/2026-09-29-thirty-minute-core-lessons.md#n5自動驗證)、[發布紀錄](../devlog/2026-09-29-thirty-minute-core-lessons.md#n7整合發布) | [節點紀錄](../devlog/2026-09-29-thirty-minute-core-lessons.md)、[know-how](../know-how/thirty-minute-core-lessons.md) |
| ENG-007 | 小綠書 U01–U04 App 實作：新增 `l1-08`～`l1-11`、42 句、20 詞、12 題、四組任務及選修口語加強；v2026.09.29.3 已發布，使用裝置語音 | [SDD-007](../sdd/007-little-green-book-u01-u04-app-lessons.md) | [四課資料](../../content/lessons/l1-08.json)、[課程與口語 UI](../../js/views/lesson.js)、[任務](../../js/views/task.js)、[metadata 驗證](../../js/learning.js) | [5 項專屬測試](../../test/little-green-book-lessons.test.mjs)、[73 項 Node 與內容驗證](../devlog/2026-09-29-little-green-book-u01-u04-app-lessons.md#n6自動驗證)、[線上驗收](../devlog/2026-09-29-little-green-book-u01-u04-app-lessons.md#n9部署後-smoke-test) | [節點紀錄](../devlog/2026-09-29-little-green-book-u01-u04-app-lessons.md)、[know-how](../know-how/little-green-book-app-lessons.md) |
| ENG-008 | 小綠書 U01–U04 固定音檔：42 句 × Kokoro／Edge 美英四聲線，168 段；桌面播放器與代表句獲使用者確認，依指示帶明列 QA 限制發布 | [SDD-008](../sdd/008-little-green-book-audio.md) | [四課資料](../../content/lessons/l1-08.json)、[產音器](../../tools/generate-voices.mjs)、[播放 UI](../../js/views/player.js)、[聲線設定](../../js/voices.js) | [課程／manifest 完整性](../../test/little-green-book-lessons.test.mjs)、[音檔驗證、試聽範圍與發布結果](../devlog/2026-09-29-little-green-book-audio.md) | [節點紀錄](../devlog/2026-09-29-little-green-book-audio.md)、[know-how](../know-how/little-green-book-audio.md) |

## 現有系統入口（盤點，不代表已補齊歷史 SDD）

| 系統 | 位置 | 備註 |
|---|---|---|
| 路由／頁面生命週期 | `js/app.js` | 離開頁面需停止語音與清除事件 |
| 課程預覽／精聽／播放 | `js/views/lesson.js`、`listen.js`、`player.js` | ENG-006 提供 30 分鐘核心與全文加強雙路徑 |
| 裝置資料 | `js/db.js`、`store.js` | IndexedDB；學習紀錄不等於查詞次數 |
| 設定／匯出 | `js/views/settings.js`、`js/backup.js` | 完整資料備份與原子還原；API key／離線音檔排除 |
| 版本／離線 | `js/version.js`、`sw.js`、`js/pwa-update.js` | 改 shell 時需保持資源與版本一致 |
| 內容品質 | `tools/validate-content.mjs`、`test/` | `npm run check` |
| 每日課程編輯 | [規範](../daily-curriculum.md) | 不是全專案 SDD |
| 課程設計提案 | [2026-09-22 提案](../proposals/2026-09-22-vocabulary-and-foundation-dialogues.md) | A 由 ENG-002、B/C 由 ENG-003 實作；其他新情境依 ENG-004 設計稿另案實作 |
| 小綠書全書設計 | [U01–U16 第一版](../curriculum/little-green-book-unit-sequence.md) | 依 PDF 順序設計；16 個對話草稿非已上線課程 |
| 小綠書首批課程 | [U01–U04 詳稿與口語說法](../curriculum/little-green-book-u01-u04-editorial.md)、[實作 SDD](../sdd/007-little-green-book-u01-u04-app-lessons.md)、[音檔 SDD](../sdd/008-little-green-book-audio.md) | 已實作為 `l1-08`～`l1-11`；四組合成音檔已本地產出，真人聽評待完成 |

## 紀錄原則

- 每次工程有穩定 ID；新增需求先補規格，不用施工紀錄代替規格。
- 工程完成僅表示本地驗收狀態；commit、push、deploy 分別記錄。
- 既有歷史沒有的紀錄不回填成「當時已執行」。

## 後續入口

- ENG-003 已補齊住宿／邀約課、全課庫預習與備份還原；`e04bd5f` 已推送並部署至 [Firebase Hosting](https://echo-english-20260814.web.app)。
- 後續可另案做真機觸控選字、Safari／Android 語音、人工全音檔聽評；本次已完成 390×844 viewport、伺服器中斷重開與正式站升級驗收。
- 未進行商用整體稽核；內建詞庫覆蓋率、分級英英釋義、專有名詞及詞義編輯介面可另案規劃。
- ENG-004 只完成小綠書 16 單元第一版設計，沒有新的課程 JSON、音檔或部署；下一輪須先審稿，再依單元順序分批立實作 SDD。
- ENG-005 的 U01–U04 審稿已由 ENG-007 轉為四堂正式本地課程；文件仍是內容來源，App JSON 與實際驗收狀態以 ENG-007 為準。
- ENG-006 的 30 分鐘核心規則目前涵蓋全部 115 課；仍需用真人完成時間校準 L1–L5 核心句上限。
- ENG-006／007 已由提交 `e4019c7` 推送並部署至 [Firebase Hosting](https://echo-english-20260814.web.app)，正式站更新提示與 U01 課程頁 smoke test 通過。
- ENG-007 的下一個內容批次是先審 U05–U08，再決定哪些沿用既有課、哪些新增。
- ENG-008 已為四堂課補上 Kokoro／Edge 美式、英式固定合成音檔；使用者已確認四種聲線的代表句。完整人工聽評及 390×844 窄螢幕仍待補，依使用者指示可帶此限制發布；狀態以施工紀錄為準。

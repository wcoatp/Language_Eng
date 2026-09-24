# 工程索引

本索引是 Echo 後續施工的入口。流程：SDD → 施工節點 → 程式與測試 → know-how → 驗收紀錄。

## 功能索引

| 工程 ID | 功能／狀態 | SDD | 程式入口 | 驗證 | 施工／知識 |
|---|---|---|---|---|---|
| ENG-001 | 點字查詞與英中／英英切換：本地首版完成；未發布 | [SDD-001](../sdd/001-word-lookup.md) | [字典核心](../../js/dictionary.js)、[字卡 UI](../../js/word-lookup.js)、[內建詞庫](../../js/dictionary-data.js) | [12 項 Node 測試](../../test/dictionary.test.mjs)、[9 項瀏覽器檢查](../../tools/qa/word-lookup.html)、[驗收範圍與待測](../devlog/2026-09-22-word-lookup.md#需求驗收對照) | [節點紀錄](../devlog/2026-09-22-word-lookup.md)、[know-how](../know-how/word-lookup.md) |
| ENG-002 | 課前預習與餐點售完基礎任務：本地功能與四組音檔完成、整體 check 通過；真機／離線及全音檔聽評待驗，未發布 | [SDD-002](../sdd/002-lesson-preparation.md) | [學習規則](../../js/learning.js)、[原子儲存](../../js/learning-store.js)、[預習](../../js/views/prepare.js)、[任務](../../js/views/task.js) | [12 項新增 Node 測試](../../test/learning.test.mjs)、[5 項瀏覽器資料庫測試](../../tools/qa/learning.html)、[UI 驗收對照](../devlog/2026-09-22-lesson-preparation.md#需求驗收對照) | [節點紀錄](../devlog/2026-09-22-lesson-preparation.md)、[know-how](../know-how/lesson-preparation.md) |
| ENG-003 | 課程補齊、全課預習、完整備份還原與正式發布：完整 check 與本地 QA 完成；準備 commit／push／deploy；商用稽核排除 | [SDD-003](../sdd/003-complete-curriculum-backup-release.md) | [自動預習](../../js/learning.js)、[課程載入](../../js/content.js)、[預習 UI](../../js/views/prepare.js)、[完整備份](../../js/backup.js)、[原子還原](../../js/db.js)、[離線固定](../../js/storage.js) | [61 項 Node 測試](../../test/learning.test.mjs)、[備份瀏覽器 QA](../../tools/qa/backup.html)、[內容驗證](../../tools/validate-content.mjs)、[驗收紀錄](../devlog/2026-09-23-complete-release.md#n6-自動與瀏覽器驗收完成) | [節點紀錄](../devlog/2026-09-23-complete-release.md)、[know-how](../know-how/complete-release.md) |

## 現有系統入口（盤點，不代表已補齊歷史 SDD）

| 系統 | 位置 | 備註 |
|---|---|---|
| 路由／頁面生命週期 | `js/app.js` | 離開頁面需停止語音與清除事件 |
| 課程預覽／精聽／播放 | `js/views/lesson.js`、`listen.js`、`player.js` | ENG-001 首批整合範圍 |
| 裝置資料 | `js/db.js`、`store.js` | IndexedDB；學習紀錄不等於查詞次數 |
| 設定／匯出 | `js/views/settings.js` | 目前有匯出，沒有完整備份還原介面 |
| 版本／離線 | `js/version.js`、`sw.js`、`js/pwa-update.js` | 改 shell 時需保持資源與版本一致 |
| 內容品質 | `tools/validate-content.mjs`、`test/` | `npm run check` |
| 每日課程編輯 | [規範](../daily-curriculum.md) | 不是全專案 SDD |
| 課程設計提案 | [2026-09-22 提案](../proposals/2026-09-22-vocabulary-and-foundation-dialogues.md) | ENG-002 已實作第 10 節最小版；住宿／邀約與擴充課程仍待另案 |

## 紀錄原則

- 每次工程有穩定 ID；新增需求先補規格，不用施工紀錄代替規格。
- 工程完成僅表示本地驗收狀態；commit、push、deploy 分別記錄。
- 既有歷史沒有的紀錄不回填成「當時已執行」。

## 後續入口

- ENG-002 音檔阻礙已解除：使用者同意後僅傳送 `l1-07` 的 12 句原創英文，兩組 Edge 音檔與原有 Kokoro 共 48 段驗證通過。下一步仍需真機／斷網及人工聽評；提交、推送、部署另待當次授權。
- ENG-003 已補齊住宿／邀約課、全課庫預習與備份還原；commit、push、deploy 與部署後 smoke test 仍待本次節點完成後回填。
- ENG-001 發布前仍需真機觸控選字、Safari／Android 語音、實際斷網重開 PWA 與正式站升級驗收。
- 未進行商用整體稽核；內建詞庫覆蓋率、分級英英釋義、專有名詞及詞義編輯介面可另案規劃。

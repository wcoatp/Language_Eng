# ENG-003 know-how：全課預習、備份與發布

對應 [SDD](../sdd/003-complete-curriculum-backup-release.md)、[施工紀錄](../devlog/2026-09-23-complete-release.md)。

- 全課「都有入口」不等於全課「都有人工翻譯」。資料不足時介面必須把自動候選與人工內容分層，不能用占位字冒充詞義。
- 自動預習版本需同時綁定規則版號與課文 hash；只用固定版號會讓課文改過仍沿用舊自評，只用時間戳則每次載入都會重置。
- 「打開查詞視窗」不等於「已取得詞義」。解鎖自評要接在成功的本地／快取／線上查詢 callback，不能接在按鈕 click。
- 備份功能只有匯出不算可復原；還原也不能逐 store 清除後分開寫入，否則中途失敗會得到半套資料。
- IndexedDB transaction 內若同步驗證或 `put()` 立即拋錯，要主動 `abort()`；只等待 `onerror` 不能保證已清除的資料會回滾。
- JSON 備份二進位資料要保留 Blob MIME type 與 ArrayBuffer 類型，還原前限制檔案大小、store 白名單、主鍵形狀與危險物件鍵。
- 發布驗收需區分手機 viewport、伺服器斷線模擬與真實手機硬體，三者證據不同。
- 「下載離線音檔」不代表課程能離線開啟。初次造訪可能在 service worker 接管前完成課程 fetch，因此下載動作必須主動固定課程 JSON（以及供導覽使用的索引），不能只依賴 runtime cache。
- 更新提示必須用前一版實際升級到新版本驗證；直接開原始 `version.js` 只證明檔案內容，不證明 waiting worker、提示與重新載入流程。

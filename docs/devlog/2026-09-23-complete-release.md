# ENG-003 施工紀錄

對應 [SDD-003](../sdd/003-complete-curriculum-backup-release.md)。日期 2026-09-23。

## N1 規格與盤點（完成）

- 使用者要求除商用外把先前列項依序完成，明確包含 commit、push、部署；附件 PDF 仍排除。
- HEAD `873d1d9`，`main` 與 `origin/main` 起點一致；ENG-001／002 全部仍是工作區未提交變更，需保留並在本次完整驗收後一起提交。
- 目前 109 課／1852 句；人工預習僅 3 課。內建詞庫 110 詞，若只依它選詞有 68 課不足 6 詞、部分為 0，因此全課功能不能假裝每課都有人工雙語內容。
- 既有匯出包含主要學習資料但沒有還原，且未包含 recordings／chats／videos；IndexedDB 有七個 stores，可用單一 transaction 做原子全量替換。
- 發布目標為 `origin` 的 `main` 與 Firebase project `echo-english-20260814`。所有寫入遠端動作排在驗收之後。
- 真實手機、Safari／Android 硬體不在此桌面環境中；將做 390px 與實際中斷本機伺服器的離線 PWA 驗收，紀錄不可改寫成真機通過。

## N2 新課與資料關聯（完成）

- 新增 `l2-07`「The Room Is Not Ready」：12 句、6 個人工預習詞、3 題理解題與 3 回合換條件任務，前置課為 `l1-04`。
- 新增 `l2-08`「Can We Choose Another Day?」：10 句、6 個人工預習詞、3 題理解題與 3 回合換條件任務，前置課為 `l2-01`。
- 把 `l1-05 → l1-07`、`l1-04 → l2-07`、`l2-01 → l2-08` 寫成內容資料關聯，頁面不再硬編特定課號。
- 兩課內容為本工程原創；沒有把附件 PDF 放進課程檔、版本控制或部署。

## N3 全課預習（完成）

- `getLesson()` 對沒有人工 `learning` 的課，在本機依完整詞界、固定停用詞、重複與課文位置產生 4–6 個穩定候選；人工內容原樣優先。
- 自動版本含課文 hash，課文或規則更新時才重置該課預習；111 個內建課程測試皆產生 4–6 項且 `learningProblems=[]`。
- 有內建英中／英英資料的候選直接顯示；未收錄候選維持「需查詞確認」，只有成功取得字典結果後才解鎖文字理解自評，沒有用占位文字冒充翻譯。

## N4 完整備份還原（完成）

- 新備份涵蓋七個 IndexedDB stores，Blob／ArrayBuffer 轉成帶型別 base64；匯出永遠移除 API key，還原保留目前裝置 API key。
- 接受舊版 2026-09-22 學習紀錄匯出；拒絕超大、未知 store、錯誤主鍵與危險物件鍵。
- 寫入以單一 readwrite transaction 清除並重建所有 stores。獨立臨時 IndexedDB 的瀏覽器 QA 通過「完整替換」與「錯誤時全部回滾」，沒有讀寫 Echo 使用者資料。
- 設定頁實際按下匯出後顯示成功訊息；自動化瀏覽器未攔到 object URL 的 download event，因此只把 UI 成功訊息與純函式 round-trip 列為證據，不杜撰下載事件。

## N5 音檔、索引與版本（完成）

- 索引重建為 111 課／1874 句；L1×7、L2×39、L3×45、L4×15、L5×5。
- 本機離線 Kokoro 已只為 `l2-07`／`l2-08` 產生美式與英式 44 段。`ffprobe` 全部大於 0 秒（1.048–2.744 秒）；Whisper 抽驗兩課兩口音，句子內容正確，姓氏 `Lin` 被辨為同音 `Lynn`。
- 使用者於 2026-09-24 明確同意把這 22 句原創英文傳給 Microsoft Edge 語音服務；只生成 `l2-07`／`l2-08` 的 `edge-us`、`edge-gb` 各 22 段，共 44 段。沒有傳送附件、個資或學習紀錄，也沒有使用 `--force` 重製其他課。
- Edge 與 Kokoro 四組新課音檔共 88 段均通過 `ffprobe`（1.048–5.568 秒）；Edge 四段、Kokoro 四段 Whisper 抽驗句子內容正確，`Lin` 的辨識差異僅為同音 `Lynn`。
- shell 最終暫定 `v2026.09.23.3`。`.1`、`.2` 的升級提示與使用者決定重新載入均實際通過；`.3` 是離線修正後版號，發布前仍會再做一次最終版本核對。

## N6 自動與瀏覽器驗收（完成）

- Node：61/61 通過；JavaScript 語法 60 模組通過；`git diff --check` 通過。
- 完整 `npm run check` 已通過：111 課／1874 句、11 組 voice set、12516 段音檔；內容驗證與 manifest 無缺口。
- 桌面瀏覽器驗證設定、全課自動預習、未查詞自評鎖定、兩門新課詳情／任務、備份入口與 `v2026.09.23.2` 更新提示；Edge 完成後只需再核對最終 `.3` shell。
- 390×844 viewport 驗證 `l2-08` 詳情與任務均無橫向溢出；隔離在 `localhost` 的學習資料完成 10 句跳過、3 題理解測驗 3/3 及完成頁，不影響原站資料。
- 第一次伺服器中斷測試發現「下載離線使用」只有音檔、沒有課程 JSON，重開顯示 `Failed to fetch`。在 `v2026.09.23.3` 改成同時固定課程 JSON 與共用索引後重測：伺服器停止時可重開 `l2-08`、進入精聽並播放已下載音檔；這次結果才列為通過。
- 真實 iPhone／Android 硬體、Safari 與實際飛航模式未執行；不可把 viewport 與本機斷線證據改寫成真機通過。

## N7 commit／push／deploy（完成）

- 兩課 Edge 核心聲音與完整 `npm run check` 已通過；staged 清單核對沒有 PDF，附件仍留在工作區未追蹤狀態。
- commit：`e04bd5fb577198bc2eea2e7c3b40d870be12dc60`（`feat: complete curriculum learning prep and backups`）。
- push：`origin/main` 已核對同一 SHA。
- deploy：Firebase project `echo-english-20260814`，Hosting URL `https://echo-english-20260814.web.app`，上傳與 release 均成功。

## N8 部署後 smoke test（完成）

- 正式站設定頁由舊版 `v2026.08.17.1` 顯示新版已就緒，按「重新載入更新」後確認 `v2026.09.23.3 · 已是最新版`。
- `#/lesson/l2-07` 顯示課名、課前字詞、換條件任務、`l1-04` 前置課與下載入口；`#/lesson/l2-08` 同樣顯示課名、課前字詞、換條件任務與 `l2-01` 前置課。
- 正式站兩頁瀏覽器主控台沒有 error／warning；直接頁面載入證實課程 JSON 路徑可用，內容驗證已證實四組新課音檔與 manifest 對齊。
- 未宣稱真實 iPhone／Android、Safari 或飛航模式通過；本地 390×844 與伺服器中斷快取驗收已完成。商用授權總稽核仍明確不在本工程。

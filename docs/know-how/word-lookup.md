# ENG-001 know-how：課文點字查詞

對應：[SDD](../sdd/001-word-lookup.md)、[施工紀錄](../devlog/2026-09-22-word-lookup.md)。

## 施工前已確認

- 課文列本來綁定整句播放；子元素查詞必須阻止冒泡，並提供清楚的整句播放入口。
- CSS 蓋住文字不是查詞授權：精聽盲聽階段不可建立可查單字按鈕。
- `say()` 帶 lessonId/sentenceId 會優先找整句音檔；單字發音不要傳這些 ID。
- 單字字典無法可靠判定課文詞義。先用精確 lessonId/sentenceId 覆寫，再顯示一般詞條，不能把第一個字典義標成「本句意思」。
- 英文釋義與中文翻譯表數量通常不同，不可按索引 zip 成雙語對照。
- API 的 HTML 只用於抽取文字，不插入文件；來源引文、媒體與指示均不執行。
- 學習匯出採明確欄位清單，增加收藏要同步增加匯出欄位；不因 kv 保存成功就假設已備份。

## 實作／驗證後的補充

### 字典抽取

- Wiktionary heading 有新舊兩種格式：`div.mw-heading > h2#English` 和 `h2 > span#English`。先找真正 section heading 的外層，再遍歷 sibling；只從 id 節點往後走會漏掉整個英文區段。
- 繁簡中文可能同組出現，優先 Hant／Hani；只有 Hans 時保留並標示。翻譯群組和釋義必須各自保留 sense，不假裝一對一。
- `template.innerHTML` 僅在不掛載的 inert DOM 解析；移除例句、引文、script、style，輸出以 `textContent` 建立。這是安全與內容邊界，不是整套商用授權結論。
- 原始片語查詢統一小寫，專名可能不命中。此限制應列在 SDD，未來另做大小寫／專名消歧，不盲目嘗試所有字形。

### 互動與播放

- 原生 dialog 的焦點控制仍可能被自製重繪破壞：focused button 被換掉且新按鈕 disabled 時，焦點會落到 body。每次重繪保留 data-focus；不可聚焦時回關閉鈕。
- 全播放器重繪會讓原字詞 trigger 脫離 DOM。關閉字卡時若 trigger 已不存在，焦點回 `#view`，不要呼叫失效節點。
- 不在每次 selectionchange 自動彈字卡。使用者拖曳完成後提供明確「查選取的字詞」按鈕，且只能同句 1–6 個詞。
- 取消 `say()` 會讓播放迴圈的 await 正常結束，不表示課程已完成。需獨立 paused／repeat flag；句間停頓結束後也要檢查，避免底層自動跑下一句。
- A/B 原音後等待 350ms 再播錄音也是非同步競態：查詞時遞增 compareRun，後續 continuation 先比 token。
- 視覺模糊不等於對螢幕閱讀器隱藏。盲聽答案加 aria-hidden，且不建立可查詞元素。

### 儲存與本機 QA

- 收藏／cache 的讀改寫要序列化，快速換字卡不能互相覆蓋。收藏 id 包含詞＋課＋句，保留不同上下文。
- 本機有舊 worker 時，新 HTTP server／新程式碼不保證瀏覽器已換新 shell。先看實際錯誤與版面，確認 origin；只解除本機測試 worker 並關閉舊頁，不能以清除全部資料作捷徑。
- `tools/qa/word-lookup.html` 可重跑 9 個 DOM 檢查；localhost worker 復原按鈕不刪除學習資料。它不隨 hosting 發布。
- 程式可支援離線不代表真機斷網已驗收。把 fixture／Node 模擬、桌面 UI、真機結果分開記錄，避免把 44 項 Node 測試說成 44 項端到端驗收。
- 根目錄放 PDF 的靜態網站可能隨 hosting 一起公開；部署忽略規則要排除附件，不把「未被 git 追蹤」誤認為「不會部署」。

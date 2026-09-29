# Know-how｜增補原創課程的固定語音

對應 [SDD-008](../sdd/008-little-green-book-audio.md) 與 [施工紀錄](../devlog/2026-09-29-little-green-book-audio.md)。

## 施工注意事項

- 產音工具會排除 `preGeneratedAudio: false` 課程。先確認目標課共有幾句、檔案是否已存在，再明確處理課程狀態；不要讓 manifest 有部分音檔就提前宣稱完整。
- 產音工具會掃描所有可合成課程，但只會建立缺檔。選定核心聲線重跑後，檢查清單應只包含本次目標課的新檔，既有課不得重製或覆蓋。
- 一份對話課 JSON 同時保存 A/B speaker。聲線對應在 `tools/generate-voices.mjs`，新增口音需檢查兩角色是否能區分。
- Edge TTS 將英文句子文字送往 Microsoft 語音服務；Kokoro 本機推論。兩者都輸出合成語音，不能標成真人原音。
- 來源追蹤要分開記：Kokoro 官方模型卡目前標示權重 Apache-2.0；edge-tts 的程式碼授權（主要程式 LGPL-3.0）不代表 Microsoft 線上服務／聲音輸出的條款。引用來源但不推論商用結論。
- `manifest.json` 每個 voice set 儲存該課的 sentence ID 清單。只看音檔總數不夠，應逐課逐聲線確認清單精確等於源句順序。
- `ffprobe` 成功只證明容器可讀且時長有效，不代表唸對、角色好辨、語調自然或學生分得出相近數字。要人工試聽並記錄範圍和未聽項。
- 固定音檔需同步提高 PWA 版本，讓已安裝用戶收到更新；新 lesson JSON 與音檔也要符合目前 Service Worker 的路徑策略。

## 試聽檢查項目

- A/B 男女聲差異是否足以辨認。
- `nine / nineteen`、`eight / eighteen` 的重音與句中辨識度。
- 否定、價錢、尺寸、顏色、`Hang on`、`I'll`、`We're out of` 等關鍵表達。
- Edge 清晰慢速與 Kokoro 自然速度是否都符合 L1 學習目的。
- 口語加強替代句是否仍清楚顯示為裝置語音，不假設已跟著主課產出。

本批 168 段均已通過 ffprobe 和 manifest 完整性驗證，桌面播放器也已讀到 Edge GB 與 Kokoro GB 的本地檔案；人工聽評與窄螢幕檢查仍列為未完成。

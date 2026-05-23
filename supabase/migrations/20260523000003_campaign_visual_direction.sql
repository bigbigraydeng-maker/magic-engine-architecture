-- ============================================================
-- Campaign Visual Direction fields
-- 两层视觉继承体系：MB vi_* 是品牌宪法，Campaign vi_* 是活动专化
-- 全部 nullable，对现有行零影响
-- ============================================================

ALTER TABLE campaign_briefs
  ADD COLUMN IF NOT EXISTS vi_mood          TEXT          NULL,
  -- 本次活动的情绪基调（由 AI 根据 MB + campaign context 生成）
  -- e.g. "秋日古都，晨雾长城，厚重历史感"
  -- e.g. "限时清仓，价格冲击，直接有力"

  ADD COLUMN IF NOT EXISTS vi_color_accent  TEXT          NULL,
  -- 活动专属强调色（必须在 MB 色系内选，或协调延伸）
  -- e.g. "收获金 #C9A84C" / "警示橙 #E8601C"

  ADD COLUMN IF NOT EXISTS vi_specific_dos  TEXT[]        NULL,
  -- 本活动额外视觉要做（追加到 MB vi_dos，不替换）
  -- e.g. ["红叶秋景", "晨雾氛围", "古建特写"]

  ADD COLUMN IF NOT EXISTS vi_specific_donts TEXT[]       NULL,
  -- 本活动额外视觉禁止（追加到 MB vi_donts，不替换）
  -- e.g. ["夏季绿植", "现代城市背景"]

  ADD COLUMN IF NOT EXISTS vi_reference_note TEXT         NULL;
  -- 给内容生成的一句话视觉参考，供 AI 生成图片提示词时使用
  -- e.g. "参考故宫博物院官方摄影，重质感轻商业感，秋季色调为主"

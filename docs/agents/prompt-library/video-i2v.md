# Video I2V Prompt Standards
# 视频 I2V 提示词标准（Seedance 2.0）

> 管理：李白 Agent | 验收：马良 Agent  
> 适用平台：Seedance 2.0 I2V（Image-to-Video，via Atlas Cloud）  
> 版本：v1.0（2026-06-02）

---

## 一、强制三段结构

所有 I2V prompt 必须包含三段，用 ` | ` 分隔：

```
Opening: [开场动作/场景建立，≤50词] | Middle: [情绪高潮/信息传递，≤50词] | Closing: [品牌/情感收尾，≤50词]
```

**每段超过 50 词 = 马良打回，重写。**

---

## 二、规格参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 比例 | 9:16 | 所有 Reels/Stories，不可改 |
| 时长 | 6s | Seedance 2.0 标准时长 |
| 帧率 | 24fps | 默认 |
| 起始帧 | opening_frame_url | 必须配合开场帧提示词 |
| 结束帧 | closing_frame_url（可选）| 配合结束帧提示词 |

---

## 三、Seedance 友好动作描述

### ✅ Seedance 擅长（用这些）
```
slow pan left/right          → 左/右缓慢横移
gentle zoom in/out           → 缓慢推近/拉远
soft focus pull              → 虚化过渡
subtle camera drift          → 轻微镜头漂移
slow reveal from bottom      → 从下往上缓慢显现
person turns to camera       → 人物转向镜头
warm light gradually fills   → 暖光缓慢充满画面
```

### ❌ Seedance 不擅长（避免这些）
```
rapid cuts / fast transitions   → 快速切换（效果差）
multiple people appearing        → 多人同时出现
complex background motion        → 背景复杂运动
text animation                   → 文字动画
extreme close-up then wide       → 极端景别切换
```

---

## 四、三段内容指南

### Opening（开场，0-2s）
目标：钩住注意力，建立场景

```
推荐模式：
- 人物转向镜头，眼神接触（情感连接）
- 产品特写缓慢拉远（好奇心）
- 美食/场景近景慢慢清晰（感官刺激）

禁止：
- 纯静止（浪费开场）
- 太多元素同时运动
```

### Middle（高潮，2-4s）
目标：传递核心信息，情绪峰值

```
推荐模式：
- 人物做关键动作（展示/分享/体验）
- 场景变化（内→外 / 近→远）
- 信息文字配合动作节奏出现（若有文字叠加）
```

### Closing（收尾，4-6s）
目标：品牌记忆 + 行动引导

```
推荐模式：
- Logo/品牌元素淡入
- 人物对镜头微笑/点头（情感确认）
- 场景定格或缓慢虚化（优雅收尾）
```

---

## 五、AU/NZ 场景偏好

```
✅ 咖啡馆室内（木质桌面/自然采光）
✅ 海边/海滩（黄金时段光线）
✅ 城市街头（Melbourne/Auckland 城市感）
✅ 办公室/工作场景（真实感，非精致摆拍）
✅ 家庭厨房/客厅（温暖生活感）

❌ 过于美式的 suburban 郊区
❌ 雪景（不符合大部分 AU/NZ 时段）
❌ 明显的非英语标识
```

---

## 六、完整示例

### 旅游客户（CTS Tours）
```
Opening: Aerial view of turquoise New Zealand lake, camera slowly tilts down to reveal reflection, golden morning light | Middle: Traveler's hand traces map on wooden table, warm café interior, gentle camera drift forward toward map | Closing: CTS Tours logo softly appears over misty mountain landscape, camera gently zooms out
```

### 餐饮客户
```
Opening: Close-up of coffee being poured, steam rising slowly, warm bokeh background | Middle: Barista smiles and turns to camera holding coffee cup, cozy café interior in soft focus behind | Closing: Café name appears with gentle fade, camera pulls back to reveal welcoming storefront exterior
```

---

## 七、马良验收流程

每次 video-i2v.md 更新后：
1. 李白通知马良"提示词标准已更新"
2. 马良用新标准跑一次真实 Seedance 生成
3. 马良评估：三段结构是否体现、动作流畅度、品牌感
4. 马良反馈给李白：通过 or 调整建议
5. 李白更新版本日志

---

## 八、版本历史

| 版本 | 日期 | 变更 | 原因 |
|------|------|------|------|
| v1.0 | 2026-06-02 | 初始建立 | 李白提示词库建立 |

---

## 九、Higgsfield AI 专项（补充）

Higgsfield AI 支持更复杂的运镜，与 Seedance 的核心区别：

| 能力 | Seedance 2.0 | Higgsfield AI |
|------|-------------|---------------|
| 运镜控制 | 基础（pan/zoom/drift）| 高级（轨道/手持/无人机感）|
| 人物一致性 | 中等 | 高（同一人物多镜头）|
| 时长 | 6s | 可达 10s+ |
| 适合场景 | 品牌内容/产品展示 | 叙事短片/人物故事 |

Higgsfield 的提示词标准待马良完成平台研究后更新至 v1.1。

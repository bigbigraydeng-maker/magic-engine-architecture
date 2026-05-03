# Phase 5 部署指南

## 前置条件

- ✅ `npm run test` 通过（16/16）
- ✅ `npm run build` 通过
- ✅ 本地测试完成（见 `PHASE_5_TESTING_CHECKLIST.md`）
- ✅ 代码审查无阻塞问题

---

## 1️⃣ 本地验证

### 1.1 最终构建验证

```bash
# 清理之前的构建
rm -rf .next out node_modules/.cache

# 重新构建
npm run build

# 确保输出中没有 ERRORs（warnings 可以接受）
# 查找输出中的 "✓ Compiled successfully" 或类似成功提示
```

### 1.2 类型检查

```bash
# TypeScript 严格检查
npx tsc --noEmit

# 应输出：No errors ✓
```

### 1.3 测试覆盖率

```bash
npm run test -- --coverage

# 确保覆盖率 >= 80%
# 关注新增文件：toolkit/page.tsx、media-actions.ts 等
```

---

## 2️⃣ Git 工作流

### 2.1 检查改动

```bash
# 查看所有修改的文件
git status

# 确保没有意外改动（如 node_modules、.env 等）
```

### 2.2 查看 diff

```bash
# 对比 main 分支
git diff main

# 关键改动应该包括：
# - src/data/skeletons/agent-pro.ts（新文件）
# - src/app/app/projects/[id]/toolkit/page.tsx（新文件）
# - src/types/merchant-profile.ts（+ hero_image_url 字段）
# - src/lib/generation/media-actions.ts（新 Server Action）
# - src/components/project-sub-nav.tsx（导航更新）
# - src/components/project-workflow-sidebar.tsx（快速链接更新）
# - src/components/RenderMicrosite.tsx（Hero 优先级更新）
# - src/components/UnsplashSearch.tsx（应用到 Hero 按钮）
# - 等等
```

### 2.3 提交更改

```bash
# 暂存所有文件
git add -A

# 提交，遵循 Conventional Commits
git commit -m "feat: add agent-pro template, toolkit page, and unsplash-to-hero integration

- Create Agent Pro skeleton template with stats counter, listings, testimonials
- Create unified toolkit page (/toolkit) consolidating poster, media, social, leads, dashboard
- Implement Unsplash to Hero image application flow
- Update navigation: ProjectSubNav and ProjectWorkflowSidebar
- Add hero_image_url to MerchantProfileV1
- Implement applyImageToHero Server Action
- Update RenderMicrosite Hero priority: hero_image_url > property_promo.image_url > avatar > logo

Closes: #[issue-number-if-applicable]"

# 确保提交信息清晰、准确
```

### 2.4 推送到远程

```bash
# 如果在新分支上（推荐）
git push -u origin feature/phase5-agent-pro-toolkit-unsplash

# 如果在 main 分支，直接推送
git push origin main
```

---

## 3️⃣ GitHub / 代码审查（可选）

### 3.1 创建 Pull Request

如果使用 feature 分支：

```bash
# 用 gh CLI 创建 PR
gh pr create \
  --title "Phase 5: Agent Pro Template + Toolkit + Unsplash Integration" \
  --body "## Summary

- ✅ Created Agent Pro skeleton template (deep blue + orange, 3 color palettes)
- ✅ Created unified Toolkit page (/toolkit) with all tools consolidated
- ✅ Implemented Unsplash to Hero image application flow
- ✅ Updated navigation structure (removed scattered links, added toolkit)
- ✅ Auto-populate merchant profile data in tools (no re-entering)
- ✅ Mobile-first responsive design

## Test Plan

- [ ] Test Agent Pro template creation and rendering
- [ ] Test Toolkit page layout and navigation
- [ ] Test Unsplash search and apply-to-Hero flow
- [ ] Test responsive design (desktop, tablet, mobile)
- [ ] Test auto-fill of merchant profile data
- [ ] Test complete user journey from template selection to publishing
- [ ] Verify build and tests pass

## Build & Test Status

- [x] npm run build passes
- [x] npm run test passes (16/16)
- [x] npm run lint passes
- [x] TypeScript: no errors

Generated with Claude Code"
```

### 3.2 等待审查

- 通知团队成员审查
- 修复任何 review comments
- 获得批准后合并

---

## 4️⃣ 部署到 Production (Render)

### 4.1 准备部署

**确保前置条件**：
- ✅ PR 已合并到 main
- ✅ 本地 main 分支已更新

```bash
# 拉取最新 main
git checkout main
git pull origin main

# 验证本地 main 最新
git log --oneline -5
```

### 4.2 监控 Render 自动部署

HiBiz 在 Render 上配置了自动部署：当 main 分支有新 commit 时，Render 会自动触发构建和部署。

**监控步骤**：

1. **打开 Render Dashboard**：https://dashboard.render.com
2. **找到 "hibiz" 服务**
3. **查看 Deployments 标签**
4. **最新部署应该是**：
   - Commit: "feat: add agent-pro template, toolkit page..."
   - Status: Building → Deployed（约 2-5 分钟）

**等待部署完成的迹象**：
- Status 变为 "Live"
- 右上角显示绿色勾号 ✓
- Logs 中最后一条：`"Build successful"`

### 4.3 构建日志检查

点击最新 Deployment，查看 Build Logs：

```
✓ Step 1/5: Cloning repository...
✓ Step 2/5: Installing dependencies...
✓ Step 3/5: Building application...
✓ Step 4/5: Running tests...
✓ Step 5/5: Deploying...

✓ Live
```

**如果失败**，日志会显示：
```
✗ Build failed
Error: [具体错误信息]
```

**常见错误及解决**：

| 错误 | 原因 | 解决 |
|------|------|------|
| `Cannot find module` | 依赖未安装 | 检查 package.json，确保所有依赖已添加；本地 npm install 验证 |
| `TypeScript compilation failed` | 类型错误 | 本地 `npx tsc --noEmit` 验证，修复后重新推送 |
| `Build takes too long` | 超时 | Render 免费层有构建时间限制；优化构建或升级计划 |
| `Environment variable missing` | 缺少 .env 变量 | 检查 Render 仪表板中的 Environment 设置，确保 `UNSPLASH_ACCESS_KEY` 等已配置 |

---

## 5️⃣ 生产环境验证

### 5.1 访问公网 URL

部署完成后，打开公网网址：

```
https://hibiz.onrender.com
```

或在 Render Dashboard 中点击"Open Website"

### 5.2 验证功能（完整路径测试）

#### 新项目创建流程
1. 登录账户
2. 点击「新建项目」
3. **选择 Agent Pro 模板**（应该可见）
4. 填入基本信息，创建项目
5. 进入项目编辑页面

#### 验证导航
- [ ] 顶部导航：项目、工具箱、数据、线索（整洁，无散乱链接）
- [ ] 左侧边栏：快速链接仅显示「🧰 工具箱」

#### 验证工具箱
1. 点击「工具箱」导航
2. 确认进入 `/toolkit` 页面
3. 商家摘要卡片显示正确
4. 5 个工具卡片显示
5. 点击各卡片，确认链接工作（海报、素材、社媒、线索、数据）

#### 验证 Unsplash 到 Hero
1. 从工具箱进入「素材库」
2. 搜索 Unsplash（如 "luxury property"）
3. 看到搜索结果，每个结果有「⭐ 应用到 Hero」按钮
4. 点击应用
5. 返回项目页面，预览中 Hero 图片已更新
6. 刷新页面，确认图片持久化

#### 验证发布与公网
1. 完成项目编辑（商家信息、图片、模块等）
2. 点击「发布」或「重新发布」
3. 获取公网微站 URL
4. 在新标签页打开 URL
5. 确认 Hero 图片显示、所有模块正常渲染

### 5.3 响应式测试（生产环境）

在公网 URL 上测试：

```bash
# Chrome DevTools 模拟设备
F12 → Toggle Device Toolbar (Ctrl+Shift+M)

# 测试断点
- iPhone SE (375px) - 工具箱卡片应为 1 列
- iPad (768px) - 工具箱卡片应为 2 列
- Desktop (1280px) - 工具箱卡片应为 3 列
```

### 5.4 性能检查（可选）

```bash
# Lighthouse 审计（Chrome DevTools）
F12 → Lighthouse → Generate report

# 关注指标
- First Contentful Paint (FCP) < 2s
- Largest Contentful Paint (LCP) < 2.5s
- Cumulative Layout Shift (CLS) < 0.1
```

---

## 6️⃣ 回滚计划（如遇问题）

如果部署后发现严重问题：

### 6.1 快速回滚（Render）

```bash
# 在 Render Dashboard 中
1. 找到 "hibiz" 服务
2. 点击 Deployments
3. 找到上一个成功的部署
4. 点击"Redeploy"重新部署前一个版本
5. 等待完成
```

### 6.2 本地回滚（如需修复）

```bash
# 如果新发现 bug，需要快速修复
git revert HEAD  # 撤销最新提交
# 或
git reset --soft HEAD~1  # 撤销但保留改动，重新编辑后提交

# 推送修复
git push origin main

# Render 会自动重新部署
```

---

## 7️⃣ 部署后工作

### 7.1 发布公告

通知团队/用户：

```
🎉 HiBiz Phase 5 已发布！

新增功能：
✨ Agent Pro 骨架模板 - 专业经纪人专用
🧰 工具箱 - 所有工具一站式访问，个人信息自动同步
🖼️ Unsplash 到 Hero - 直接搜索和应用高质量图片到网站

改进：
- 简化后台导航，提升用户体验
- 移动端友好的工具箱界面
- 图片搜索和应用流程无缝集成

开始体验：https://hibiz.onrender.com
```

### 7.2 监控与反馈

**部署后第一周**：
- [ ] 监控 Render 服务日志，检查错误
- [ ] 收集用户反馈（Agent Pro 是否好用、图片应用流程是否顺畅等）
- [ ] 检查性能指标（加载时间、错误率）

---

## ✅ 部署完成清单

- [ ] `npm run build` 本地通过
- [ ] `npm run test` 本地通过
- [ ] Git 提交信息清晰准确
- [ ] 代码推送到 main
- [ ] Render 部署完成（Status: Live）
- [ ] 公网 URL 访问正常
- [ ] Agent Pro 模板可选择
- [ ] 工具箱页面显示正确
- [ ] Unsplash 应用到 Hero 工作
- [ ] 响应式设计验证
- [ ] 团队通知已发送

---

## 🆘 问题排查

遇到问题？按以下顺序排查：

1. **本地 `npm run build` 是否通过**？
   - 若否，修复本地错误，重新推送

2. **Render 构建日志中是否有错误**？
   - 查看具体错误，对应修复

3. **公网 URL 是否返回 500 错误**？
   - 检查环境变量（UNSPLASH_ACCESS_KEY 等）
   - 检查数据库连接

4. **功能在生产环境不工作**？
   - 清除浏览器缓存（Ctrl+Shift+Delete）
   - 用隐身模式测试
   - 检查浏览器 Console 是否有 JavaScript 错误

---

## 📚 相关文档

- [`PHASE_5_TESTING_CHECKLIST.md`](./PHASE_5_TESTING_CHECKLIST.md) - 完整测试清单
- [`CURSOR_AGENT_PRO_TEMPLATE.md`](./CURSOR_AGENT_PRO_TEMPLATE.md) - Agent Pro 开发指南
- [`CURSOR_TOOLKIT_PAGE.md`](./CURSOR_TOOLKIT_PAGE.md) - 工具箱开发指南
- [`CURSOR_UNSPLASH_HERO.md`](./CURSOR_UNSPLASH_HERO.md) - Unsplash 集成指南
- [`memory/implementation_status.md`](./memory/implementation_status.md) - 实现状态记录

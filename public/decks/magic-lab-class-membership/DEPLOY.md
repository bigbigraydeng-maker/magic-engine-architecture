# 部署到 Cloudflare Pages

整套 deck 已打包成 **单个自包含 `dist/index.html`**（图片/字体/图标/运行时全内联，无外链）。
所以「整站 = 这一个文件」，部署极简。两条路任选其一：

---

## 方式 A · 控制台拖拽上传（推荐，零工具，2 分钟）

1. 打开 <https://dash.cloudflare.com> → 左侧 **Workers & Pages**
2. **Create** → 选 **Pages** 标签 → **Upload assets**
3. 项目名填：`magic-lab-class`（决定默认域名 `magic-lab-class.pages.dev`）
4. 把本目录下的 **`dist` 文件夹**整个拖进上传框 → **Deploy site**
5. 完成后得到公开链接：`https://magic-lab-class.pages.dev`

> 之后要更新：改 `index.html` → `node build-offline.mjs` → 重新 `cp` 到 `dist/` → 再拖一次（或用方式 B 一行命令覆盖）。

---

## 方式 B · 命令行（你本机有 node 时，一行搞定）

```bash
cd public/decks/magic-lab-class-membership
npx wrangler login                    # 首次：浏览器授权 Cloudflare（仅一次）
npx wrangler pages deploy dist --project-name=magic-lab-class
```

输出里会给一个 `https://magic-lab-class.pages.dev`（及本次部署的预览 URL）。
重新部署只需再跑最后一行。

---

## 自定义域名（可选）

Pages 项目 → **Custom domains** → 添加你的域名（如 `deck.magiclab.com`），
按提示在 DNS 加一条 CNAME 即可。

## 说明

- 中文走系统字体（苹方/微软雅黑/Noto Sans SC），公网访客的 Win/Mac 都自带，显示正常。
- `dist/_headers` 已设基础缓存 + `X-Content-Type-Options`，可按需调整。
- 我（当前环境）无 node、无 Cloudflare 凭证，无法代跑部署命令；上面两条都由你在本机/控制台执行。
  若你愿意提供 Cloudflare API Token + Account ID（且本机有 node），我可以帮你把命令跑通。

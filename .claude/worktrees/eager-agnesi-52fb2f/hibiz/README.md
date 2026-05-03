# HiBiz

AI microsite and lead-form generator for New Zealand **real estate** and **immigration & education** businesses. A **Magic Lab** product.

## Stack

- Next.js 14 (App Router), TypeScript, Tailwind CSS
- Supabase (Auth, Postgres, RLS)

## Local setup

1. **Environment**: 仓库里已有模板 `hibiz/.env.local`（被 git 忽略，不会提交）。把其中的占位符改成你在 Dashboard **Project Settings → API** 里的 **Project URL** 和 **anon public** key。若文件被删，可复制：  
   `Copy-Item .env.example .env.local`（PowerShell）再编辑。  
   **OpenAI**：在 `.env.local` 设置 `OPENAI_API_KEY`（仅服务端读取）；勿提交、勿发到聊天。若密钥曾泄露，请在 OpenAI 控制台轮换。  
   **可选**：`HIBIZ_LEAD_SALT` — 留资限流用的 IP 哈希盐；不填则用 `NEXT_PUBLIC_SUPABASE_URL` 参与哈希（生产建议显式设置随机串）。
2. Apply database migrations (in order) — pick one:
   - **Dashboard**: SQL Editor → paste in order: `20260403120000_init_hibiz.sql`, `20260404120000_hibiz_public_rls.sql`, `20260404200000_hibiz_lead_rate_limit_fn.sql`, `20260405120000_merchant_profile.sql`（商家资料 + 视图列 `merchant_profile`）.
   - **CLI**: `supabase link` then `supabase db push` (recommended for teams).
   - **Management API** (no Dashboard paste): create a [Personal Access Token](https://supabase.com/dashboard/account/tokens) with rights to run database queries, then:

     ```powershell
     $env:SUPABASE_ACCESS_TOKEN="sbp_..."
     $env:SUPABASE_PROJECT_REF="your_ref_from_dashboard"
     npm run db:apply:api
     ```

     This calls `POST /v1/projects/{ref}/database/query` ([docs](https://supabase.com/docs/reference/api/v1-run-a-query)). If you get `403`, use a token that includes **database write** (fine-grained scopes). The endpoint is **beta** — if it rejects multi-statement SQL, fall back to SQL Editor or CLI.

3. **Authentication → URL configuration**: add `http://localhost:3000/auth/callback` to **Redirect URLs** (still easiest in Dashboard; full auth config via API is limited and scope-heavy).

4. `npm install` then `npm run dev` → [http://localhost:3000](http://localhost:3000).

### What API cannot replace (today)

- **Creating** the hosted project and **billing** (you still open/create the project once in Supabase).
- **Magic link redirect URLs** are quickest in Dashboard; programmatic changes need specific Management API auth endpoints and PAT scopes.

## Troubleshooting

- **`http://localhost:3001` 打不开或一直转圈**  
  1. 默认 `npm run dev` 是 **3000** 端口；要用 3001 请：`npm run dev:3001`。  
  2. 若提示 **端口占用**（`EADDRINUSE`）：在任务管理器结束旧的 `node` 进程，或换端口：`npx next dev -p 3002`。  
  3. 首页 **500**：检查 `hibiz/.env.local` 是否包含有效的 `NEXT_PUBLIC_SUPABASE_URL` 与 `NEXT_PUBLIC_SUPABASE_ANON_KEY`；首页已尽量在缺省时仍可打开，但 `/app` 等仍依赖 Supabase。

- **`Cannot find module './vendor-chunks/@supabase.js'` or missing numeric chunk (e.g. `./948.js`)**  
  1. Stop dev server.  
  2. Run `npm run clean` then `npm run dev` (or `npm run dev:clean`).  
  3. Avoid passing server actions through `.bind(null, id)` — use a `<form>` with a hidden field instead (this repo already does for “Analyse my request”).

- **Path with spaces** (`magic lab`): usually fine; if odd build errors persist, try cloning the repo to a path without spaces.

## Routes

| Path | Purpose |
|------|---------|
| `/` | Marketing home |
| `/progress` | 开发进度看板（随 `src/data/dev-progress.ts` 更新） |
| `/login` | Magic link sign-in |
| `/auth/callback` | OAuth / PKCE exchange (Supabase) |
| `/app/projects` | Project list (protected) |
| `/app/projects/new` | Create project + first intent |
| `/app/projects/[id]` | Project / intent / publish / hero 快编 / business details |
| `/app/projects/[id]/poster` | 房产推广可打印海报（手动字段 + TradeMe 链接，无 listing API） |
| `/app/projects/[id]/leads` | 项目线索列表 |
| `/site/[slug]` | Public microsite (after **Publish** on the project) |
| `/forms/[public_slug]` | Standalone public lead form (active after publish) |

## Product spec

See Obsidian: `Second-Brain/01-Magiclab/Projects/HiBiz/`.

## Repo layout

This app lives under the Magic Lab monorepo folder as `hibiz/`; deploy as its own service (e.g. Vercel + Supabase), separate from the static `magiclab.com` site.

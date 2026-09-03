'use client'

/**
 * FacebookPagePanel — FDE-managed binding for clients.facebook_page_id.
 *
 * Setting this is what switches the Messenger pipeline on for a client, so the
 * panel says that in those words rather than naming a database column.
 *
 * The hard part for a non-technical operator is that Facebook shows you
 * facebook.com/CTSTOURS while the API needs 1616575215312482, and there is no
 * way to convert one to the other by hand. So the default path is a pick-list of
 * the Pages this client's Meta connection can already act for; typing an id is
 * the fallback, not the main road.
 *
 * Mirrors MetaAdAccountPanel.tsx, which sits next to it in the same drawer.
 */

import React, { useCallback, useEffect, useState } from 'react'

interface Props {
  clientId: string
}

interface ManagedPage {
  id: string
  name: string
}

type PagesError = 'no_token' | 'meta_rejected'

interface Payload {
  page_id: string | null
  /** factory_config.publish_target 里配的发布主页（platform=facebook）。跟收件箱
   *  page_id 是两个独立字段：这个决定「重新授权发布」按钮能不能点。 */
  publish_target_page_id: string | null
  pages: ManagedPage[] | null
  pages_error: PagesError | null
  /** Live答案：ME 现在读不读得到这个主页。false = 绑了但拉不到东西。 */
  reachable: boolean | null
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: Payload }

/** Why there is no pick-list, said the way an operator can act on. */
const PAGES_ERROR_TEXT: Record<PagesError, string> = {
  no_token:
    '这个客户还没连 Meta 账号，所以列不出主页。可以先手动填 ID，等连上后同步就会自动开始。',
  meta_rejected:
    'Meta 没有返回主页列表（授权可能过期了）。可以先手动填 ID，之后请团队重新连一次 Meta。',
}

export function FacebookPagePanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [draft, setDraft] = useState('')
  const [manual, setManual] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/facebook-page`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as Payload
      setState({ phase: 'ready', data })
      setDraft(data.page_id ?? '')
      // No list to pick from → typing is the only road, so open it up front.
      setManual(!data.pages?.length)
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (value: string | null) => {
    setSaving(true)
    setErrMsg(null)
    setResult(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/facebook-page`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_id: value }),
      })
      const json = (await res.json()) as {
        error?: string
        page_id?: string | null
        reachable?: boolean | null
        pages?: ManagedPage[] | null
        pages_error?: PagesError | null
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      setState({
        phase: 'ready',
        data: {
          page_id: json.page_id ?? null,
          // PATCH only touches the inbox binding — the publish target is a
          // separate field, so carry the last-loaded value through unchanged.
          publish_target_page_id: state.phase === 'ready' ? state.data.publish_target_page_id : null,
          pages: json.pages ?? null,
          pages_error: json.pages_error ?? null,
          reachable: json.reachable ?? null,
        },
      })
      setDraft(json.page_id ?? '')
      setResult(describeSave(json.page_id ?? null, json.reachable ?? null))
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (state.phase === 'loading') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-700">加载失败</p>
        <p className="mt-1 text-xs text-red-600">{state.message}</p>
        <button
          onClick={() => void load()}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
        >
          重试
        </button>
      </div>
    )
  }

  const { page_id, publish_target_page_id, pages, pages_error, reachable } = state.data
  const dirty = draft.trim() !== (page_id ?? '').trim()

  /**
   * 当前**要显示**的值不在「我们能操作的主页」列表里 —— 常态，不是边角情况：
   * 这正是 reachable=false 那条红字存在的理由。
   *
   * 必须为它单独补一个 <option>，否则 <select value={draft}> 匹配不到任何项，
   * React 回退选中第一项「— 不接私信 —」：屏幕上同时出现「绑了主页，但线索
   * 进不来」和「不接私信」两句自相矛盾的话（2026-09-03 NewAsian 实测）。
   *
   * 更要命的是随之而来的静默改绑：draft 仍等于 page_id，dirty=false、保存键灰着，
   * 人想改都改不了；而他只要在下拉框里动一下，draft 就变成别人的主页 ID 或空，
   * 保存键亮起 —— 一次「确认当前设置」的动作，实际把这个客户改绑到了别的主页。
   *
   * ⚠ 判断必须跟着 `draft`（要显示的值），不能跟着 `page_id`（已保存的值）。
   * 魏征复审 2026-09-03 抓到：第一版挂在 page_id 上只盖住了一半 —— 走「手动填
   * ID → 填一个新的列表外 ID → 回到主页列表」这条路时两者分叉，屏幕又变回
   * 「不接私信」，而这次 dirty=true、保存键是**亮的**，按下去真会把它存进去。
   * 那比原来的 bug 更糟：原来的至少存不进去。
   */
  const draftValue = draft.trim()
  const draftOutsideList =
    draftValue !== '' && pages !== null && !pages.some((p) => p.id === draftValue)
  /** 这个列表外的值是「已经在生效的绑定」还是「你刚填的、还没存」—— 两件事不能混说。 */
  const draftIsSavedBinding = draftValue === (page_id ?? '')

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <LiveStatus pageId={page_id} reachable={reachable} />

      <p className="mb-3 text-sm text-slate-600">
        选中客户的 Facebook 主页后，系统每小时自动把主页私信拉进来，AI 写成需求卡，
        显示在<span className="font-bold">「客户消息」</span>页。不选就完全不动这个客户的私信。
      </p>

      {pages_error && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {PAGES_ERROR_TEXT[pages_error]}
        </p>
      )}

      {pages && pages.length > 0 && !manual && (
        <select
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
        >
          <option value="">— 不接私信 —</option>
          {draftOutsideList && (
            <option value={draft}>
              {/* 「读不到」直接读 reachable，不在这里第二次推导。今天它跟
                  draftOutsideList 严格互补（都源自同一次响应的 pages），但哪天
                  reachable 改成直接探测主页，两者就会分叉 —— 那时这里会跟上面
                  LiveStatus 说反话，正是本次要消灭的那种自相矛盾（魏征复审）。*/}
              {draftIsSavedBinding
                ? `当前绑定：${draftValue}${reachable === false ? '（ME 读不到）' : ''}`
                : `待保存：${draftValue}（不在列表里）`}
            </option>
          )}
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{p.id}）
            </option>
          ))}
        </select>
      )}

      {(manual || !pages?.length) && (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="1616575215312482"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
        />
      )}

      {pages && pages.length > 0 && (
        <button
          onClick={() => setManual((v) => !v)}
          className="mt-2 text-xs text-slate-500 hover:text-slate-700"
        >
          {manual ? '← 回到主页列表' : '列表里没有？手动填 ID'}
        </button>
      )}

      {errMsg && <p className="mt-2 text-xs leading-relaxed text-red-600">⚠ {errMsg}</p>}
      {result && (
        <p className={`mt-2 text-xs leading-relaxed ${result.ok ? 'text-emerald-600' : 'text-amber-700'}`}>
          {result.text}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void save(draft.trim() || null)}
          disabled={!dirty || saving}
          className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {dirty && !saving && (
          <button
            onClick={() => setDraft(page_id ?? '')}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            撤销修改
          </button>
        )}
        {!dirty && page_id === null && <span className="text-xs text-slate-400">未接私信</span>}
      </div>

      <ConnectMeta clientId={clientId} pageId={page_id} publishTargetPageId={publish_target_page_id} />

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-400">
        主页网址里的名字（facebook.com/<span className="font-mono">CTSTOURS</span>）不是 ID。
        实在要手填，去主页「关于 → 页面透明度」里找「主页编号」。
        保存后最快等一小时出现第一批对话。
      </p>
    </div>
  )
}

/** What the callback redirected back with, said the way the operator needs it. */
const META_RESULT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: '✓ 连接成功。下一个整点开始同步这个主页的私信。' },
  publish_ready: {
    ok: true,
    // Meta granting the app-level scope is necessary but not sufficient: the
    // Page token can still lack the Page-level task to actually post. So this
    // states what was proven (scope granted) and what is not yet proven
    // (Page-level publishing), left to the separately-authorised draft canary.
    text: '✓ Meta 已授予发布权限（管理主页帖子）。能不能真正发到这个主页，还要靠之后单独授权的那次「试发草稿」来确认 —— 在那之前不代表已经能发。',
  },
  publish_not_granted: {
    ok: false,
    text: '连接成功了，但这次授权没有勾选「管理主页帖子」，所以还不能发内容（私信同步不受影响）。请再点一次「重新授权 Meta 发布权限」，在 Meta 授权页把发帖权限一起勾上。',
  },
  verify_failed: {
    ok: false,
    text: '刚才没能跟 Meta 核实这次授权到底给了哪些权限，所以没有改动这个连接（避免记错状态）。请稍等一下再点一次。',
  },
  no_publish_target: {
    ok: false,
    text: '这个客户还没配好「发布到哪个 Facebook 主页」，所以没法发起发布授权。请先在「视频工厂配置」里把发布主页填好，再点「重新授权 Meta 发布权限」。',
  },
  denied: { ok: false, text: '授权取消了，没有任何改动。要接私信的话再点一次。' },
  // ⚠ 下面两条的措辞是 2026-09-03 NewAsian 事故后重写的。
  //
  // 旧文案只给了「换个账号」和「查主页 ID」两个方向。实测时两个都是对的却仍然
  // 失败：主页 ID 正确（Meta 按广告账户查返回的就是它）、授权账号在 Business
  // Suite 里也确实看得到该主页的消息 —— 真因是客户的商务组合里从没添加过
  // Magic Engine 这个应用，应用因此拿不到该组合下任何主页的令牌。
  //
  // 一条把人引向死路的提示比没有提示更贵：排查的人会反复确认那两件本来就没错
  // 的事。所以这里按实测的可能性排序，把最常中的原因放第一条。
  no_pages: {
    ok: false,
    // ⚠ 措辞刻意不写成「Meta 说没有主页」。listPagesWithTokens 在 Meta 报错或
    // 网络抖动时同样 return []（见 meta-oauth/client.ts），callback 只看
    // length===0，所以这条也可能是一次抖动。把它说成 Meta 的确定回答，会让人
    // 拿着一个不存在的结论去改客户后台的配置。
    text:
      '授权走完了，但我们没从这个账号拿到任何主页。可能是 Meta 当时没答上来（先隔几分钟重点一次），' +
      '也可能是权限没到位。重试仍旧这样的话按顺序查：' +
      '① 客户的商务组合里有没有添加 Magic Engine 应用 —— 客户的 Business 设置 →「应用」→ 添加（应用编号 1752513682785923，后台显示的名字不一定就叫 Magic Engine，按编号找最稳）；' +
      '② 你对主页是不是只有商务组合里的资产分配，缺主页本身的管理员角色 —— 要客户在主页「页面访问权限」里加你；' +
      '③ 是不是登错了账号。',
  },
  page_not_granted: {
    ok: false,
    // 2026-09-03 NewAsian 实测：主页 ID 正确、授权账号在 Business Suite 里也看得到
    // 该主页消息，仍然失败 —— 真因是客户的商务组合里没添加 Magic Engine 应用。
    // 旧文案只给「换账号 / 查 ID」两条路，把人引向死路。
    //
    // 但也不能反过来断言「跟 ID 无关」（魏征复审）：本面板在列不出主页时默认就
    // 打开手填框，而 normalisePageId 只校验「≥8 位数字」，手打错一个数字照样存得
    // 进去 —— 手填错 ID 恰恰是这个界面自己制造的一类常见原因。所以三条并列摆出
    // 来，只说「先查哪条」，不替人排除任何一条。
    text:
      '授权走完了，但 Meta 没把这个主页交给我们。三个方向都查一下，第①条是 2026-09 实测遇到过的：' +
      '① 客户的商务组合里有没有添加 Magic Engine 应用 —— 客户的 Business 设置 →「应用」→ 添加（应用编号 1752513682785923，后台显示的名字不一定就叫 Magic Engine，按编号找最稳）；' +
      '② 你对这个主页是不是只有商务组合里的「资产分配」，缺主页本身的管理员角色 —— 要客户在主页「页面访问权限」里把你加上；' +
      '③ 上面那个主页 ID 是不是手填错了、或者登错了账号。' +
      '另外：如果你刚点的是「重新授权 Meta 发布权限」，那它认的根本不是这里绑的主页，' +
      '而是「视频工厂配置」里那个发布主页 —— 要查的是那个 ID，别在这里绕。',
  },
  no_page_bound: { ok: false, text: '还没绑定主页 —— 先在上面选好主页并保存，再点连接。' },
  bad_state: { ok: false, text: '这个连接链接已经过期了，请重新点一次「连接 Meta」。' },
  exchange_failed: { ok: false, text: 'Meta 那边没有换出凭证，请稍后再试一次。' },
}

/**
 * The one-click replacement for hand-editing a server environment variable.
 *
 * Every client used to need META_SYSTEM_USER_TOKEN_PAGE_<id> added to Render by
 * hand, which CLAUDE.md forbids for FDE configuration and which nobody did — so
 * 30 Kiteroa spent real money with its inbox unreachable. One consent here
 * stores the Page token for good.
 */
function ConnectMeta({
  clientId,
  pageId,
  publishTargetPageId,
}: {
  clientId: string
  pageId: string | null
  publishTargetPageId: string | null
}) {
  const [outcome, setOutcome] = useState<string | null>(null)
  // Publishing reauth targets factory_config.publish_target, so it is available
  // whenever a valid Facebook publish target is configured — independent of the
  // inbox binding (which may be unset or a different Page).
  const canReauthPublish = Boolean(publishTargetPageId)

  // The callback hands its verdict back through the URL; read it once, then
  // strip it so a refresh does not replay a stale message.
  useEffect(() => {
    const url = new URL(window.location.href)
    const meta = url.searchParams.get('meta')
    if (!meta) return
    setOutcome(meta)
    url.searchParams.delete('meta')
    window.history.replaceState({}, '', url.toString())
  }, [])

  const result = outcome ? META_RESULT[outcome] : null

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      {result && (
        <p
          className={`mb-2 text-xs leading-relaxed ${result.ok ? 'text-cyan-700' : 'text-amber-700'}`}
        >
          {result.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/auth/facebook/connect?client_id=${clientId}`}
          className={`inline-block rounded-lg border px-3 py-1.5 text-xs font-bold ${
            pageId
              ? 'border-cyan-300 bg-white text-cyan-700 hover:bg-cyan-50'
              : 'pointer-events-none border-slate-200 bg-slate-50 text-slate-300'
          }`}
          aria-disabled={!pageId}
        >
          连接 Meta
        </a>

        {/* Same OAuth flow, but carries intent=publishing so the callback fails
            closed with a publishing-specific message if 管理主页帖子 isn't granted.
            Needed for clients (e.g. inbox-only connects made before publishing
            scope existed) whose stored grant lacks pages_manage_posts. */}
        <a
          href={`/api/auth/facebook/connect?client_id=${clientId}&intent=publishing`}
          className={`inline-block rounded-lg border px-3 py-1.5 text-xs font-bold ${
            canReauthPublish
              ? 'border-cyan-300 bg-white text-cyan-700 hover:bg-cyan-50'
              : 'pointer-events-none border-slate-200 bg-slate-50 text-slate-300'
          }`}
          aria-disabled={!canReauthPublish}
        >
          重新授权 Meta 发布权限
        </a>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        {pageId
          ? '用一个能在 Business Suite 里看到这个主页消息的账号授权一次，之后不用再管。'
          : '先选好主页并保存，才能连接私信。'}
        {canReauthPublish
          ? '「重新授权 Meta 发布权限」针对的是视频工厂配置里那个发布主页，授权时记得勾上发帖权限。'
          : '要让系统能发内容，得先在「视频工厂配置」里配好发布主页，这个按钮才能点。'}
      </p>
    </div>
  )
}

/**
 * Standing answer to "is this actually working right now", shown on every load.
 *
 * The failure it exists for is silent: a Page can be bound while the client has
 * only granted us permission to *advertise* with it, not to read its inbox. Ads
 * spend, nothing arrives, and every screen looks normal. 30 Kiteroa sat like
 * that with money going out and zero conversations in ME. The save-time message
 * did say it once, but it disappeared on the next load — so this repeats it for
 * as long as it is true, and names the fix rather than just the symptom.
 */
function LiveStatus({ pageId, reachable }: { pageId: string | null; reachable: boolean | null }) {
  if (pageId === null) return null

  if (reachable === true) {
    return (
      <p className="mb-3 rounded-lg bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-800">
        ✓ 私信正在同步 —— ME 读得到这个主页。
      </p>
    )
  }

  if (reachable === false) {
    return (
      <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
        <p>
          <span className="font-bold">⚠ 绑了主页，但线索进不来。</span>
          <br />
          ME 读不到这个主页，所以私信一条都同步不进来 —— 广告照跑照花钱，客人发来的消息只留在对方主页的收件箱里。
        </p>
        <p className="mt-1.5">
          点下面的「连接 Meta」，用一个能看到这个主页消息的账号授权一次就好。
        </p>
      </div>
    )
  }

  return (
    <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
      绑了主页，但现在连不上 Meta，没法确认同步是否正常。
    </p>
  )
}

/** One sentence covering saved-and-live, saved-but-not-live, and unbound. */
function describeSave(pageId: string | null, reachable: boolean | null): { ok: boolean; text: string } {
  if (pageId === null) {
    return { ok: true, text: '✓ 已解除绑定，之后不会再同步这个客户的私信。' }
  }
  if (reachable === true) {
    return { ok: true, text: '✓ 已保存，ME 能读到这个主页。下一个整点开始同步私信。' }
  }
  if (reachable === false) {
    return {
      ok: false,
      text: '已保存，但 ME 现在读不到这个主页 —— 多半是这个 ID 不属于已连接的 Meta 账号，或者授权没覆盖到它。同步暂时不会有数据，请找团队确认。',
    }
  }
  return { ok: false, text: '已保存。Meta 还没连上，接通之后同步才会开始。' }
}

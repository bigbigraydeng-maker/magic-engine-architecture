'use client'

/**
 * 卡片上直接敲一行 —— 「打电话的时候顺手记，回车就完事」。
 *
 * ## 为什么不复用抽屉里那个 `ComposeNote`
 *
 * 板桥（销售视角复审，2026-08-06）说他最想要的就是这个，而且**比三段式改版
 * 更重要**：
 *
 * > 我一手拿电话一手用鼠标，不可能点开抽屉、再点四下、再从下拉里选一个阶段。
 * > 我要的是：电话一接通，卡上开个输入框，我敲一行「三月两个人去南岛，
 * > 周五给报价」，回车 —— 系统自己在周五那天的名单上给我生成一张卡。
 *
 * 抽屉那个是**坐下来整理**用的：方向切换、阶段下拉、三行文本框、一个「存」按钮。
 * 这个是**一边打电话一边用**的：一个输入框，回车提交。两种场景对「少几下」的
 * 要求差着量级，硬塞进同一个组件只会两头不讨好。
 *
 * ## 三条不能少
 *
 * **① 回车就提交。** 他另一只手在拿电话。Shift+回车才换行，Esc 收起。
 *
 * **② 必须当场说清「下一步排在哪天」**（见 `lib/crm/next-step`）。
 * 排程那一半早通了（约定时间到点自动把人捞回名单），但敲完只回一句
 * 「记好了」的话，他**无法确认那个「周五」被读懂了没有** —— 只能自己再记一遍
 * （功能白做），或者信了而周五没人提醒（比白做更糟，答应客人的事砸了）。
 *
 * **③ 防重键跟着「这一次要存的内容」走**（方向 + 原文）。同样的内容重试用
 * 同一个（双击不会记两笔）；失败之后**改过内容**就换一个 ——
 * 否则改过的那版会被服务端当成重复丢掉，详见 `useQuickNoteSubmit`。
 */

import { useRef, useState, type KeyboardEvent } from 'react'
import { noteConfirmation } from '@/lib/crm/next-step'

interface TouchpointResponse {
  error?: string
  created?: boolean
  /** 服务端解析下次时间时**实际用的**时区 —— 必须用它来显示。 */
  timeZone?: string
  parsed?: {
    callback_at?: string | null
    do_not_contact?: boolean
    /** 解析器自己回答的「有没有约下一步」—— 有它就别用正则猜。 */
    mentioned_next_step?: boolean
  }
}

/**
 * 把这一笔发出去，返回**存完该跟销售说的那句话**。失败就抛。
 */
async function postNote(input: {
  clientId: string
  contactId: string
  text: string
  inbound: boolean
  clientRef: string
}): Promise<string> {
  const res = await fetch(`/api/clients/${input.clientId}/crm/touchpoints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contactId: input.contactId,
      direction: input.inbound ? 'inbound' : 'outbound',
      note: input.text,
      clientRef: input.clientRef,
    }),
  })
  const json = (await res.json()) as TouchpointResponse
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

  // 同一个键存过了（双击 / 重试）—— 说出来，别让他以为补的内容也存上了。
  if (json.created === false) return '这一笔之前已经记过了，没有重复记'

  return noteConfirmation(
    input.text,
    {
      callbackAt: json.parsed?.callback_at ?? null,
      doNotContact: json.parsed?.do_not_contact,
      mentionedNextStep: json.parsed?.mentioned_next_step,
    },
    // 用**服务端排程时用的那个时区**，不是这里猜一个。差一个时区，确认里的
    // 日期就可能跟真正排上的那天差一天（澳洲客户按悉尼排，这边按奥克兰显示）
    // —— 而这句话存在的全部意义就是让他核对。
    json.timeZone,
  )
}

/**
 * 管住防重键和存盘状态。
 *
 * ## 防重键：**同一次要存的内容重试用同一个；内容改过就必须换一个**
 *
 * 前半句是为了防双击 / 网络重试记成两笔。
 *
 * 后半句是 Codex 复审 2026-08-15 指出的（真的会丢数据）：第一次请求已经把
 * 触点插进去了、但后面那步（更新联系人 / 回传）失败 —— 输入框留在原地让人改。
 * 改完再回车如果还用老键，服务端认成重复提交，**改过的那版笔记被整个丢掉**，
 * 只回一句 `created:false`。
 *
 * 更糟的是：服务端**先解析新文本、再去重，而且去重之后照样更新联系人**。
 * 于是新文本里那句「别再联系」会把这个人的状态改掉，却**没有任何一条触点
 * 记着这件事** ——「真相源是不可变的触点」那条约定当场破掉。
 *
 * **方向也算进内容**（同一轮复审的后一条）：第一次以「我打的」提交失败、
 * 发现方向记错、切成「他打来的」、原文一个字不改再回车 —— 只比文字的话会
 * 复用老键，**那通来电照旧被存成我们打出去的**。
 */
function useQuickNoteSubmit(opts: {
  clientId: string
  contactId: string
  onDone: (msg: string) => void
}) {
  const clientRefRef = useRef(globalThis.crypto.randomUUID())
  /** 上一次提交出去的**完整内容**（方向 + 原文）。 */
  const lastSubmittedRef = useRef<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (text: string, inbound: boolean) => {
    if (!text || saving) return
    setSaving(true)
    setErr(null)

    const signature = `${inbound ? 'in' : 'out'}:${text}`
    if (lastSubmittedRef.current !== null && lastSubmittedRef.current !== signature) {
      clientRefRef.current = globalThis.crypto.randomUUID()
    }
    lastSubmittedRef.current = signature

    try {
      opts.onDone(
        await postNote({
          clientId: opts.clientId,
          contactId: opts.contactId,
          text,
          inbound,
          clientRef: clientRefRef.current,
        }),
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : '没存上，再试一次')
    } finally {
      setSaving(false)
    }
  }

  return { submit, saving, err }
}

/**
 * 「我打的 / 他打来的」。
 *
 * 默认「我打的」—— 卡片上顺手记的绝大多数是自己打出去的那通，一只手用的
 * 时候不用碰它。
 *
 * 但**必须能切**（Codex 复审 2026-08-15）：页面顶上那个搜索框写的就是
 * 「客户打回来了？按名字/电话/邮箱找他」，而搜索结果**用的是同一张卡**。
 * 销售找到刚打进来的客人、就地记一笔，如果固定写成「我们打出去的」：
 *   · `segmentContact` 认不出「客户来消息了」
 *   · today 路由把它当成「今天我们出手过」→ **卡片当场变灰**
 * 一个刚打电话进来、还在等回复的客人，就这么被折叠起来了。
 */
function DirectionPicker({
  inbound,
  disabled,
  onPick,
}: {
  inbound: boolean
  disabled: boolean
  onPick: (v: boolean) => void
}) {
  return (
    <div className="mb-1 flex gap-1">
      {([false, true] as const).map((v) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onPick(v)}
          disabled={disabled}
          className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${
            inbound === v ? 'bg-me-charcoal text-white' : 'bg-white text-me-charcoal/45'
          }`}
        >
          {v ? '他打来的' : '我打的'}
        </button>
      ))}
    </div>
  )
}

/**
 * 底下那行小字 + 收起。
 *
 * 「说个时间会自动排上」必须写在他眼前 —— 不写没人会知道可以这么用，
 * 这个功能就等于没做。
 */
function NoteFooter({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return (
    <div className="mt-1 flex items-center justify-between">
      <span className="text-[11.5px] text-me-charcoal/40">
        {saving ? '存着…' : '说个时间（「周五」「下周二」）会自动排上'}
      </span>
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="text-[12px] text-me-charcoal/40 hover:text-me-charcoal"
      >
        收起
      </button>
    </div>
  )
}

/**
 * 键盘：回车提交、Shift+回车换行、Esc 收起 —— 他另一只手在拿电话。
 *
 * 🔴 **正在选字时按的回车不算提交**（Codex 复审 2026-08-15）。
 *
 * CTS 的销售打中文：敲拼音 → 候选框弹出来 → **按回车选字**。那一下的按键
 * 事件同样是 Enter，但 `isComposing` 是 true。不挡的话，笔记会在**只打了
 * 半句**的时候存下去、输入框当场收起 —— 而且他多半不会重打一遍，
 * 那半句就成了这个客人的全部记录。
 *
 * 用 `e.nativeEvent.isComposing`：React 的合成事件不带这个字段。
 */
function handleKey(
  e: KeyboardEvent<HTMLTextAreaElement>,
  on: { onSubmit: () => void; onCancel: () => void },
) {
  if (e.nativeEvent.isComposing) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    on.onSubmit()
  }
  if (e.key === 'Escape') on.onCancel()
}

export function QuickNote({
  clientId,
  contactId,
  onDone,
  onCancel,
}: {
  clientId: string
  contactId: string
  /** 存好之后回给页面的那句话（页面用它弹提示 + 重新拉数据）。 */
  onDone: (msg: string) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState('')
  const [inbound, setInbound] = useState(false)
  const { submit, saving, err } = useQuickNoteSubmit({ clientId, contactId, onDone })

  return (
    <div
      className="border-t border-me-charcoal/8 bg-me-ivory/60 px-3 py-2"
      // 卡片主体点了会打开抽屉 —— 在输入框里点不该触发它。
      onClick={(e) => e.stopPropagation()}
    >
      <DirectionPicker inbound={inbound} disabled={saving} onPick={setInbound} />

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => handleKey(e, { onSubmit: () => void submit(note.trim(), inbound), onCancel })}
        rows={2}
        autoFocus
        disabled={saving}
        placeholder="聊了什么？例：三月两个人去南岛，周五给报价（回车存）"
        className="w-full resize-none rounded-lg border border-black/10 px-2.5 py-1.5 text-[13px] leading-snug focus:border-me-charcoal focus:outline-none disabled:bg-black/5"
      />

      {err && <p className="mt-1 text-[12px] font-semibold text-[#C2453A]">⚠ {err}</p>}

      <NoteFooter saving={saving} onCancel={onCancel} />
    </div>
  )
}

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
 * **③ 防重键跟着「这段文字」走。** 同一段文字重试用同一个（双击不会记两笔）；
 * 失败之后**改过字**就换一个 —— 否则改过的那版会被服务端当成重复丢掉，
 * 详见下面 `clientRefRef` 的说明。
 */

import { useRef, useState } from 'react'
import { noteConfirmation } from '@/lib/crm/next-step'

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
  /**
   * 防重键。**同一段文字重试用同一个；文字改过就必须换一个。**
   *
   * 前半句是为了防双击 / 网络重试记成两笔。
   *
   * 后半句是 Codex 复审 2026-08-15 指出的（真的会丢数据）：第一次请求已经
   * 把触点插进去了、但后面那步（更新联系人 / 回传）失败 —— 输入框留在原地
   * 让人改。改完再回车如果还用老键，服务端认成重复提交，**改过的那版笔记
   * 被整个丢掉**，只回一句 `created:false`。
   *
   * 更糟的是：服务端**先解析新文本、再去重，而且去重之后照样更新联系人**。
   * 于是新文本里那句「别再联系」会把这个人的状态改掉，却**没有任何一条触点
   * 记着这件事**——「真相源是不可变的触点」那条约定当场破掉。
   */
  const clientRefRef = useRef(globalThis.crypto.randomUUID())
  /** 上一次提交出去的原文 —— 用来判断「这次是重试还是改过了」。 */
  const lastSubmittedRef = useRef<string | null>(null)
  const [note, setNote] = useState('')
  /**
   * 这一笔是**我打给他**还是**他打给我**。
   *
   * 默认「我打的」—— 卡片上顺手记的绝大多数是自己打出去的那通。
   *
   * 但**必须能切**（Codex 复审 2026-08-15）：页面顶上那个搜索框写的就是
   * 「客户打回来了？按名字/电话/邮箱找他」，而搜索结果**用的是同一张卡**。
   * 销售找到刚打进来的客人、就地记一笔，如果固定写成「我们打出去的」：
   *   · `segmentContact` 认不出「客户来消息了」
   *   · today 路由把它当成「今天我们出手过」→ **卡片当场变灰**
   * 一个刚打电话进来、还在等回复的客人，就这么被折叠起来了。
   */
  const [inbound, setInbound] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    const text = note.trim()
    if (!text || saving) return
    setSaving(true)
    setErr(null)

    // 上一次失败之后改过字 → 换一个防重键，否则这一版会被服务端当重复丢掉。
    if (lastSubmittedRef.current !== null && lastSubmittedRef.current !== text) {
      clientRefRef.current = globalThis.crypto.randomUUID()
    }
    lastSubmittedRef.current = text

    try {
      const res = await fetch(`/api/clients/${clientId}/crm/touchpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId,
          direction: inbound ? 'inbound' : 'outbound',
          note: text,
          clientRef: clientRefRef.current,
        }),
      })
      const json = (await res.json()) as {
        error?: string
        created?: boolean
        /** 服务端解析下次时间时**实际用的**时区 —— 必须用它来显示，见下。 */
        timeZone?: string
        parsed?: { callback_at?: string | null; do_not_contact?: boolean }
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      // 同一个键存过了（双击 / 重试）—— 说出来，别让他以为补的内容也存上了。
      if (json.created === false) {
        onDone('这一笔之前已经记过了，没有重复记')
        return
      }

      onDone(
        noteConfirmation(
          text,
          {
            callbackAt: json.parsed?.callback_at ?? null,
            doNotContact: json.parsed?.do_not_contact,
          },
          // 用**服务端排程时用的那个时区**，不是这里猜一个。差一个时区，
          // 确认里的日期就可能跟真正排上的那天差一天（澳洲客户按悉尼排，
          // 这边按奥克兰显示）—— 而这句话存在的全部意义就是让他核对。
          json.timeZone,
        ),
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : '没存上，再试一次')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="border-t border-me-charcoal/8 bg-me-ivory/60 px-3 py-2"
      // 卡片主体点了会打开抽屉 —— 在输入框里点不该触发它。
      onClick={(e) => e.stopPropagation()}
    >
      {/* 方向。默认「我打的」，一只手也不用碰它；只有「客户打回来了」那条
          流程需要切一下 —— 切错会让一个还在等回复的客人当场变灰。 */}
      <div className="mb-1 flex gap-1">
        {([false, true] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => setInbound(v)}
            disabled={saving}
            className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${
              inbound === v ? 'bg-me-charcoal text-white' : 'bg-white text-me-charcoal/45'
            }`}
          >
            {v ? '他打来的' : '我打的'}
          </button>
        ))}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          // 🔴 **正在选字时按的回车不算提交**（Codex 复审 2026-08-15）。
          //
          // CTS 的销售打中文：敲拼音 → 候选框弹出来 → **按回车选字**。
          // 那一下的按键事件同样是 Enter，但 `isComposing` 是 true。
          // 不挡的话，笔记会在**只打了半句**的时候存下去、输入框当场收起 ——
          // 而且他多半不会重打一遍，那半句就成了这个客人的全部记录。
          //
          // 用 `e.nativeEvent.isComposing`：React 的合成事件不带这个字段。
          if (e.nativeEvent.isComposing) return

          // 回车提交、Shift+回车换行 —— 他另一只手在拿电话。
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void submit()
          }
          if (e.key === 'Escape') onCancel()
        }}
        rows={2}
        autoFocus
        disabled={saving}
        placeholder="聊了什么？例：三月两个人去南岛，周五给报价（回车存）"
        className="w-full resize-none rounded-lg border border-black/10 px-2.5 py-1.5 text-[13px] leading-snug focus:border-me-charcoal focus:outline-none disabled:bg-black/5"
      />

      {err && <p className="mt-1 text-[12px] font-semibold text-[#C2453A]">⚠ {err}</p>}

      <div className="mt-1 flex items-center justify-between">
        {/* 把「说个时间就会自动排上」这件事写在他眼前 —— 不写没人会知道
            可以这么用，这个功能就等于没做。 */}
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
    </div>
  )
}

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
 * **③ 幂等键挂载时生成一次。** 点击时才生成的话，双击 = 两笔记录。
 */

import { useState } from 'react'
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
  // 挂载时生成一次，整个提交生命周期复用 —— 双击不会记成两笔。
  const [clientRef] = useState(() => globalThis.crypto.randomUUID())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    const text = note.trim()
    if (!text || saving) return
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/touchpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId, direction: 'outbound', note: text, clientRef }),
      })
      const json = (await res.json()) as {
        error?: string
        created?: boolean
        parsed?: { callback_at?: string | null; do_not_contact?: boolean }
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      // 同一个键存过了（双击 / 重试）—— 说出来，别让他以为补的内容也存上了。
      if (json.created === false) {
        onDone('这一笔之前已经记过了，没有重复记')
        return
      }

      onDone(
        noteConfirmation(text, {
          callbackAt: json.parsed?.callback_at ?? null,
          doNotContact: json.parsed?.do_not_contact,
        }),
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
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
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

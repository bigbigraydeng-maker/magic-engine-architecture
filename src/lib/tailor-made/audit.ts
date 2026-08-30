import { normaliseItinerary } from './normalise';
import type { TailorMadeItinerary } from './types';

/**
 * 导出前的空字段体检。
 *
 * 来由（CTS-2026-0025 实际发生）：一份已发出的行程单上，价格旁边的
 * 「Costs to allow for」只有标题没有金额，第 2 页的「TRAVELLING」整格空白。
 * 模板对缺字段的反应是渲染成空字符串 —— 不报错、不留痕。
 *
 * 靠人眼防不住：8 页的文件没人会逐格核对，而空白恰恰长得像「这里本来就没内容」。
 * 所以让系统自己喊：凡是**本该有内容却空着**的格子，在编辑器里列出来。
 *
 * 两条自我约束：
 *  - 只报「空」，不报「写得不好」。后者是顾问的判断，系统插嘴只会让人学会忽略它。
 *  - 分两档：blocker 是客户一眼能看出不对的（价格空、客户名空）；
 *    warn 是该补但不至于丢人的。全报成红色等于没有分级，顾问会一律无视。
 */

export type AuditLevel = 'blocker' | 'warn';

export interface AuditFinding {
  level: AuditLevel;
  /** 给顾问看的位置，如「第 6 天 · 住宿」 */
  where: string;
  /** 一句话说清楚客户会看到什么 */
  what: string;
}

const isBlank = (s: string | undefined | null): boolean => !s || !s.trim();

export function auditItinerary(raw: TailorMadeItinerary): AuditFinding[] {
  // 体检的是**将要渲染出去的那份**，不是原始数据 —— 归一化能补上的不该报警
  const it = normaliseItinerary(raw);
  const out: AuditFinding[] = [];
  const add = (level: AuditLevel, where: string, what: string) => out.push({ level, where, what });

  // ---- 封面与抬头 ----
  if (isBlank(it.client?.name)) add('blocker', '封面 · Prepared for', '客户名空着，封面上会是一片空白');
  if (isBlank(it.trip?.title)) add('blocker', '封面 · 行程标题', '标题空着，封面和每页页头都会缺');
  if (isBlank(it.meta?.quoteRef)) add('blocker', '报价编号', '编号空着，页头会显示 "Ref"');

  // ---- 第 2 页的六格事实 ----
  it.trip?.facts?.forEach((fact) => {
    if (isBlank(fact.value)) add('warn', `Your journey · ${fact.label}`, '这一格是空的，客户会看到标题下面没有内容');
  });
  if (isBlank(it.trip?.summary)) add('warn', 'Your journey · 概述', '概述空着，第 2 页会少一整段');
  if (!it.trip?.highlights?.length) add('warn', 'Your journey · 行程亮点', '一条亮点都没有，这一段整块不渲染');

  // ---- 逐日 ----
  const lastDay = it.days?.length ?? 0;
  it.days?.forEach((day, i) => {
    const where = `第 ${day.day || i + 1} 天`;
    if (isBlank(day.route)) add('blocker', `${where} · 城市/路线`, '卡片没有标题');
    if (isBlank(day.body)) add('blocker', `${where} · 正文`, '这一天是空白卡片，客户会以为漏写了');
    // 最后一天通常当天离境，不该报缺住宿
    if (isBlank(day.accommodation) && i + 1 < lastDay) {
      add('warn', `${where} · 住宿`, '没写住宿，这天的 STAY 标签不会出现（其余天都有）');
    }
  });

  // ---- 价格 ----
  const pricing = it.pricing;
  if (pricing) {
    const noAmount = typeof pricing.amount !== 'number' || !Number.isFinite(pricing.amount);
    if (noAmount && isBlank(pricing.amountNote)) {
      add('blocker', '价格', '既没有金额也没有说明，价格区块会是空的');
    }
    if (isBlank(pricing.basis)) add('warn', '价格 · 计价说明', '没写按几人几间房，客户无法判断这个价怎么来的');

    pricing.optional?.forEach((line) => {
      if (isBlank(line.value)) {
        add('blocker', `Costs to allow for · ${line.label || '(未命名)'}`, '只有名目没有金额，客户看到一行空白');
      }
      if (isBlank(line.label)) {
        add('warn', 'Costs to allow for', '有金额但没写是什么费用');
      }
    });
  }

  // ---- 含 / 不含 ----
  if (!it.inclusions?.length) add('warn', '含项', '一条都没有，「Included」那栏会是空的');
  if (!it.exclusions?.length) add('warn', '不含项', '一条都没有，「Not included」那栏会是空的');

  // ---- 顾问名片 ----
  if (isBlank(it.meta?.consultant?.name)) add('warn', '顾问名片 · 姓名', '第 2 页名片没有名字，客户不知道找谁');
  if (isBlank(it.meta?.consultant?.email)) add('warn', '顾问名片 · 邮箱', '名片上 Email 后面是空的');

  return out;
}

/** 一句话总结，给编辑器标题栏用 */
export function auditSummary(findings: AuditFinding[]): string {
  const blockers = findings.filter((f) => f.level === 'blocker').length;
  const warns = findings.length - blockers;
  if (findings.length === 0) return '没有空字段';
  if (blockers === 0) return `${warns} 处建议补`;
  return `${blockers} 处该补上再发${warns ? `，另有 ${warns} 处建议` : ''}`;
}

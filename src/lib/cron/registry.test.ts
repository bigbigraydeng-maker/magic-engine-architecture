import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { CRON_REGISTRY } from './registry'
import { expectedIntervalHours } from './schedule'

const ROOT = path.resolve(__dirname, '../../..')

/**
 * 清单必须跟 render.yaml 永远一致。
 *
 * 不对账的话，加了 cron 忘了登记 = 它从此不在监控范围内，
 * 而「不在监控范围」和「一切正常」在告警里长得一模一样 ——
 * 这正是工厂排产任务停摆 8 天没人发现的形态。
 */
type ParsedCron = { service: string; schedule: string; routes: string[]; startCommand: string }

function parseRenderYaml(): ParsedCron[] {
  const txt = readFileSync(path.join(ROOT, 'render.yaml'), 'utf8')
  const out: ParsedCron[] = []
  const re = /-\s+type:\s+cron\s*\n\s+name:\s*(\S+)([\s\S]*?)(?=\n\s*-\s+type:|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(txt)) !== null) {
    const schedule = /schedule:\s*"([^"]+)"/.exec(m[2])?.[1] ?? ''
    const routes = Array.from(m[2].matchAll(/\/api\/cron\/([a-z0-9-]+)/g)).map((x) => x[1])
    // 块格式 `startCommand: |` 和单行格式 `startCommand: node x.js` 都要认。
    // 只认块格式的话，单行写法会被解析成空串 —— 那是「没解析到」冒充「没有命令」。
    const startCommand =
      /startCommand: \|\n((?:[ \t]+.*\n)+)/.exec(m[2])?.[1] ??
      /startCommand:[ \t]+(\S.*)/.exec(m[2])?.[1] ??
      ''
    out.push({ service: m[1], schedule, routes, startCommand })
  }
  return out
}

describe('CRON_REGISTRY 与 render.yaml 对账', () => {
  const parsed = parseRenderYaml()

  it('解析器真的解析到了东西（防止正则写歪导致后面全部空转成绿）', () => {
    expect(parsed.length).toBeGreaterThan(30)
  })

  it('🔴 render.yaml 里的每个 cron 都在清单里 —— 漏登记 = 脱离监控', () => {
    const known = new Set(CRON_REGISTRY.map((e) => e.service))
    const missing = parsed.filter((p) => !known.has(p.service)).map((p) => p.service)
    expect(missing, `这些 cron 没登记进 CRON_REGISTRY：${missing.join(', ')}`).toEqual([])
  })

  it('清单里不该有 render.yaml 已经删掉的任务（否则天天误报「没跑」）', () => {
    const live = new Set(parsed.map((p) => p.service))
    const stale = CRON_REGISTRY.filter((e) => !live.has(e.service)).map((e) => e.service)
    expect(stale, `这些已从 render.yaml 移除，清单该同步删：${stale.join(', ')}`).toEqual([])
  })

  it('调度表达式跟 render.yaml 一致', () => {
    const bySvc = new Map(parsed.map((p) => [p.service, p]))
    const drift = CRON_REGISTRY
      .filter((e) => bySvc.get(e.service)?.schedule !== e.schedule)
      .map((e) => `${e.service}: 清单 ${e.schedule} vs yaml ${bySvc.get(e.service)?.schedule}`)
    expect(drift).toEqual([])
  })

  it('每个调度表达式都能被算出间隔 —— 算不出的会静默失去监控', () => {
    const bad = CRON_REGISTRY
      .filter((e) => expectedIntervalHours(e.schedule) === null)
      .map((e) => `${e.service}(${e.schedule})`)
    expect(bad, `这些表达式解析不了，需要在 schedule.ts 里支持：${bad.join(', ')}`).toEqual([])
  })

  /** 从接口代码里读 startCronRun 的真实入参 —— 那才是日志里的名字。 */
  function jobNameInCode(routes: string[]): string | null {
    for (const r of routes) {
      const f = path.join(ROOT, 'src/app/api/cron', r, 'route.ts')
      if (!existsSync(f)) continue
      const m = /startCronRun\(\s*['"]([^'"]+)['"]/.exec(readFileSync(f, 'utf8'))
      if (m) return m[1]
    }
    return null
  }

  it('logsRuns 标记跟接口代码里实际有没有 startCronRun 一致', () => {
    const bySvc = new Map(parsed.map((p) => [p.service, p]))
    const drift = CRON_REGISTRY
      .filter((e) => (jobNameInCode(bySvc.get(e.service)?.routes ?? []) !== null) !== e.logsRuns)
      .map((e) => `${e.service}: 清单 ${e.logsRuns}`)
    expect(drift).toEqual([])
  })

  it('🔴 jobName 必须等于代码里 startCronRun 的入参 —— 猜错就会把在跑的判成没跑过', () => {
    const bySvc = new Map(parsed.map((p) => [p.service, p]))
    const drift: string[] = []
    for (const e of CRON_REGISTRY) {
      if (!e.logsRuns) continue
      const actual = jobNameInCode(bySvc.get(e.service)?.routes ?? [])
      if (actual && actual !== e.jobName) drift.push(`${e.service}: 清单 ${e.jobName} vs 代码 ${actual}`)
    }
    expect(drift).toEqual([])
  })
})

/**
 * cron 触发的开关，配在哪要跟「谁的进程真读它」对得上。
 *
 * 这两个 cron 的 startCommand 只是一条 curl，打 web 上的 /api/cron/*；开关是在那条
 * 路由里 process.env 读的，也就是 web 进程。按 docs/ENV.md 原来的「Render-cron」
 * 把变量配到 cron service 上，开关不会生效 —— 而且不报错。两个都是「默认关、要显式
 * 打开」的闸，失效方向是「以为开了其实没开」，跟「一切正常」在日志里长得一样。
 *
 * 下面只钉死 (变量, cron 服务) 两个坐标，其余全部从真实来源推：路由路径从 render.yaml
 * 里那条 curl 的 URL 解出来，读取位置从路由源码里查，位置标注从 docs/ENV.md 的表格里
 * 按表头定位「配在哪」那一列取。所以它不是第二份变量清单 —— 没有一项事实是抄来的。
 */
const CRON_TRIGGERED_WEB_FLAGS: { env: string; service: string }[] = [
  { env: 'PROSPECTING_SWEEP_ENABLED', service: 'prospecting-sweep' },
  { env: 'JOB_SIGNAL_INGEST_ENABLED', service: 'job-boards-weekly' },
]

/** startCommand 里除了 curl 还跑别的东西吗？跑了，才轮到 Render-cron 这一栏。 */
function runsCodeInProcess(startCommand: string): boolean {
  return /(^|\s|&&\s*|;\s*)(node|npm|npx|tsx|ts-node|python3?|bash|sh)\s/.test(
    startCommand.replace(/\\\n/g, ' '),
  )
}

/** docs/ENV.md 里某个变量所在行的「配在哪」那一格（列位置按所属表格的表头定，不写死）。 */
function envDocLocation(name: string): string | null {
  const lines = readFileSync(path.join(ROOT, 'docs/ENV.md'), 'utf8').split('\n')
  const cellsOf = (line: string) => line.split('|').slice(1, -1).map((c) => c.trim())
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trimStart().startsWith('|')) continue
    const cells = cellsOf(lines[i])
    if (!new RegExp(`\`${name}\``).test(cells[0] ?? '')) continue
    for (let j = i - 1; j >= 0 && lines[j].trimStart().startsWith('|'); j--) {
      const col = cellsOf(lines[j]).findIndex((c) => c.includes('配在哪'))
      if (col >= 0) return cells[col] ?? null
    }
    return null
  }
  return null
}

describe('cron 触发、web 进程读取的开关：docs/ENV.md 的「配在哪」', () => {
  const parsed = parseRenderYaml()

  it('前提成立：解析器读到了 cron，也读到了 ENV.md 的表（正则写歪不许静默变绿）', () => {
    expect(parsed.length).toBeGreaterThan(30)
    // 这里对 startCommand 只管本文件受检的那两条任务。**不**对全部 cron 设任何约束 ——
    // 无论是「必须 curl」还是「必须写成块格式」，都会让一条正当的新 cron 弄红一个跟它
    // 毫无关系的断言。受检任务自己的「只能 curl」在下面各自验。
    const checked = CRON_TRIGGERED_WEB_FLAGS.map((f) => parsed.find((p) => p.service === f.service))
    expect(checked.filter((p) => (p?.startCommand ?? '').trim() === '')).toEqual([])
    expect(envDocLocation('CRON_SECRET')).toContain('cron')
    expect(envDocLocation('NEXT_PUBLIC_SUPABASE_ANON_KEY')).toBe('Render-web')
    expect(envDocLocation('THIS_ENV_DOES_NOT_EXIST')).toBeNull()
  })

  describe.each(CRON_TRIGGERED_WEB_FLAGS)('$env', ({ env, service }) => {
    const svc = parsed.find((p) => p.service === service)

    it(`${service} 这条 cron 还在，而且只是 curl —— 一旦它改成在自己进程里跑脚本，这个变量要挪回 Render-cron`, () => {
      expect(svc, `render.yaml 里没有名为 ${service} 的 cron 了`).toBeDefined()
      expect(svc!.startCommand).toContain('curl')
      expect(runsCodeInProcess(svc!.startCommand)).toBe(false)
    })

    it('确实是在它 curl 打的那条路由里 process.env 读的（路由路径从 render.yaml 推，不写死）', () => {
      const hits = (svc?.routes ?? [])
        .map((r) => path.join(ROOT, 'src/app/api/cron', r, 'route.ts'))
        .filter((f) => existsSync(f))
        .filter((f) => readFileSync(f, 'utf8').includes(`process.env.${env}`))
      expect(
        hits.length,
        `${service} 打的路由里没有一条读 process.env.${env} —— 读取位置变了，配在哪要重新判定`,
      ).toBeGreaterThan(0)
    })

    it('docs/ENV.md 标的是 Render-web', () => {
      const where = envDocLocation(env)
      expect(where, `docs/ENV.md 里找不到 ${env} 这一行`).not.toBeNull()
      expect(where).toContain('Render-web')
      expect(where).not.toContain('Render-cron')
    })
  })
})

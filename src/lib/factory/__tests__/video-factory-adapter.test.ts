import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  composeRenderInput,
  VideoFactoryAdapterError,
} from '../video-factory-adapter'
import { SHOT_RECIPES, type ShotRecipe } from '../shot-recipes'

const narrativeRecipe = SHOT_RECIPES.find((r) => r.key === 'narrative')!
const singleFocusRecipe = SHOT_RECIPES.find((r) => r.key === 'single_focus')!

function makeUrls(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `https://cdn.example.com/${prefix}${i}.mp4`)
}

function makeCaptions(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `caption ${i}`)
}

describe('composeRenderInput — happy path mapping', () => {
  it('4-shot narrative recipe → 4 scenes / 4 clip_urls / 4 vo_urls in order', () => {
    const n = narrativeRecipe.shots.length
    const assetUrls = makeUrls('clip', n)
    const voUrls = makeUrls('vo', n)
    const captions = makeCaptions(n)

    const out = composeRenderInput({ assetUrls, recipe: narrativeRecipe, captions, voUrls })

    expect(out.scenes).toHaveLength(n)
    expect(out.clip_urls).toEqual(assetUrls)
    expect(out.vo_urls).toEqual(voUrls)
    expect(out.scenes.map((s) => s.index)).toEqual([0, 1, 2, 3])
    expect(out.scenes.map((s) => s.captionText)).toEqual(captions)
  })

  it('order is preserved: hook stays first, cta stays last', () => {
    const n = narrativeRecipe.shots.length
    const out = composeRenderInput({
      assetUrls: makeUrls('a', n),
      recipe: narrativeRecipe,
      captions: ['HOOK', 'M1', 'M2', 'CTA'],
      voUrls: makeUrls('v', n),
    })
    expect(out.scenes[0].captionText).toBe('HOOK')
    expect(out.scenes[n - 1].captionText).toBe('CTA')
    expect(narrativeRecipe.shots[0].role).toBe('hook')
    expect(narrativeRecipe.shots[n - 1].role).toBe('cta')
  })

  it('single_focus 3-shot recipe → 3 scenes', () => {
    const n = singleFocusRecipe.shots.length
    const out = composeRenderInput({
      assetUrls: makeUrls('a', n),
      recipe: singleFocusRecipe,
      captions: makeCaptions(n),
      voUrls: makeUrls('v', n),
    })
    expect(out.scenes).toHaveLength(3)
    expect(out.clip_urls).toHaveLength(3)
    expect(out.vo_urls).toHaveLength(3)
  })

  it('extra assetUrls beyond recipe shot count are truncated (recipe drives shot count)', () => {
    const n = singleFocusRecipe.shots.length
    const assetUrls = makeUrls('a', n + 5)
    const out = composeRenderInput({
      assetUrls,
      recipe: singleFocusRecipe,
      captions: makeCaptions(n),
      voUrls: makeUrls('v', n),
    })
    expect(out.clip_urls).toEqual(assetUrls.slice(0, n))
    expect(out.clip_urls).toHaveLength(n)
  })
})

describe('composeRenderInput — shape compatibility with render-assemble JobRow', () => {
  it('produces exactly {scenes, clip_urls, vo_urls} with equal counts (render-assemble invariant)', () => {
    const n = narrativeRecipe.shots.length
    const out = composeRenderInput({
      assetUrls: makeUrls('a', n),
      recipe: narrativeRecipe,
      captions: makeCaptions(n),
      voUrls: makeUrls('v', n),
    })
    // render-assemble.ts throws when n !== vos.length; adapter must guarantee equality.
    expect(out.clip_urls.length).toBe(out.vo_urls.length)
    expect(out.scenes.length).toBe(out.clip_urls.length)
    // scene indices are 0..n-1 with no gaps — render-assemble looks up by .find(s.index === i)
    for (let i = 0; i < n; i += 1) {
      expect(out.scenes[i].index).toBe(i)
    }
  })
})

describe('composeRenderInput — fail closed on invalid input', () => {
  it('throws when recipe.shots is empty', () => {
    const emptyRecipe: ShotRecipe = { ...narrativeRecipe, shots: [] }
    expect(() =>
      composeRenderInput({
        assetUrls: makeUrls('a', 1),
        recipe: emptyRecipe,
        captions: ['c'],
        voUrls: makeUrls('v', 1),
      }),
    ).toThrow(VideoFactoryAdapterError)
  })

  it('throws when assetUrls shorter than recipe shot count', () => {
    const n = narrativeRecipe.shots.length
    expect(() =>
      composeRenderInput({
        assetUrls: makeUrls('a', n - 1),
        recipe: narrativeRecipe,
        captions: makeCaptions(n),
        voUrls: makeUrls('v', n),
      }),
    ).toThrow(/assetUrls 长度/)
  })

  it('throws when captions length does not match recipe shot count', () => {
    const n = narrativeRecipe.shots.length
    expect(() =>
      composeRenderInput({
        assetUrls: makeUrls('a', n),
        recipe: narrativeRecipe,
        captions: makeCaptions(n - 1),
        voUrls: makeUrls('v', n),
      }),
    ).toThrow(/captions 长度/)
  })

  it('throws when voUrls length does not match recipe shot count', () => {
    const n = narrativeRecipe.shots.length
    expect(() =>
      composeRenderInput({
        assetUrls: makeUrls('a', n),
        recipe: narrativeRecipe,
        captions: makeCaptions(n),
        voUrls: makeUrls('v', n - 1),
      }),
    ).toThrow(/voUrls 长度/)
  })

  it('throws when any assetUrls element is empty string', () => {
    const n = narrativeRecipe.shots.length
    const bad = makeUrls('a', n)
    bad[2] = ''
    expect(() =>
      composeRenderInput({
        assetUrls: bad,
        recipe: narrativeRecipe,
        captions: makeCaptions(n),
        voUrls: makeUrls('v', n),
      }),
    ).toThrow(/assetUrls\[2\]/)
  })

  it('throws when any voUrls element is empty', () => {
    const n = narrativeRecipe.shots.length
    const bad = makeUrls('v', n)
    bad[0] = ''
    expect(() =>
      composeRenderInput({
        assetUrls: makeUrls('a', n),
        recipe: narrativeRecipe,
        captions: makeCaptions(n),
        voUrls: bad,
      }),
    ).toThrow(/voUrls\[0\]/)
  })
})

describe('composeRenderInput — client-agnostic', () => {
  it('has no CTS/Roman/Oztop or any client identifier hardcoded', () => {
    const src = readFileSync(join(__dirname, '..', 'video-factory-adapter.ts'), 'utf8')
    // Comments may mention product concepts; identifiers must not appear as literals.
    expect(src).not.toMatch(/CTS Tours|Golden China|Roman Hu|Oztop|c0000000-0000-0000-0000-000000000000/i)
  })

  it('passes client provenance through call layer, not baked into shared runtime', () => {
    // The adapter never accepts or emits a client_id argument — provenance stays
    // outside; render-assemble's DB layer holds client_id in the JobRow envelope.
    const n = singleFocusRecipe.shots.length
    const out = composeRenderInput({
      assetUrls: makeUrls('a', n),
      recipe: singleFocusRecipe,
      captions: makeCaptions(n),
      voUrls: makeUrls('v', n),
    })
    const asAny = out as unknown as Record<string, unknown>
    expect(asAny.client_id).toBeUndefined()
    expect(asAny.clientId).toBeUndefined()
  })
})

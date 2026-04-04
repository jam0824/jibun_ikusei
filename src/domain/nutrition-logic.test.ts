import { describe, expect, it } from 'vitest'
import { aggregateMeals, judgeLabel, resolveDayNutrition } from '@/domain/nutrition-logic'
import type { NutrientEntry, NutrientMap, NutritionRecord } from '@/domain/types'

// テスト用ヘルパー
function makeEntry(value: number | null, overrides: Partial<NutrientEntry> = {}): NutrientEntry {
  return {
    value,
    unit: 'g',
    label: null,
    threshold: null,
    ...overrides,
  }
}

function makeNutrientMap(value: number | null = null): NutrientMap {
  return {
    energy:       makeEntry(value, { unit: 'kcal' }),
    protein:      makeEntry(value),
    fat:          makeEntry(value),
    carbs:        makeEntry(value),
    potassium:    makeEntry(value, { unit: 'mg' }),
    calcium:      makeEntry(value, { unit: 'mg' }),
    iron:         makeEntry(value, { unit: 'mg' }),
    vitaminA:     makeEntry(value, { unit: 'µg' }),
    vitaminE:     makeEntry(value, { unit: 'mg' }),
    vitaminB1:    makeEntry(value, { unit: 'mg' }),
    vitaminB2:    makeEntry(value, { unit: 'mg' }),
    vitaminB6:    makeEntry(value, { unit: 'mg' }),
    vitaminC:     makeEntry(value, { unit: 'mg' }),
    fiber:        makeEntry(value),
    saturatedFat: makeEntry(value),
    salt:         makeEntry(value),
  }
}

function makeRecord(mealType: NutritionRecord['mealType'], nutrients: NutrientMap): NutritionRecord {
  return {
    userId: 'user_1',
    date: '2026-04-04',
    mealType,
    nutrients,
    createdAt: '2026-04-04T00:00:00+09:00',
    updatedAt: '2026-04-04T00:00:00+09:00',
  }
}

// ---------------------------------------------------------------

describe('judgeLabel', () => {
  it('range: 下限〜上限の範囲内なら適正', () => {
    const result = judgeLabel(100, { type: 'range', lower: 80, upper: 120 })
    expect(result).toBe('適正')
  })

  it('range: 下限未満なら不足', () => {
    const result = judgeLabel(70, { type: 'range', lower: 80, upper: 120 })
    expect(result).toBe('不足')
  })

  it('range: 上限超過なら過剰', () => {
    const result = judgeLabel(130, { type: 'range', lower: 80, upper: 120 })
    expect(result).toBe('過剰')
  })

  it('range: 下限ちょうどは適正', () => {
    const result = judgeLabel(80, { type: 'range', lower: 80, upper: 120 })
    expect(result).toBe('適正')
  })

  it('range: 上限ちょうどは適正', () => {
    const result = judgeLabel(120, { type: 'range', lower: 80, upper: 120 })
    expect(result).toBe('適正')
  })

  it('min_only: 下限以上なら適正', () => {
    const result = judgeLabel(100, { type: 'min_only', lower: 80 })
    expect(result).toBe('適正')
  })

  it('min_only: 下限ちょうどは適正', () => {
    const result = judgeLabel(80, { type: 'min_only', lower: 80 })
    expect(result).toBe('適正')
  })

  it('min_only: 下限未満なら不足', () => {
    const result = judgeLabel(70, { type: 'min_only', lower: 80 })
    expect(result).toBe('不足')
  })

  it('max_only: 上限未満なら適正', () => {
    const result = judgeLabel(70, { type: 'max_only', upper: 80 })
    expect(result).toBe('適正')
  })

  it('max_only: 上限ちょうどは過剰', () => {
    const result = judgeLabel(80, { type: 'max_only', upper: 80 })
    expect(result).toBe('過剰')
  })

  it('max_only: 上限超過なら過剰', () => {
    const result = judgeLabel(90, { type: 'max_only', upper: 80 })
    expect(result).toBe('過剰')
  })
})

// ---------------------------------------------------------------

describe('aggregateMeals', () => {
  it('摂取量を単純合算する', () => {
    const breakfast = makeRecord('breakfast', {
      ...makeNutrientMap(0),
      protein: makeEntry(30),
    })
    const lunch = makeRecord('lunch', {
      ...makeNutrientMap(0),
      protein: makeEntry(40),
    })

    const result = aggregateMeals([breakfast, lunch])
    expect(result.nutrients.protein.value).toBe(70)
  })

  it('どちらか一方がnullの場合、null以外の値を合算に使う', () => {
    const breakfast = makeRecord('breakfast', {
      ...makeNutrientMap(null),
      protein: makeEntry(30),
    })
    const lunch = makeRecord('lunch', {
      ...makeNutrientMap(null),
      protein: makeEntry(null),
    })

    const result = aggregateMeals([breakfast, lunch])
    expect(result.nutrients.protein.value).toBe(30)
  })

  it('全レコードがnullの場合はnullを返す', () => {
    const breakfast = makeRecord('breakfast', makeNutrientMap(null))
    const lunch = makeRecord('lunch', makeNutrientMap(null))

    const result = aggregateMeals([breakfast, lunch])
    expect(result.nutrients.protein.value).toBeNull()
  })

  it('基準値は最初の1件を採用する', () => {
    const threshold1 = { type: 'range' as const, lower: 50, upper: 100 }
    const threshold2 = { type: 'range' as const, lower: 60, upper: 120 }

    const breakfast = makeRecord('breakfast', {
      ...makeNutrientMap(0),
      protein: { value: 30, unit: 'g', label: null, threshold: threshold1 },
    })
    const lunch = makeRecord('lunch', {
      ...makeNutrientMap(0),
      protein: { value: 40, unit: 'g', label: null, threshold: threshold2 },
    })

    const result = aggregateMeals([breakfast, lunch])
    expect(result.nutrients.protein.threshold).toEqual(threshold1)
  })

  it('合算後のラベルを再判定する（range: 適正）', () => {
    const threshold = { type: 'range' as const, lower: 50, upper: 100 }

    const breakfast = makeRecord('breakfast', {
      ...makeNutrientMap(0),
      protein: { value: 20, unit: 'g', label: '不足', threshold },
    })
    const lunch = makeRecord('lunch', {
      ...makeNutrientMap(0),
      protein: { value: 40, unit: 'g', label: '不足', threshold },
    })

    const result = aggregateMeals([breakfast, lunch])
    // 20 + 40 = 60 → range 50〜100 → 適正
    expect(result.nutrients.protein.label).toBe('適正')
  })

  it('合算後のラベルを再判定する（合算で過剰になる）', () => {
    const threshold = { type: 'range' as const, lower: 50, upper: 100 }

    const breakfast = makeRecord('breakfast', {
      ...makeNutrientMap(0),
      protein: { value: 60, unit: 'g', label: '適正', threshold },
    })
    const lunch = makeRecord('lunch', {
      ...makeNutrientMap(0),
      protein: { value: 60, unit: 'g', label: '適正', threshold },
    })

    const result = aggregateMeals([breakfast, lunch])
    // 60 + 60 = 120 → range 50〜100 → 過剰
    expect(result.nutrients.protein.label).toBe('過剰')
  })

  it('valueがnullの栄養素はlabelもnullのまま', () => {
    const result = aggregateMeals([makeRecord('breakfast', makeNutrientMap(null))])
    expect(result.nutrients.protein.label).toBeNull()
  })
})

// ---------------------------------------------------------------

describe('resolveDayNutrition', () => {
  it('1日分が存在する場合はそれを優先返却する', () => {
    const daily = makeRecord('daily', { ...makeNutrientMap(0), protein: makeEntry(100) })
    const breakfast = makeRecord('breakfast', { ...makeNutrientMap(0), protein: makeEntry(30) })
    const lunch = makeRecord('lunch', { ...makeNutrientMap(0), protein: makeEntry(40) })

    const result = resolveDayNutrition(daily, [breakfast, lunch])
    expect(result.mealType).toBe('daily')
    expect(result.nutrients.protein.value).toBe(100)
  })

  it('1日分がnullの場合は朝昼夜を合算して返却する', () => {
    const breakfast = makeRecord('breakfast', { ...makeNutrientMap(0), protein: makeEntry(30) })
    const lunch = makeRecord('lunch', { ...makeNutrientMap(0), protein: makeEntry(40) })

    const result = resolveDayNutrition(null, [breakfast, lunch])
    expect(result.nutrients.protein.value).toBe(70)
  })

  it('1日分も朝昼夜もない場合はnullのNutritionRecordを返す', () => {
    const result = resolveDayNutrition(null, [])
    expect(result.nutrients.protein.value).toBeNull()
  })
})

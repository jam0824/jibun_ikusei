import { NUTRIENT_KEYS } from '@/domain/nutrition-constants'
import type {
  MealType,
  NutrientEntry,
  NutrientKey,
  NutrientMap,
  NutrientThreshold,
  NutrientLabel,
  NutritionRecord,
} from '@/domain/types'

/**
 * 基準値と摂取量からラベルを判定する
 */
export function judgeLabel(value: number, threshold: NutrientThreshold): NutrientLabel {
  const { type, lower, upper } = threshold

  if (type === 'range') {
    if (lower !== undefined && value < lower) return '不足'
    if (upper !== undefined && value > upper) return '過剰'
    return '適正'
  }

  if (type === 'min_only') {
    if (lower !== undefined && value < lower) return '不足'
    return '適正'
  }

  // max_only
  if (upper !== undefined && value >= upper) return '過剰'
  return '適正'
}

/**
 * NutrientEntry を合算する（摂取量合算・基準値は最初の1件・ラベルは再判定）
 */
function mergeEntries(entries: NutrientEntry[]): NutrientEntry {
  const first = entries[0]

  // 摂取量合算（nullは0扱い、全nullならnull）
  const hasAnyValue = entries.some((e) => e.value !== null)
  const totalValue = hasAnyValue
    ? entries.reduce((sum, e) => sum + (e.value ?? 0), 0)
    : null

  // 基準値は最初の1件
  const threshold = first.threshold ?? null

  // ラベル再判定
  const label: NutrientLabel | null =
    totalValue !== null && threshold !== null
      ? judgeLabel(totalValue, threshold)
      : null

  return {
    value: totalValue,
    unit: first.unit,
    label,
    threshold,
  }
}

/**
 * 空のNutrientMapを生成する（全値null）
 */
function makeEmptyNutrientMap(): NutrientMap {
  const unitMap: Record<NutrientKey, string> = {
    energy: 'kcal',
    protein: 'g',
    fat: 'g',
    carbs: 'g',
    potassium: 'mg',
    calcium: 'mg',
    iron: 'mg',
    vitaminA: 'µg',
    vitaminE: 'mg',
    vitaminB1: 'mg',
    vitaminB2: 'mg',
    vitaminB6: 'mg',
    vitaminC: 'mg',
    fiber: 'g',
    saturatedFat: 'g',
    salt: 'g',
  }

  return Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [
      key,
      { value: null, unit: unitMap[key], label: null, threshold: null },
    ]),
  ) as NutrientMap
}

/**
 * 朝・昼・夜などの複数レコードを合算して1件のNutritionRecordを返す
 */
export function aggregateMeals(records: NutritionRecord[]): NutritionRecord {
  if (records.length === 0) {
    const now = new Date().toISOString()
    return {
      userId: '',
      date: '',
      mealType: 'daily' as MealType,
      nutrients: makeEmptyNutrientMap(),
      createdAt: now,
      updatedAt: now,
    }
  }

  const first = records[0]
  const now = new Date().toISOString()

  const nutrients = Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [
      key,
      mergeEntries(records.map((r) => r.nutrients[key])),
    ]),
  ) as NutrientMap

  return {
    userId: first.userId,
    date: first.date,
    mealType: 'daily',
    nutrients,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 1日分が存在すればそれを優先、なければ朝昼夜を合算して返す
 */
export function resolveDayNutrition(
  daily: NutritionRecord | null,
  meals: NutritionRecord[],
): NutritionRecord {
  if (daily !== null) return daily
  return aggregateMeals(meals)
}

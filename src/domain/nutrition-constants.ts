import type { NutrientKey } from '@/domain/types'

export interface NutrientMeta {
  key: NutrientKey
  name: string
  unit: string
}

export const NUTRIENT_META: NutrientMeta[] = [
  { key: 'energy',       name: 'エネルギー',   unit: 'kcal' },
  { key: 'protein',      name: 'たんぱく質',   unit: 'g' },
  { key: 'fat',          name: '脂質',         unit: 'g' },
  { key: 'carbs',        name: '糖質',         unit: 'g' },
  { key: 'potassium',    name: 'カリウム',     unit: 'mg' },
  { key: 'calcium',      name: 'カルシウム',   unit: 'mg' },
  { key: 'iron',         name: '鉄',           unit: 'mg' },
  { key: 'vitaminA',     name: 'ビタミンA',    unit: 'µg' },
  { key: 'vitaminE',     name: 'ビタミンE',    unit: 'mg' },
  { key: 'vitaminB1',    name: 'ビタミンB1',   unit: 'mg' },
  { key: 'vitaminB2',    name: 'ビタミンB2',   unit: 'mg' },
  { key: 'vitaminB6',    name: 'ビタミンB6',   unit: 'mg' },
  { key: 'vitaminC',     name: 'ビタミンC',    unit: 'mg' },
  { key: 'fiber',        name: '食物繊維',     unit: 'g' },
  { key: 'saturatedFat', name: '飽和脂肪酸',   unit: 'g' },
  { key: 'salt',         name: '塩分',         unit: 'g' },
] as const

export const NUTRIENT_KEYS: NutrientKey[] = NUTRIENT_META.map((m) => m.key)

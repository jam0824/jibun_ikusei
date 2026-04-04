import type { NutrientKey, NutrientThreshold } from '@/domain/types'

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

export const DEFAULT_DAILY_NUTRIENT_THRESHOLDS: Record<NutrientKey, NutrientThreshold> = {
  energy:       { type: 'range',    lower: 1839, upper: 2239 },
  protein:      { type: 'range',    lower: 76.5, upper: 178.4 },
  fat:          { type: 'range',    lower: 56.6, upper: 79.3 },
  carbs:        { type: 'range',    lower: 152.9, upper: 254.9 },
  potassium:    { type: 'min_only', lower: 3000 },
  calcium:      { type: 'range',    lower: 750, upper: 2500 },
  iron:         { type: 'min_only', lower: 7.5 },
  vitaminA:     { type: 'range',    lower: 900, upper: 2700 },
  vitaminE:     { type: 'range',    lower: 6.5, upper: 800 },
  vitaminB1:    { type: 'min_only', lower: 1 },
  vitaminB2:    { type: 'min_only', lower: 1.4 },
  vitaminB6:    { type: 'range',    lower: 1.5, upper: 60 },
  vitaminC:     { type: 'min_only', lower: 100 },
  fiber:        { type: 'min_only', lower: 22 },
  saturatedFat: { type: 'max_only', upper: 15.86 },
  salt:         { type: 'max_only', upper: 7.5 },
}

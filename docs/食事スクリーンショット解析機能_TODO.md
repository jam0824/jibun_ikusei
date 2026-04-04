# 食事スクリーンショット解析機能 TODOリスト

テスト用画像: `images/meal_screenshot.png`（実機スクリーンショット確認済み）
- 「1日分」タブ表示あり
- 16栄養素・摂取量・ラベル（不足/適正/過剰）・基準値 すべて確認済み
- ラベル色: 通常食品=緑、お酒=黄、お菓子=橙、サプリ=青、適正ゾーン=緑枠

---

## Phase 0: Mock UI（UI確認用） ✅ 完了

目標: データなし・ハードコードで画面遷移とレイアウトを確認できる状態

- [x] **0-1** フッター「追加」→ `/quests/new` に直遷移、クエスト追加/食事登録タブを各画面上部に配置
  - `src/components/layout.tsx`: AddSheet 削除、NavLink に戻す
  - `src/screens/quest-form-screen.tsx`: 新規追加時のみ上部タブバー表示
  - `src/screens/meal-register-screen.tsx`: 上部タブバー表示

- [x] **0-2** 食事登録画面（モック）`src/screens/meal-register-screen.tsx`
  - 登録日（JST当日デフォルト、タップでカレンダー選択）
  - 区分カード: 1日分 / 朝 / 昼 / 夜（「未登録」Badge表示）

- [x] **0-3** 解析フロー画面（モック）
  - `src/screens/meal-analyze-screen.tsx`: 画像選択 + 2秒モックローディング
  - `src/screens/meal-confirm-screen.tsx`: 16栄養素確認・摂取量編集・保存

- [x] **0-4** 食事記録表示（モック）
  - `src/screens/records-screen.tsx` に「栄養」タブ追加
  - 横棒グラフ（不足=青 / 適正=緑 / 過剰=赤）
  - 上部に日付ピッカー（タップでカレンダー表示、日付変更可）

---

## Phase 1: 型定義・ドメインロジック ✅ 完了

目標: TypeScript型とビジネスロジックを整備・テスト済みにする

- [x] **1-1** 型定義追加 `src/domain/types.ts`
  - `MealType` / `NutrientLabel` / `ThresholdType` / `NutrientThreshold`
  - `NutrientEntry` / `NutrientKey` / `NutrientMap` / `NutritionRecord`

- [x] **1-2** 栄養素定数ファイル `src/domain/nutrition-constants.ts`
  - `NUTRIENT_META`: 16栄養素の名前・単位リスト
  - `NUTRIENT_KEYS`: キー一覧（ループ・型生成に使用）

- [x] **1-3** ラベル判定ロジック（TDD）`src/domain/nutrition-logic.ts`
  - `judgeLabel(value, threshold): NutrientLabel` — 11テスト全パス

- [x] **1-4** 合算ロジック（TDD）`src/domain/nutrition-logic.ts`
  - `aggregateMeals(records): NutritionRecord` — 7テスト全パス
  - `resolveDayNutrition(daily, meals): NutritionRecord` — 3テスト全パス
  - 合計 121テスト全パス確認済み

---

## Phase 2: GPT-5 画像解析連携 ✅ 完了

目標: 実際にスクリーンショットを解析して栄養素を抽出できる

- [x] **2-1** 画像選択コンポーネント `src/screens/meal-analyze-screen.tsx`
  - ファイルピッカー（image/*）・プレビュー表示
  - `fileToBase64()` で base64 + mimeType 変換

- [x] **2-2** GPT-5 API呼び出し関数 `src/lib/nutrition-analyzer.ts`
  - OpenAI Chat Completions API（vision）で base64 画像を送信
  - Zod スキーマでレスポンスをバリデーション
  - `isValid: false` で不正画像を検出しエラーを throw

- [x] **2-3** エラーハンドリング
  - `NutritionAnalyzeError` クラスでエラー分類
  - 対象外画像・API失敗・JSONパース失敗のメッセージを画面に表示
  - 解析中はボタン disabled

- [x] **2-4** 解析フローのUI接続
  - モック自動遷移 → 実 API 呼び出しに切り替え
  - 結果を `navigate(state: { nutrients })` で confirm 画面に受け渡し
  - confirm 画面は `location.state` がなければモックデータにフォールバック

---

## Phase 3: DynamoDB 保存・取得 ✅ 完了

目標: データを永続化できる

- [x] **3-1** Lambda ハンドラー `infra/lambda/nutritionHandler/index.mjs`
  - SK: `NUTRITION#{date}#{mealType}` （既存の `HEALTH#{date}#{time}` パターンに準拠）
  - `GET /nutrition?date=YYYY-MM-DD` → 全4区分を返却（未登録は null）
  - `PUT /nutrition/{date}/{mealType}` → upsert
  - TDD: 8テスト全パス

- [x] **3-2** API クライアント `src/lib/api-client.ts`
  - `getNutrition(date)` / `putNutrition(date, mealType, record)`
  - `NutritionDayResult` 型エクスポート

- [x] **3-3** 上書き確認ダイアログ `src/screens/meal-confirm-screen.tsx`
  - 保存前にキャッシュ or API で既存データを確認
  - `window.confirm` で上書き確認

- [x] **3-4** app-store `src/store/app-store.ts`
  - `nutritionCache: Record<string, NutritionDayResult>` ステート
  - `fetchNutrition(date)` / `saveNutrition(date, mealType, record)` アクション

- [x] **3-5** CDK スタック `infra/lib/jibun-ikusei-stack.ts`
  - `nutritionFn` Lambda 追加
  - `GET /nutrition` / `PUT /nutrition/{date}/{mealType}` ルート追加

---

## Phase 4: 食事記録表示の完成

目標: 記録画面で栄養データを正しく表示する

- [ ] **4-1** 記録画面に栄養素セクションを組み込み `src/screens/records-screen.tsx`
  - 日付ナビゲーション（前後移動）
  - 1日分優先 / 朝昼夜合算ロジックの適用
  - データ取得中のローディング表示

- [ ] **4-2** 横棒グラフの完成
  - 基準値に対する摂取量の割合でバー幅計算
  - 色分け実装（不足=青 / 適正=緑 / 過剰=赤）
  - 「未取得」項目の表示（数値なしの灰色表示）
  - 基準値ラベル（下限〜上限）の表示

---

## Phase 5: リリィ tool search 対応

目標: リリィが食事データを参照・回答できる

- [ ] **5-1** `getNutrition` ツール定義追加 `src/lib/chat-tools.ts`
  - 引数: 日付（YYYY-MM-DD）
  - 返却: daily / breakfast / lunch / dinner の全栄養素
  - 未取得項目は `"未取得"` 文字列で返却

- [ ] **5-2** ツール定義と仕様書（Section 8）の整合性確認

---

## 実装メモ

### テスト画像から読み取ったハードコード値（Phase 0用）

| 栄養素 | 摂取量 | 単位 | ラベル | 基準値 |
|--------|--------|------|--------|--------|
| エネルギー | 1822 | kcal | 不足 | 1839〜2239 |
| たんぱく質 | 83.3 | g | 適正 | 73.8〜178.4 |
| 脂質 | 68.2 | g | 適正 | 56.6〜79.3 |
| 糖質 | 224.4 | g | 適正 | 152.9〜254.9 |
| カリウム | 1704 | mg | 不足 | 3000以上 |
| カルシウム | 472 | mg | 不足 | 750〜2500 |
| 鉄 | 13.7 | mg | 適正 | 7.5以上 |
| ビタミンA | 2977 | ug | 過剰 | 900〜2700 |
| ビタミンE | 17 | mg | 適正 | 6.5〜800 |
| ビタミンB1 | 3.5 | mg | 適正 | 1以上 |
| ビタミンB2 | 3.59 | mg | 適正 | 1.4以上 |
| ビタミンB6 | 4.47 | mg | 適正 | 1.5〜60 |
| ビタミンC | 136 | mg | 適正 | 100以上 |
| 食物繊維 | 14.5 | g | 不足 | 22以上 |
| 飽和脂肪酸 | 17.77 | g | 過剰 | 15.86未満 |
| 塩分 | 7.1 | g | 適正 | 7.5未満 |

### 推奨実装順

```
Phase 0（Mock UI）
  → Phase 1（型定義・ロジック）※ Phase 0 と並行可
    → Phase 2（GPT-5解析）
      → Phase 3（DynamoDB）
        → Phase 4（記録表示完成）
          → Phase 5（リリィ tool search）
```

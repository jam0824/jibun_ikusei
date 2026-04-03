# 食事スクリーンショット解析機能 TODOリスト

テスト用画像: `images/meal_screenshot.png`（実機スクリーンショット確認済み）
- 「1日分」タブ表示あり
- 16栄養素・摂取量・ラベル（不足/適正/過剰）・基準値 すべて確認済み
- ラベル色: 通常食品=緑、お酒=黄、お菓子=橙、サプリ=青、適正ゾーン=緑枠

---

## Phase 0: Mock UI（UI確認用）

目標: データなし・ハードコードで画面遷移とレイアウトを確認できる状態

- [ ] **0-1** フッター「追加」ボタンをボトムシート化
  - `/quests/new` への直リンクをボトムシートに変更
  - タブ切り替え: 「クエスト追加」（既存フォーム）/ 「食事登録」（新規）
  - デフォルトはクエスト追加タブ

- [ ] **0-2** 食事登録画面（モック）`src/screens/meal-register-screen.tsx`
  - 登録日表示（デフォルト当日、タップでカレンダー選択）
  - 区分カード一覧: 1日分 / 朝 / 昼 / 夜
  - 各カードに「登録済み」「未登録」状態の表示

- [ ] **0-3** 解析フロー画面（モック）
  - 区分タップ → ファイルピッカー起動（実際に選択不要でスキップ可）
  - 「解析中」ローディング画面（タイマーで自動遷移）
  - 確認画面 `src/screens/meal-confirm-screen.tsx`
    - ハードコードの16栄養素データを表示（meal_screenshot.png の値を使用）
    - 摂取量のみ編集可能なフォーム
    - 保存ボタン（アラートで完了表示）

- [ ] **0-4** 食事記録表示（モック）
  - 既存の `records-screen.tsx` に栄養素セクションを追加
  - 横棒グラフ: 不足=青 / 適正=緑 / 過剰=赤
  - ハードコードデータで表示確認
  - 「未取得」項目の表示確認

---

## Phase 1: 型定義・ドメインロジック

目標: TypeScript型とビジネスロジックを整備・テスト済みにする

- [ ] **1-1** 型定義追加 `src/domain/types.ts`
  - `MealType`: `'daily' | 'breakfast' | 'lunch' | 'dinner'`
  - `NutrientLabel`: `'不足' | '適正' | '過剰'`
  - `ThresholdType`: `'range' | 'min_only' | 'max_only'`
  - `NutrientThreshold`: `{ lower?: number; upper?: number; type: ThresholdType }`
  - `NutrientEntry`: 摂取量 / ラベル / 基準値 / 単位
  - `NutritionRecord`: ユーザーID / 日付 / 区分 / 16栄養素 / createdAt / updatedAt

- [ ] **1-2** 栄養素定数ファイル `src/domain/nutrition-constants.ts`
  - 16栄養素の名前・単位の固定値リスト
  - ビタミンAは `ug`、他は仕様書の単位

- [ ] **1-3** ラベル判定ロジック（TDD）`src/domain/nutrition-logic.ts`
  - `judgeLabel(value, threshold): NutrientLabel`
  - range: 下限〜上限で判定
  - min_only: 下限以上で適正
  - max_only: 上限未満で適正

- [ ] **1-4** 合算ロジック（TDD）`src/domain/nutrition-logic.ts`
  - `aggregateMeals(records: NutritionRecord[]): NutritionRecord`
  - 摂取量: 単純合算
  - 基準値: 最初の1件を採用
  - ラベル: 合算後に再判定
  - `resolveDayNutrition(daily, meals): NutritionRecord`（1日分優先ロジック）

---

## Phase 2: GPT-5 画像解析連携

目標: 実際にスクリーンショットを解析して栄養素を抽出できる

- [ ] **2-1** 画像選択コンポーネント
  - ファイルピッカー（JPEG/PNG）
  - 選択後プレビュー表示
  - base64エンコード処理

- [ ] **2-2** GPT-5 API呼び出し関数 `src/lib/nutrition-analyzer.ts`
  - base64画像をvision APIに送信
  - プロンプト設計: 16栄養素を構造化JSONで返させる
  - レスポンスパース・スキーマバリデーション
  - 検証条件: 「1日分」表示あり・16栄養素一覧あり

- [ ] **2-3** エラーハンドリング
  - 対象外画像のエラーメッセージ表示
  - API失敗・タイムアウト時のエラー表示
  - 保存ボタンの非活性化

- [ ] **2-4** 解析フローのUI接続
  - Phase 0 のモック自動遷移 → 実際のAPI呼び出しに切り替え
  - ローディング中のキャンセル対応

---

## Phase 3: DynamoDB 保存・取得

目標: データを永続化できる

- [ ] **3-1** 保存API `src/lib/api-client.ts`
  - `PUT /nutrition` エンドポイント
  - キー: ユーザーID + 日付 + 区分

- [ ] **3-2** 取得API `src/lib/api-client.ts`
  - `GET /nutrition?date=YYYY-MM-DD`
  - daily / breakfast / lunch / dinner 全件返却
  - 未登録区分は `null` で返却

- [ ] **3-3** 上書き確認ダイアログ
  - 同一キーのデータ存在チェック
  - 確認ダイアログ表示後に上書き保存

- [ ] **3-4** app-store への栄養素状態追加 `src/store/app-store.ts`
  - `nutritionRecords` ステート
  - `fetchNutrition(date)` / `saveNutrition(record)` アクション

- [ ] **3-5** インフラ定義 `infra/`
  - DynamoDB テーブル定義（主キー: userId + date + mealType）
  - API Gateway / Lambda エンドポイント定義

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

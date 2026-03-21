# AWS CDK ガイド（自分育成アプリ）

## CDK とは何か

AWS CDK（Cloud Development Kit）は、**TypeScript などのプログラミング言語で AWS のインフラを定義・管理するツール**です。

従来の方法では AWS コンソール（ブラウザの管理画面）でポチポチ設定していましたが、CDK を使うと：

- インフラの設定を**コードとしてバージョン管理**できる（何を変更したか履歴が残る）
- **同じ環境を何度でも再現**できる（壊しても作り直せる）
- **チームで共有**できる（「この設定どうなってたっけ？」がなくなる）

### 例え

AWS コンソールでの作業 = 手作業で料理を作る（レシピが頭の中にしかない）
CDK = レシピを書き留めておく（誰でも同じ料理を再現できる）

---

## このプロジェクトの構成

```
infra/
├── bin/
│   └── app.ts          ← エントリーポイント（CDKアプリの起動点）
├── lib/
│   └── jibun-ikusei-stack.ts  ← スタック定義（全リソースをここに書く）
├── lambda/
│   ├── questHandler/        ← Lambda関数のコード
│   ├── completionHandler/
│   ├── skillHandler/
│   ├── userConfigHandler/
│   ├── messageHandler/
│   ├── migrateState/
│   ├── getState/
│   ├── putState/
│   ├── shared-layer/       ← Lambda Layer（共通ユーティリティ）
│   └── __tests__/           ← Lambdaのテスト
├── cdk.json             ← CDKの設定ファイル
├── package.json
├── tsconfig.json
└── vitest.config.mjs
```

### 各ファイルの役割

#### `bin/app.ts` — エントリーポイント

```typescript
const app = new cdk.App()
new JibunIkuseiStack(app, 'JibunIkuseiStack', {
  env: { region: 'ap-northeast-1' },  // 東京リージョン
})
```

CDK が最初に読むファイル。「JibunIkuseiStack というスタックを東京リージョンに作ってね」と指示している。

#### `lib/jibun-ikusei-stack.ts` — スタック定義（メインファイル）

AWS 上に作るリソースを全て定義している。このプロジェクトでは：

| リソース | 何をするか |
|---------|-----------|
| **DynamoDB テーブル** | データの保存先（クエスト、スキル、完了記録など） |
| **Cognito ユーザープール** | ユーザー認証（ログイン管理） |
| **Lambda 関数 × 8** | APIのバックエンド処理 |
| **Lambda Layer** | Lambda間で共有するコード |
| **API Gateway (HTTP API)** | フロントエンドからのリクエストを受け付けるエンドポイント |

#### `cdk.json` — CDK設定

CDK に「`bin/app.ts` を `ts-node` で実行してね」と教える設定ファイル。基本的に触らない。

---

## 重要な概念

### スタック (Stack)

AWS リソースのまとまり。1つのスタック = 1つのデプロイ単位。
`JibunIkuseiStack` には DynamoDB、Cognito、Lambda、API Gateway が全て入っている。

デプロイすると、AWS 上に **CloudFormation スタック** として管理される。
AWS コンソール → CloudFormation で確認できる。

### コンストラクト (Construct)

スタックの中の個々のリソース。例：

```typescript
// DynamoDB テーブルを定義
const table = new dynamodb.Table(this, 'Table', {
  tableName: 'jibun-ikusei-cdk',        // テーブル名
  partitionKey: { name: 'PK', ... },     // プライマリキー
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // 従量課金
})

// Lambda 関数を定義
const questFn = new lambda.Function(this, 'QuestHandler', {
  functionName: 'jibun-ikusei-questHandler',
  runtime: lambda.Runtime.NODEJS_24_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/questHandler')),
  environment: { TABLE_NAME: table.tableName },
})

// Lambda に DynamoDB の読み書き権限を付与
table.grantReadWriteData(questFn)
```

ポイント：
- `this` の後の文字列（`'Table'`, `'QuestHandler'`）は**論理ID**。スタック内で一意であればOK
- `table.grantReadWriteData(fn)` のように、**権限を1行で設定**できる（AWS コンソールだと IAM ポリシーを手動設定する必要がある）

### Lambda Layer

複数の Lambda 関数で共通のコードを共有する仕組み。

```
lambda/shared-layer/nodejs/utils.mjs  ← 共通コード（DB接続、レスポンス生成など）
```

各 Lambda は `import { db } from "/opt/nodejs/utils.mjs"` でこのコードを使う。
`/opt/nodejs/` は AWS Lambda が Layer を配置するパス。

---

## よく使うコマンド

全て `infra/` ディレクトリで実行する。

### デプロイ前の確認

```bash
npx cdk diff
```

今のコードと AWS 上の状態を比較して、**何が変わるかを表示**する。
実際には何も変更しないので安全。デプロイ前に必ず確認するとよい。

### デプロイ

```bash
npx cdk deploy
```

コードの内容を AWS に反映する。変更があるリソースだけ更新される。
初回は全リソースを新規作成、2回目以降は差分のみ適用。

`--require-approval never` を付けると確認なしでデプロイする：

```bash
npx cdk deploy --require-approval never
```

### テンプレート生成（デプロイはしない）

```bash
npx cdk synth
```

CloudFormation テンプレート（JSON/YAML）を生成して `cdk.out/` に出力する。
デプロイせずに「CDK がどんなリソースを作ろうとしているか」を確認したいときに使う。

### スタック削除

```bash
npx cdk destroy
```

AWS 上のリソースを全て削除する。ただし `removalPolicy: RETAIN` のリソース（DynamoDB テーブル、Cognito ユーザープールなど）は削除されずに残る。

---

## リソースの追加方法

### 新しい Lambda を追加する例

1. `lambda/newHandler/index.mjs` にコードを書く
2. `lib/jibun-ikusei-stack.ts` に以下を追加：

```typescript
const newFn = new lambda.Function(this, 'NewHandler', {
  ...lambdaDefaults,
  functionName: 'jibun-ikusei-newHandler',
  code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/newHandler')),
})
table.grantReadWriteData(newFn)
```

3. API ルートを追加：

```typescript
const newIntegration = new integrations.HttpLambdaIntegration('NewIntegration', newFn)
api.addRoutes({
  path: '/new-endpoint',
  methods: [apigwv2.HttpMethod.GET],
  integration: newIntegration,
})
```

4. `npx cdk diff` で確認 → `npx cdk deploy` でデプロイ

---

## このプロジェクトの API 構成

### エンドポイント一覧

| パス | メソッド | Lambda | 説明 |
|------|---------|--------|------|
| `/sync` | GET | getState | 全データ一括取得（旧方式、移行期間中） |
| `/sync` | PUT | putState | 全データ一括保存（旧方式、移行期間中） |
| `/quests` | GET/POST | questHandler | クエスト一覧取得・作成 |
| `/quests/{id}` | PUT/DELETE | questHandler | クエスト更新・削除 |
| `/completions` | GET/POST | completionHandler | 完了記録一覧・作成 |
| `/completions/{id}` | PUT | completionHandler | 完了記録更新 |
| `/skills` | GET/POST | skillHandler | スキル一覧・作成 |
| `/skills/{id}` | PUT | skillHandler | スキル更新 |
| `/user` | GET/PUT | userConfigHandler | ユーザープロフィール |
| `/settings` | GET/PUT | userConfigHandler | アプリ設定 |
| `/ai-config` | GET/PUT | userConfigHandler | AI設定 |
| `/meta` | GET/PUT | userConfigHandler | メタデータ |
| `/messages` | GET/POST | messageHandler | アシスタントメッセージ |
| `/dictionary` | GET/POST | messageHandler | スキル辞書 |
| `/dictionary/{id}` | PUT | messageHandler | 辞書エントリ更新 |

全てのエンドポイントは **Cognito JWT 認証**が必要（Authorization ヘッダーに Bearer トークンを付ける）。

### DynamoDB のデータ構造

シングルテーブル設計。1つのテーブルに全データを格納する。

| PK（パーティションキー） | SK（ソートキー） | 内容 |
|---|---|---|
| `user#<cognito-sub>` | `USER#profile` | ユーザー情報 |
| `user#<cognito-sub>` | `SETTINGS#main` | アプリ設定 |
| `user#<cognito-sub>` | `AICONFIG#main` | AI設定 |
| `user#<cognito-sub>` | `META#main` | メタデータ |
| `user#<cognito-sub>` | `QUEST#<id>` | 各クエスト |
| `user#<cognito-sub>` | `COMPLETION#<id>` | 各完了記録 |
| `user#<cognito-sub>` | `SKILL#<id>` | 各スキル |
| `user#<cognito-sub>` | `MSG#<id>` | 各メッセージ |
| `user#<cognito-sub>` | `DICT#<id>` | 各辞書エントリ |

`cognito-sub` はユーザーごとに一意な ID。同じユーザーのデータは全て同じ PK を持つので、`PK = user#xxx` で検索すればそのユーザーの全データが取れる。

---

## トラブルシューティング

### デプロイが失敗したとき

1. CloudFormation コンソールでエラーメッセージを確認
2. `npx cdk diff` で変更内容を確認
3. 問題を修正して再度 `npx cdk deploy`

CloudFormation は**ロールバック**機能があるので、デプロイ失敗しても前の状態に戻る。

### Lambda が動かないとき

1. AWS コンソール → Lambda → 該当関数 → 「テスト」タブで手動実行
2. CloudWatch Logs でエラーログを確認
3. Lambda のコードを修正 → `npx cdk deploy` で再デプロイ

### 「Resource already exists」エラー

CDK 外で手動作成したリソースと名前が衝突している。
解決策：手動リソースを削除するか、CDK 側の名前を変更する。

---

## AWS コンソールでの確認方法

| 見たいもの | AWS コンソールの場所 |
|-----------|-------------------|
| デプロイ状況 | CloudFormation → スタック → JibunIkuseiStack |
| API のURL | API Gateway → jibun-ikusei-api-cdk |
| Lambda のログ | CloudWatch → ロググループ → /aws/lambda/jibun-ikusei-* |
| DB の中身 | DynamoDB → テーブル → jibun-ikusei-cdk → 項目を探索 |
| ユーザー管理 | Cognito → ユーザープール → jibun-ikusei-users-cdk |

---

## コスト

現在の構成は全て**無料枠内**で運用可能：

| サービス | 無料枠 |
|---------|-------|
| DynamoDB | 25GB ストレージ + 読み書き各25ユニット/秒 |
| Lambda | 月100万リクエスト + 40万GB秒 |
| API Gateway | 月100万リクエスト（12ヶ月間） |
| Cognito | 月5万MAU |
| CloudFormation | 無料 |

個人利用であれば課金される可能性はほぼゼロ。

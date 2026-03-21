# GitHub Actions デプロイガイド（自分育成アプリ）

## GitHub Actions とは

GitHub Actions は、**GitHub にコードを push したら自動で何かを実行してくれる仕組み**。

このプロジェクトでは「main ブランチに push したら、自動でビルドして GitHub Pages にデプロイする」という設定をしている。

### 例え

手動デプロイ = 毎回自分で料理して配達する
GitHub Actions = 注文が入ったら自動で調理・配達してくれるロボット

---

## 全体の流れ

```
① dev ブランチで開発・コミット
     ↓
② GitHub に push
     ↓
③ Pull Request を作成（dev → main）
     ↓
④ マージ（main ブランチに変更が入る）
     ↓
⑤ GitHub Actions が自動起動 ← ここから自動
     ↓
⑥ ビルド（npm run build）
     ↓
⑦ GitHub Pages にデプロイ
     ↓
⑧ https://jam0824.github.io/jibun_ikusei/ に反映
```

自分がやるのは ①〜④ まで。⑤〜⑧ は GitHub が自動でやってくれる。

---

## ワークフローファイルの解説

設定ファイルは `.github/workflows/deploy-pages.yml` にある。1行ずつ解説する。

### トリガー（いつ実行するか）

```yaml
name: Deploy GitHub Pages    # ワークフローの名前（何でもOK）

on:
  push:
    branches:
      - main                 # main ブランチに push されたとき
  workflow_dispatch:          # 手動実行も可能にする
```

- `on: push: branches: [main]` → main に push（マージ含む）されたら自動実行
- `workflow_dispatch` → GitHub の Actions タブから手動で実行もできる

**dev ブランチへの push では実行されない。** main に入ったときだけ動く。

### 権限

```yaml
permissions:
  contents: read     # リポジトリの中身を読む権限
  pages: write       # GitHub Pages に書き込む権限
  id-token: write    # デプロイ用の認証トークン
```

GitHub Pages へのデプロイに必要な権限。基本的に触らない。

### 同時実行制御

```yaml
concurrency:
  group: pages
  cancel-in-progress: true
```

「連続で push しても、前のデプロイが終わる前に新しいのが来たら古い方をキャンセルする」という設定。無駄な重複デプロイを防ぐ。

### ビルドジョブ

```yaml
jobs:
  build:
    runs-on: ubuntu-latest    # Ubuntu（Linux）マシンで実行
```

GitHub が用意するクラウド上の Linux マシンで実行される。自分の PC は使わない。

#### ステップ 1: コードを取得

```yaml
    steps:
      - name: Checkout
        uses: actions/checkout@v4
```

リポジトリのコードを GitHub のサーバー上にダウンロード。`git clone` と同じ。

#### ステップ 2: Node.js をセットアップ

```yaml
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22     # Node.js のバージョン
          cache: npm           # node_modules のキャッシュを有効化（高速化）
```

ビルドに必要な Node.js をインストール。`cache: npm` で2回目以降のインストールが速くなる。

#### ステップ 3: GitHub Pages の設定

```yaml
      - name: Configure Pages
        uses: actions/configure-pages@v5
```

GitHub Pages のデプロイに必要な初期設定。おまじない。

#### ステップ 4: 依存パッケージのインストール

```yaml
      - name: Install dependencies
        run: npm install --legacy-peer-deps
```

`npm install` でパッケージをインストール。`--legacy-peer-deps` は依存関係の衝突を無視するオプション。

#### ステップ 5: ビルド（最重要）

```yaml
      - name: Build
        run: npm run build
        env:
          VITE_API_BASE_URL: ${{ secrets.VITE_API_BASE_URL }}
          VITE_COGNITO_USER_POOL_ID: ${{ secrets.VITE_COGNITO_USER_POOL_ID }}
          VITE_COGNITO_CLIENT_ID: ${{ secrets.VITE_COGNITO_CLIENT_ID }}
          VITE_COGNITO_REGION: ${{ secrets.VITE_COGNITO_REGION }}
```

`npm run build`（= `tsc -b && vite build`）を実行して、TypeScript をコンパイルし、本番用のファイルを `dist/` フォルダに生成する。

**`env:` の部分が重要：**

- `${{ secrets.VITE_API_BASE_URL }}` → GitHub に保存した秘密の値を環境変数として渡す
- ビルド時に Vite がこれらの値をコードに埋め込む
- `.env` ファイルはリポジトリにないので、Secrets から注入する必要がある

#### ステップ 6: ビルド成果物をアップロード

```yaml
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist          # dist/ フォルダの中身をアップロード
```

ビルドで生成された `dist/` フォルダを、次のデプロイジョブで使えるようにアップロード。

### デプロイジョブ

```yaml
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    needs: build              # build ジョブが完了してから実行
    runs-on: ubuntu-latest

    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- `needs: build` → ビルドが終わってからデプロイする
- `actions/deploy-pages@v4` → アップロードされた成果物を GitHub Pages に公開

---

## GitHub Secrets（秘密の環境変数）

### Secrets とは

API キーや URL など、**コードに直接書きたくない値**を GitHub に安全に保存する仕組み。

リポジトリの Settings → Secrets and variables → Actions で管理する。

### 現在設定されている Secrets

| 名前 | 値 | 説明 |
|------|------|------|
| `VITE_API_BASE_URL` | `https://kzt5678s5b.execute-api.ap-northeast-1.amazonaws.com` | API Gateway のURL |
| `VITE_COGNITO_USER_POOL_ID` | `ap-northeast-1_sdcbFbWBY` | Cognito ユーザープールID |
| `VITE_COGNITO_CLIENT_ID` | `4vcj0n0b0b55354k29frt2q6ku` | Cognito クライアントID |
| `VITE_COGNITO_REGION` | `ap-northeast-1` | AWSリージョン（東京） |

### Secrets の変更方法

1. GitHub のリポジトリページを開く
2. **Settings** タブ → 左メニューの **Secrets and variables** → **Actions**
3. 変更したい Secret の右の鉛筆アイコンをクリック
4. 新しい値を入力して **Update secret**

**注意：** Secret を変更しても、すぐには反映されない。次にデプロイ（main への push）が走ったときに新しい値が使われる。すぐに反映したい場合は手動実行する（後述）。

---

## よくある操作

### 通常のデプロイ（自動）

```
1. dev ブランチで作業・コミット
2. git push origin dev
3. GitHub で Pull Request を作成（dev → main）
4. マージする
5. 自動的にデプロイが始まる（2〜3分で完了）
```

### デプロイの状況を確認する

1. GitHub のリポジトリページ → **Actions** タブ
2. 最新のワークフロー実行をクリック
3. 各ステップの実行状況とログが見られる

ステータス：
- 🟡 黄色 = 実行中
- ✅ 緑 = 成功
- ❌ 赤 = 失敗

### 手動でデプロイを実行する

コードを変更せずにデプロイし直したいとき（例：Secrets を変更した後）：

1. GitHub → **Actions** タブ
2. 左メニューから **Deploy GitHub Pages** を選択
3. 右上の **Run workflow** ボタン → **Run workflow**

### デプロイが失敗したとき

1. GitHub → **Actions** タブ → 失敗したワークフローをクリック
2. 赤い ❌ のステップをクリックしてログを確認
3. よくある原因：
   - **TypeScript のコンパイルエラー** → コードを修正して再 push
   - **テストの失敗** → テストを修正
   - **Secrets が設定されていない** → Settings で Secrets を追加
   - **npm install の失敗** → package.json の依存関係を確認

---

## ローカル開発との関係

```
ローカル（自分の PC）         GitHub Pages（本番）
─────────────────          ─────────────────
.env ファイル                GitHub Secrets
 ↓                          ↓
npm run dev                 npm run build
 ↓                          ↓
localhost:5173              jam0824.github.io/jibun_ikusei/
```

- **ローカル開発**では `.env` ファイルの値を使う
- **本番ビルド**では GitHub Secrets の値を使う
- どちらも `import.meta.env.VITE_XXX` で同じようにアクセスできる

### `.env` と Secrets の値が違うとき

ローカルと本番で違う API を使いたい場合は、`.env` と Secrets に別の値を設定できる。
現在は同じ CDK 環境を指しているので、値は同じ。

---

## GitHub Pages の設定

### 初期設定（既に完了済み）

1. リポジトリの **Settings** → **Pages**
2. **Source** を **GitHub Actions** に設定
3. ワークフローファイル（`.github/workflows/deploy-pages.yml`）を作成

### 公開URL

```
https://jam0824.github.io/jibun_ikusei/
```

この URL はリポジトリ名から自動的に決まる：
`https://<ユーザー名>.github.io/<リポジトリ名>/`

---

## デプロイの仕組み図

```
┌─────────────────────────────────────────────────┐
│                  GitHub                          │
│                                                  │
│  ┌──────────┐    merge     ┌──────────┐         │
│  │   dev    │ ──────────→  │   main   │         │
│  └──────────┘              └────┬─────┘         │
│                                 │ push event     │
│                                 ↓                │
│  ┌──────────────────────────────────────┐       │
│  │         GitHub Actions               │       │
│  │                                      │       │
│  │  1. checkout (コード取得)             │       │
│  │  2. npm install (パッケージ)          │       │
│  │  3. npm run build (ビルド)            │       │
│  │     └─ Secrets を環境変数に注入       │       │
│  │  4. dist/ をアップロード              │       │
│  │  5. GitHub Pages にデプロイ           │       │
│  └──────────────────────────────────────┘       │
│                     │                            │
│                     ↓                            │
│  ┌──────────────────────────────────────┐       │
│  │         GitHub Pages                  │       │
│  │  jam0824.github.io/jibun_ikusei/     │       │
│  └──────────────────────────────────────┘       │
└─────────────────────────────────────────────────┘
                      │
                      │ ユーザーがアクセス
                      ↓
              ┌──────────────┐
              │  ブラウザ     │
              │  (フロント)   │
              └──────┬───────┘
                     │ API リクエスト
                     ↓
              ┌──────────────┐
              │  AWS          │
              │  API Gateway  │
              │  → Lambda     │
              │  → DynamoDB   │
              └──────────────┘
```

---

## 注意点

### CDK デプロイとの違い

このプロジェクトには **2種類のデプロイ** がある：

| | GitHub Actions | CDK |
|---|---|---|
| **何をデプロイ** | フロントエンド（React アプリ） | バックエンド（Lambda, DynamoDB, API Gateway） |
| **デプロイ先** | GitHub Pages | AWS |
| **トリガー** | main への push（自動） | `npx cdk deploy`（手動） |
| **設定ファイル** | `.github/workflows/deploy-pages.yml` | `infra/lib/jibun-ikusei-stack.ts` |

**フロントの変更 → git push で自動デプロイ**
**バックエンドの変更 → `npx cdk deploy` を手動実行**

### よくある間違い

1. **Lambda のコードを変更したのに `git push` だけした**
   → Lambda は GitHub Actions ではデプロイされない。`npx cdk deploy` が必要。

2. **Secrets を変更したのにデプロイが走らない**
   → Secrets の変更だけではデプロイは走らない。手動実行するか、何かコミットして push する。

3. **dev ブランチに push したのにデプロイされない**
   → 正しい動作。main ブランチへの push でのみデプロイされる。dev → main の PR をマージする必要がある。

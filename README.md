# 自分育成アプリ

クエストを積み重ねて、日々の行動を「成長」として記録するローカルファーストなWebアプリです。  
TODO管理の使いやすさと、RPGの成長体験を両立することを目指しています。

## 1. アプリ概要

- コンセプト: TODO操作をベースに、クエストクリアでXPとスキルが育つ自己育成アプリ
- ローカルファースト: データは基本的にブラウザの `localStorage` に保存
- PWA対応: ホーム画面追加・オフライン再訪に対応（Service Worker）
- AI連携: OpenAI / Gemini を設定するとスキル判定やLilyコメント生成を強化可能

## 2. デモURLと主要機能

- デモURL: [https://jam0824.github.io/jibun_ikusei/](https://jam0824.github.io/jibun_ikusei/)

主要機能:

- ホーム: レベル、今日のXP、おすすめクエスト、Lilyコメント
- クエスト: 作成/編集/完了/再オープン/アーカイブ運用
- クリア演出: 完了直後に獲得XP・成長状況を可視化
- スキル: スキル一覧、7日増分表示、スキル統合
- 記録: 完了ログ確認、10分以内の取り消し、スキル候補確定
- 設定: AI、音声、通知、PWAインストール、データImport/Export

## 3. 利用開始

1. 上記デモURLをブラウザで開きます。
2. 初回起動時、サンプルクエスト3件が自動投入されます。
3. ホーム画面で以下を確認できます。
   - 現在のユーザーレベル/総XP
   - 今日のクリア件数/今日の獲得XP
   - 今日のおすすめクエスト（最大5件）
4. 画面右上の設定アイコンから、AIや音声設定に進めます。

## 4. 使い方

### クエスト追加・編集

- `クエスト` タブまたは `クエスト追加` から作成
- クエスト一覧タブは `デイリー / 繰り返し / 単発 / すべて / 完了済み / アーカイブ`
- 主な入力項目:
  - タイトル（必須）
  - XP（1〜100）
  - 種別（繰り返し/単発）
  - デイリー設定（繰り返しクエストのみ）
  - スキル設定方式（固定/AI自動/毎回確認）
  - 非AIモード、クールダウン、1日上限、期限、リマインド時刻
- 編集時のみ削除可能（完了履歴があるクエストは削除不可）

### クリア記録

1. ホームまたはクエスト一覧で `クリア`
2. 完了モーダルで時刻（今/5分前/30分前/カスタム）とメモを入力
3. `クリアする` で記録

### クリア演出

- 完了後はクリア演出画面に遷移し、以下を表示:
  - 獲得User XP
  - スキル反映状況（判定中/確定）
  - Lilyコメント（再生ボタンあり）
  - ユーザー/スキルの進捗バー

### スキル確認

- `スキル` 画面でカテゴリ別の成長状況を確認
- 似たスキルは統合可能（履歴・辞書の参照先も追従）

### 記録取り消し

- `記録` 画面で完了ログを確認
- 完了から10分以内は `取り消し` が可能
- スキル判定が候補状態の場合、ここで候補を選んで確定可能

## 5. AI・音声設定

`設定` 画面で以下を管理します。

- AI利用ON/OFF
- アクティブプロバイダ（OpenAI / Gemini / 使用しない）
- APIキー入力、接続テスト、キー消去
- Lily音声ON/OFF、自動再生設定、Gemini Speaker選択

AIが実際に使われる条件:

- `AI利用` が ON
- `activeProvider` が `none` ではない
- 選択中プロバイダのAPIキーが設定済み

非AIモードについて:

- クエスト単位で `非AIモード` を有効化可能
- 固定スキルとテンプレート文中心の動作になり、外部AI依存を避けられます

オフライン時の制限:

- 利用可能: クエスト管理、スキル一覧、記録、設定、JSON Import/Export
- オンライン必須: AI接続テスト、Lilyメッセージ生成、音声再生

## 6. データ管理

`設定 > Data` で管理します。

- `JSON Export`: 現在データをJSONで保存
- `JSON Import`: JSONを読み込み
  - `merge`: 既存データに統合
  - `replace`: 既存データを置換
- `ローカルデータ削除`: 端末内データを全削除して初期化

主な保存先キー（`localStorage`）:

- `app.user`
- `app.settings`
- `app.quests`
- `app.completions`
- `app.skills`
- `app.assistantMessages`
- `app.personalSkillDictionary`
- `app.aiConfig`
- `app.meta`

## 7. 開発者向けセットアップ

推奨:

- Node.js 22以上
- npm 11以上

セットアップ:

```bash
npm ci
```

開発サーバー:

```bash
npm run dev
```

主要コマンド:

```bash
npm run test      # Vitest
npm run build     # TypeScript build + Vite build
npm run lint      # ESLint
npm run preview   # 本番ビルドのローカル確認
```

## 8. デプロイ

- GitHub Actions で `main` ブランチ push 時に GitHub Pages へ自動デプロイ
- workflow: `.github/workflows/*`（Pages build/deploy）
- Vite `base` は `'/jibun_ikusei/'` に設定済み
- 出力先は `dist/`、Pages artifact としてアップロード

## 9. 制約と注意事項

- 永続化は `localStorage` 前提のため、ブラウザデータ削除で消失します
- APIキーは端末内ストレージに保存されます（個人利用MVP想定）
- マルチデバイス同期・マルチユーザー対応は未対応です
- サーバーサイドDB/認証は導入していません

## 10. 技術スタックとディレクトリ要約

技術スタック:

- React 19 + TypeScript
- Vite 8
- Zustand（状態管理）
- React Router
- Vitest + Testing Library
- vite-plugin-pwa

主要ディレクトリ:

- `src/screens`: 画面コンポーネント（Home/Quest/Skills/Records/Settings/Clear）
- `src/store`: アプリ状態とユースケース実装（Zustand）
- `src/domain`: 型定義、定数、業務ロジック
- `src/lib`: AI通信、日付、ストレージ、PWA、ネットワーク補助

---

実装に合わせた主要仕様値:

- ユーザーレベル: 100XPごとにレベルアップ
- スキルレベル: 50XPごとにレベルアップ
- スキルXP加算上限: 1完了あたり20XP

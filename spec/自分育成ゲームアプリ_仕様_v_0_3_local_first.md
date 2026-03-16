# 自分育成ゲームアプリ 仕様 v0.3（ローカル完結版）

## 0. 今回の変更方針

この版では、MVPを **単独利用・ローカル完結** 前提に組み直す。

前提は以下の通り。

- 使用者は自分のみ
- AI API 呼び出し以外は端末内で完結
- サーバー、認証、DB、ジョブキューは一旦持たない
- データ保存先は当面 `localStorage`
- AI の API Key は設定画面から入力し、`localStorage` に保存する

> 注意: `localStorage` への API Key 保存は **個人用MVPとしては許容** だが、一般公開向けの本番構成には不適切。将来的に他者利用やマルチデバイス同期を行う場合は、必ずサーバー保管方式へ移行する。

---

## 1. プロダクト概要

### 1-1. コンセプト
- 操作感は TODO 管理アプリ
- 意味づけは RPG 育成ゲーム
- ユーザーは自分でクエストを登録し、実行したら自己申告でクリアする
- クリアに応じて「ユーザーLv」と「スキルLv」が上がる
- リリィが結果を言語化し、成長感を与える

### 1-2. MVPの目的
- 毎日の行動を「完了」ではなく「成長」として感じられること
- 1日1〜5回の軽い利用が自然に続くこと
- 行動ログがそのまま「自分が育っている証拠」になること

### 1-3. 非目的
- 厳密な不正防止
- SNS的な競争
- 自動行動監視
- AIが何でも勝手に決める全自動運用
- マルチユーザー対応
- クラウド同期

---

## 2. 設計原則

### 2-1. 体験原則
- 入力は最小
- 完了時の気持ちよさは最大
- 管理より「成長の可視化」を優先
- 日々の操作は軽く、振り返りは深く

### 2-2. UI原則
- 基本骨格は TODO アプリ
- ホームと完了演出だけは RPG 的にする
- 日常操作に不要なゲーム演出は増やしすぎない
- 目安として `70% 実用UI / 30% ゲーム演出`

### 2-3. 実装原則（今回追加）
- まずはローカルで閉じる
- 外部依存は AI 呼び出し時だけに限定する
- 失敗しても日々の記録機能は止めない
- オフラインでも主要操作は成立する

---

## 3. 対象ユーザー

### 3-1. メインターゲット
- タスク管理はしたいが、管理感が強いアプリは続かない人
- ゲーム的な成長表現が好きな人
- 学習、健康、仕事、生活習慣を横断的に育てたい人

### 3-2. MVPの前提
- 単独利用
- スマホ中心
- 1回あたりの操作時間は 5〜30 秒が中心
- 同一端末での利用を基本とする

---

## 4. プラットフォーム構成

### 4-1. 配置
- クライアント: Web アプリ
- 配布形態: スマホアプリの殻 + WebView
- アプリデータ保存: `localStorage`
- AI 呼び出し: クライアントから各AI APIへ直接リクエスト
- サーバー: なし（MVP段階では不使用）

### 4-2. 責務分離
- クライアント
  - 画面表示
  - 状態管理
  - データ保存
  - XP計算
  - スキル解決結果の反映
  - ログ集計
  - AI API 呼び出し
  - 音声再生
- AI
  - スキル抽象化
  - リリィの発話文生成
  - 週次ふりかえり
  - 必要に応じてTTS

### 4-3. ローカル完結の意味
以下は端末内だけで完結する。

- クエスト作成・編集
- クエスト一覧表示
- クエストクリア
- XP加算
- レベル計算
- スキル一覧
- 活動ログ
- 設定保存
- データエクスポート / インポート

以下のみ外部通信を許可する。

- AIによるスキル抽象化
- AIによるリリィ発話生成
- AIによる週次ふりかえり
- AI/TTS の音声生成（有効時のみ）

### 4-4. ストレージ方針
MVPでは保存容量と実装速度を優先し、永続化は `localStorage` を使用する。

将来の移行候補:
- データ量増加時: `IndexedDB`
- 複数端末同期時: バックエンド + DB

### 4-5. セキュリティ方針（ローカル版）
- AI API Key は設定画面から入力する
- API Key は `localStorage` に保存する
- API Key は通常表示ではマスクする
- AI機能実行時のみクライアントから外部APIへ送信する
- `非AIモード` のクエスト文面は外部送信しない

### 4-6. この構成の制約
- ブラウザデータ削除で保存内容が消える
- 端末をまたいだ同期はできない
- API Key は端末内に平文保存となる
- 他者利用向けの安全性は不足している

---

## 5. 主要用語

### Quest
ユーザーが自分で登録する行動単位。
例: `読書する`, `腕立て伏せ`, `企画資料を作る`

### Completion
クエストをクリアした1回の記録。

### User Level
全クエストの累積経験値で上がる総合レベル。

### Skill
抽象化された成長項目。
例: `読書`, `運動`, `資料作成`, `発信`

### Skill Level
特定スキルの累積経験値で上がる分野別レベル。

### Lily
アプリ内ナビゲーター。短いコメント、振り返り、音声読み上げを担当。

---

## 6. 情報設計と画面構成

### 6-1. グローバルナビゲーション
下タブは以下の5つ。

1. ホーム
2. クエスト
3. 追加
4. スキル
5. 記録

設定はホーム右上またはプロフィール導線から入る。

---

## 7. 画面仕様

## 7-1. ホーム

### 目的
- 今の成長状態を一目で把握させる
- 今日やることへ最短で入れる
- リリィの存在を感じさせる

### 表示要素
上から順に:

1. レベルカード
   - 現在Lv
   - 現在総XP
   - 次レベルまでの残XP
   - XPバー

2. 今日の成長サマリー
   - 今日のクリア数
   - 今日の獲得XP
   - 今日よく伸びたスキル上位3件

3. リリィカード
   - 今日のひとこと
   - 再生ボタン
   - 直近イベントに応じた短文
   - AI未設定時はテンプレート文にフォールバック

4. 今日のクエスト
   - 優先順で最大5件
   - `クリア` ボタン付き

5. クイックアクション
   - クエスト追加
   - 今日の記録を見る
   - スキルを見る

### 空状態
- 初回利用時は「最初のクエストを作る」導線を中央表示
- 例として3件のサンプルクエストを提案表示

---

## 7-2. クエスト一覧

### 目的
- TODOアプリ的に一覧で管理する主画面

### タブ
- すべて
- 今日
- 定常
- 単発
- 完了済み

### クエストカード項目
- タイトル
- XPバッジ
- スキル表示
  - 固定スキル名
  - AI自動
  - 未設定
- 種別バッジ
  - 定常 / 単発
- 状態表示
  - クリア可能
  - クールダウン中
  - 本日上限到達
  - 期限切れ
  - クリア済み
- 右端アクション
  - `クリア`
  - または `詳細`

### スワイプ操作
- 右スワイプ: クリア
- 左スワイプ: 編集 / アーカイブ

---

## 7-3. クエスト作成・編集

### 入力項目
- タイトル（必須、60文字以内）
- 説明（任意、240文字以内）
- XP（必須）
- 種別（必須）
  - 定常
  - 単発
- スキル付与方法（必須）
  - 固定
  - AI自動
  - 毎回確認
- カテゴリ（任意）
  - 学習 / 健康 / 仕事 / 生活 / 対人 / 創作 / その他
- プライバシー設定
  - 通常
  - 非AIモード
- リマインド（任意）

### スキル付与方法の意味
- 固定  
  ユーザーが明示的に `読書` や `運動` を選ぶ
- AI自動  
  初回または必要時に AI が抽象化し、以後は同じクエストに再利用
- 毎回確認  
  クリアのたびに候補を確認する

### 非AIモード
- クエスト文面は外部AIに送らない
- 固定スキルのみ利用可
- リリィはテンプレート発話のみ

### 編集時の補助操作
- 編集画面でのみ `削除` を表示し、新規作成時は表示しない
- 削除前に確認ダイアログを表示する
- 誤って追加した不要クエストを完全削除する目的で使う
- 削除可能条件は active な completion が 0 件
- 削除時は quest 本体と、同クエストに紐づく undone 済み completion / 関連 assistant message を削除する
- active な completion が 1 件以上ある場合は削除不可
- 削除不可時は `履歴があるため削除できません。不要化したクエストはアーカイブしてください。` を表示する
- 初期サンプルクエストも未クリアなら同じ条件で削除できる

---

## 7-4. クエストクリアモーダル

### 項目
- クエスト名
- XP獲得予定
- メモ欄（任意、120文字以内）
- 実行日時
  - 今
  - 5分前
  - 30分前
  - カスタム

### 確定後の見せ方
1. `+XP` アニメーション
2. User Lv バー更新
3. Skill Lv 反映
4. リリィの短文表示
5. AI/TTS が有効なら音声再生ボタン表示

### クリア後の分岐
- 固定スキル: 即時完了
- AI高信頼: 即時反映
- AI中信頼: 候補3件を選ばせる
- AI低信頼: `未分類` として保留
- API Key 未設定: AI系処理はスキップし、テンプレート文で完了

---

## 7-5. スキル画面

### 目的
- 自分がどの分野で育っているかを見せる

### 一覧表示項目
- スキル名
- カテゴリ
- 現在Lv
- 現在XP
- 次LvまでのXPバー
- 直近7日での増加量

### 詳細画面
- そのスキルに紐づくクエスト
- 最近の成長ログ
- 関連スキル候補
- 統合アクション

---

## 7-6. 記録画面

### 目的
- 完了履歴を「活動ログ」として見せる

### 1行の表示内容
- 時刻
- クエスト名
- `+User XP`
- `+Skill XP`
- 紐づいたスキル名
- リリィコメントの有無

### 取り消し
- クリア後10分以内のみ `取り消し` 可能

---

## 7-7. 設定画面

### 項目
- リリィ音声
  - ON
  - タップ時のみ
  - OFF
- 自動再生
- 音声キャラクター設定
- 通知時刻
- 非AIモードのデフォルト
- AI設定
  - AI利用 ON/OFF
  - 利用プロバイダ
  - API Key 入力
  - 接続テスト
  - API Key 削除
- データ管理
  - JSONエクスポート
  - JSONインポート
  - 全ローカルデータ削除

### API Key入力UI仕様
- 入力欄は password 表示を基本にする
- `表示` トグルで一時的に確認可能
- `保存` で `localStorage` に保存
- `接続テスト` で最小限の疎通確認を行う
- 無効なキーなら保存自体は可能だが、状態を `未確認 / 有効 / 無効` で表示する

### localStorage保存キー例
```txt
app.settings
app.quests
app.completions
app.skills
app.assistantMessages
app.personalSkillDictionary
app.aiConfig
```

### AI設定の保存例
```json
{
  "provider": "openai",
  "apiKey": "<user_input_key>",
  "status": "verified",
  "updatedAt": "2026-03-16T10:00:00+09:00"
}
```

---

## 8. クエスト仕様

## 8-1. 種別

### 定常クエスト
例:
- 読書する
- 散歩する
- 日記を書く

ルール:
- 複数回クリア可能
- クールダウンあり
- 1日上限あり
- 通常は `active` のまま

### 単発クエスト
例:
- 提案資料を作る
- 通院予約をする
- 税金の手続きをする

ルール:
- 1回クリアしたら `completed`
- 再オープン操作で再利用可能
- 削除ではなくアーカイブ推奨

---

## 8-2. 状態遷移

### 定常
`active -> cooling_down -> active`

または

`active -> daily_cap_reached -> active(翌日)`

### 単発
`active -> completed`

共通:
`active/completed -> archived`

---

## 8-3. クリア制御

### クールダウン
- 最小 0分
- 最大 1440分
- デフォルト 30分

### 1日上限
- 最小 1回
- 最大 10回
- デフォルト 1回

### 重複送信防止
MVPではAPIは存在しないため、クライアント側で二重反映を防ぐ。

方式:
- クリアボタン押下中は一時的に disabled
- `clientRequestId` をローカル生成して completion に記録
- 直近数秒以内の同一クエスト連打は同一操作として扱う

---

## 9. レベル・経験値仕様

## 9-1. ユーザーXP
- クエストの報酬XPをそのまま加算
- クリア時点で即時反映

### 次レベル必要XP
ユーザーLvは、**レベル帯に関係なく毎回100XP固定**でレベルアップする。

```txt
nextUserLevelXp = 100
```

### 例
- Lv1 → 2: 100
- Lv2 → 3: 100
- Lv3 → 4: 100
- Lv4 → 5: 100

### 採用理由
- レベルが上がっても成長テンポが落ちない
- 必要XPが覚えやすく、見通しがよい
- 「次のレベルが遠すぎる」と感じにくく、継続しやすい

---

## 9-2. スキルXP
- 基本は `questXp` をそのまま採用
- ただし極端な偏りを防ぐため、1回のスキル加算上限は 20XP

### スキルXP計算
```txt
skillXpAwarded = min(questXp, 20)
```

---

## 9-3. スキルレベル
スキルLvも、レベル帯に関係なく**毎回固定XP**でレベルアップする。

```txt
nextSkillLevelXp = 50
```

### 例
- Skill Lv1 → 2: 50
- Skill Lv2 → 3: 50
- Skill Lv3 → 4: 50
- Skill Lv4 → 5: 50

### 採用理由
- スキル成長のテンポを一定に保てる
- 分野ごとの伸びを実感しやすい
- ユーザーLvよりも少し短い周期で上がり、行動の手応えが出やすい

---

## 10. スキル仕様

## 10-1. カテゴリ
- 学習
- 健康
- 仕事
- 生活
- 対人
- 創作
- その他

## 10-2. 初期シードスキル
- 学習: 読書 / 調査 / 英語 / 記述
- 健康: 運動 / 睡眠 / 食事管理
- 仕事: 資料作成 / 企画 / 実装 / タスク管理
- 生活: 家事 / 整理整頓 / 金銭管理
- 対人: 発信 / 会話 / 傾聴
- 創作: 執筆 / デザイン / 音楽

## 10-3. 命名原則
- 具体クエスト名ではなく抽象スキル名にする
- 1ユーザー内で重複しにくい正規化を行う

## 10-4. クエストとスキルの対応
- 1回の completion は主スキルを1つ持つ
- MVPでは複数スキル同時付与は行わない

---

## 11. スキル抽象化仕様

## 11-1. 基本方針
AIは毎回自由に新規スキルを作らない。
以下の優先順で解決する。

1. 既存スキルに割り当てる
2. シードスキルに割り当てる
3. 新規スキルを提案する
4. ユーザーが修正したら辞書に保存する
5. 次回以降は辞書を最優先する

## 11-2. 入力
- quest.title
- quest.description
- completion.note
- quest.category
- existingSkills[]
- seedSkills[]
- personalSkillDictionary[]

## 11-3. 出力JSON
```json
{
  "action": "assign_existing",
  "skillName": "運動",
  "category": "健康",
  "confidence": 0.94,
  "reason": "腕立て伏せは身体活動であり、既存の運動スキルに一致するため",
  "candidateSkills": ["運動", "体力づくり", "習慣化"]
}
```

## 11-4. 信頼度ルール
- `0.80以上`  
  自動適用
- `0.55以上 0.80未満`  
  候補3件を出してユーザー確認
- `0.55未満`  
  `未分類` にして保留

## 11-5. API Key 未設定時の動作
- AI自動 / 毎回確認を選んでいても外部送信は行わない
- `未分類` または簡易ルールベース候補で代替する
- ユーザーに「AI設定で有効化可能」とだけ表示する

---

## 12. リリィ仕様

## 12-1. キャラクター設定
- 名前: リリィ
- 役割: ナビゲーター
- トーン: 明るい、親しみやすい、少しゲーム風
- 禁止:
  - 説教
  - 人格否定
  - 過度な圧
  - 罪悪感の利用

## 12-2. 発話トリガー
- クエストクリア
- ユーザーLvアップ
- スキルLvアップ
- 今日まだ1件も未達のときの軽い促し
- 日次サマリー
- 週次ふりかえり

## 12-3. フォールバック
AIが使えない場合はテンプレート文を使う。

例:
- `ナイスです。経験値が5増えました。`
- `読書スキルが伸びています。いい流れです。`
- `今日も1件クリアです。少しずつ前進しています。`

---

## 13. AI利用仕様

## 13-1. AI の役割
- スキル抽象化
- リリィ発話テキスト生成
- 週次ふりかえり
- スキル統合候補提案

## 13-2. 呼び出し方式
- クライアントから AI API に直接リクエストする
- API Key は設定画面で保存した値を使う
- AIレスポンスは必ず JSON として解釈する
- 失敗時はローカルフォールバックで処理継続する

## 13-3. Structured Outputの原則
自由文をそのままUIに流さず、必ず JSON で受ける。

### リリィ発話出力
```json
{
  "intent": "quest_completed",
  "mood": "playful",
  "text": "ナイスです。読書クエストをクリア。経験値が5増えました。",
  "shouldSpeak": true
}
```

## 13-4. 送信制御
- `privacyMode = no_ai` のクエストは送信しない
- API Key 未設定時は送信しない
- ユーザーが AI利用OFF の場合は送信しない

---

## 14. TTS仕様

## 14-1. 入力
- 発話テキスト
- キャラクタープロファイル
- ムード
- 話速
- 音声名

## 14-2. 生成方針
- 通常発話は 1〜5秒程度
- 週次ふりかえりは 10〜20秒程度
- 同一テキストはローカルでキャッシュ管理してもよい

## 14-3. 失敗時
- 音声生成に失敗してもテキスト表示で続行する
- 音声は補助機能であり、主要導線をブロックしない

---

## 15. ローカルアプリ処理仕様

## 15-1. 認証
- なし
- 単独利用のため userId は固定ローカルユーザーとして扱う

## 15-2. 主要ローカル処理

### loadDashboard()
ホーム表示に必要な情報をローカルデータから集計する。

### listQuests(filter)
クエスト一覧をローカルデータから返す。

### createQuest(input)
クエストを作成し、`localStorage` に保存する。

### updateQuest(questId, patch)
クエストを更新し、`localStorage` に保存する。

### deleteQuest(questId)
誤って追加した不要クエストを完全削除する。

返り値:
- 成功: `{ ok: true }`
- 失敗: `{ ok: false, reason }`

処理内容:
1. active な completion があるか確認
2. 0件なら quest 本体を削除
3. undone 済み completion と関連 assistant message を削除
4. `localStorage` を更新
5. active な completion がある場合は失敗理由を返す

### completeQuest(questId, payload)
クエストクリアを実行する。

処理内容:
1. クリア可否判定
2. completion作成
3. User XP加算
4. Skill XP反映
5. ローカル保存
6. AIが使える場合のみ補助処理を非同期実行

### undoCompletion(completionId)
10分以内なら逆仕訳して取り消す。

### exportData()
全ローカルデータをJSONで出力する。

### importData(file)
JSONを読み込み、ローカルデータを置換または統合する。

---

## 16. データモデル

```ts
type QuestType = "repeatable" | "one_time"
type SkillMappingMode = "fixed" | "ai_auto" | "ask_each_time"
type PrivacyMode = "normal" | "no_ai"
type QuestStatus = "active" | "completed" | "archived"
type SkillResolutionStatus = "not_needed" | "pending" | "resolved" | "needs_confirmation" | "unclassified"

interface LocalUser {
  id: "local_user"
  level: number
  totalXp: number
  createdAt: string
  updatedAt: string
}

interface AiConfig {
  provider: "openai" | "gemini" | "none"
  apiKey?: string
  status?: "unverified" | "verified" | "invalid"
  updatedAt: string
}

interface UserSettings {
  lilyVoiceEnabled: boolean
  lilyAutoPlay: "on" | "tap_only" | "off"
  defaultPrivacyMode: PrivacyMode
  reminderTime?: string
  aiEnabled: boolean
  createdAt: string
  updatedAt: string
}

interface Quest {
  id: string
  title: string
  description?: string
  questType: QuestType
  xpReward: number
  category?: string
  skillMappingMode: SkillMappingMode
  fixedSkillId?: string
  defaultSkillId?: string
  cooldownMinutes?: number
  dailyCompletionCap?: number
  dueAt?: string
  status: QuestStatus
  privacyMode: PrivacyMode
  pinned: boolean
  createdAt: string
  updatedAt: string
}

interface QuestCompletion {
  id: string
  questId: string
  clientRequestId: string
  completedAt: string
  note?: string
  userXpAwarded: number
  skillXpAwarded?: number
  resolvedSkillId?: string
  skillResolutionStatus: SkillResolutionStatus
  undoneAt?: string
  createdAt: string
}

interface Skill {
  id: string
  name: string
  normalizedName: string
  category: string
  level: number
  totalXp: number
  source: "manual" | "ai" | "seed"
  createdAt: string
  updatedAt: string
}

interface PersonalSkillDictionary {
  id: string
  phrase: string
  mappedSkillId: string
  createdBy: "user_override" | "system"
  createdAt: string
}

interface AssistantMessage {
  id: string
  triggerType: "quest_completed" | "user_level_up" | "skill_level_up" | "daily_summary" | "weekly_reflection" | "nudge"
  mood: "bright" | "calm" | "playful" | "epic"
  text: string
  audioUrl?: string
  createdAt: string
}

interface LocalAppState {
  user: LocalUser
  settings: UserSettings
  aiConfig: AiConfig
  quests: Quest[]
  completions: QuestCompletion[]
  skills: Skill[]
  personalSkillDictionary: PersonalSkillDictionary[]
  assistantMessages: AssistantMessage[]
}
```

---

## 17. クライアント内非同期処理仕様

MVPではサーバージョブは持たず、クライアント内の非同期処理として扱う。

### 17-1. resolveSkillTask
発火条件:
- `skillMappingMode = ai_auto` または `ask_each_time`
- かつ AI利用可能

処理:
1. 入力を整形
2. AIへ分類依頼
3. confidence 判定
4. 既存スキルへ付与 or 候補提示
5. `defaultSkillId` 更新
6. ローカル保存

### 17-2. generateAssistantMessageTask
発火条件:
- completion 作成
- level up
- daily summary 時刻到達
- weekly reflection 時刻到達

### 17-3. generateTtsTask
発火条件:
- `shouldSpeak = true`
- ユーザー設定で音声ON
- API Key / TTS利用条件を満たす

---

## 18. 業務ルール・例外処理

### 18-1. クールダウン中
- クリアは失敗扱い
- 画面には `次回可能時刻` を表示

### 18-2. 単発クエスト再クリア
- `completed` 状態なら失敗
- UI上は `再オープン` を出す

### 18-3. AI低信頼
- スキルは未付与
- completion は保存
- ログには `スキル未分類` と表示

### 18-4. スキル統合
- sourceSkill のXP履歴を targetSkill に付け替える
- alias を残し、今後のAI判定で target に寄せる

### 18-5. 取り消し
- userXp と skillXp を逆仕訳する
- assistant message は削除しない
- ログ上で `取り消し済み` 表示

### 18-6. クエスト削除
- active な completion が 1 件以上あるクエストは削除できない
- 失敗時は `履歴があるため削除できません。不要化したクエストはアーカイブしてください。` を返す
- 取り消し済み completion のみ残る場合は削除可能
- 削除時は対象の undone 済み completion と関連 assistant message も削除する
- 初期サンプルクエストも未クリアなら削除可能

### 18-7. API Keyが無効
- AI機能呼び出しは失敗してもクエストクリア自体は成立する
- 設定画面に再設定導線を出す
- リリィはテンプレート文にフォールバック

---

## 19. 通知仕様

### 日次通知
- その日まだ1件もクリアがない場合のみ送る
- 時刻はユーザー設定
- 実装初期は端末通知なしでも可
- MVP第一段階ではアプリ内導線だけでも成立

### 単発期限通知
- 期限前日
- 期限当日朝

---

## 20. 非機能要件

### パフォーマンス
- ダッシュボード初回表示: 1秒以内目標
- クエストクリア反映: 200ms以内目標
- AI反映は非同期許容

### 可用性
- AI失敗時でもクエストクリアは成立する
- TTS失敗時でもテキスト表示で続行する
- オフライン時でもAI以外は使える

### データ保全
- 重要操作ごとに `localStorage` を更新する
- 設定画面から JSON エクスポートを可能にする
- 将来的に IndexedDB 移行可能な構造を意識する

---

## 21. MVPに含めるもの

- クエスト登録
- 定常 / 単発
- 自己申告クリア
- User Lv / Skill Lv
- 固定スキル / AI自動スキル
- リリィ短文
- 音声再生
- 活動ログ
- スキル統合
- 10分以内取り消し
- AI設定画面
- localStorage 永続化
- JSONエクスポート / インポート

---

## 22. MVPで含めないもの

- 他ユーザーとの共有
- ランキング
- ギルド、フレンド
- 自動センサー連携
- AIとの自由会話
- 複数スキル同時付与
- デスクトップ最適化
- クラウドバックアップ
- ユーザー認証

---

## 23. 受け入れ条件

### 最低限の完成条件
- ユーザーが `読書する: XP5` を作れる
- 一覧から `クリア` を押すと User XP が増える
- `読書` スキルに XP が入る
- 一定XPで User Lv が上がる
- スキルXPで `読書Lv` が上がる
- ホームで進捗が見える
- リリィが結果を話す
- 同じ定常クエストをクールダウン中に連打できない
- 単発クエストは1回で完了済みになる
- アプリを再起動してもデータが残る
- AI API Key を設定画面から保存できる
- API Key 未設定でも主要機能が使える

---

## 24. この仕様の核

このアプリの核は次の5点です。

1. **クエストの操作感は TODO**
2. **成長の見せ方は RPG**
3. **スキル名は AI で抽象化できる**
4. **リリィが成長を言葉と音で意味づけする**
5. **AI以外はローカルで閉じ、軽く速く使える**

TODOアプリの使いやすさを捨てずに、
「完了した」ではなく **「育った」** と感じる設計にすることが、この仕様の中心です。

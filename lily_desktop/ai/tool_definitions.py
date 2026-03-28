"""Tool Search ツール定義 (src/lib/chat-tools.ts CHAT_TOOLS の移植)"""

CHAT_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "get_browsing_times",
            "description": "ユーザーのWeb閲覧時間データを取得する。カテゴリ別・サイト別の内訳を確認できる。",
            "parameters": {
                "type": "object",
                "properties": {
                    "period": {
                        "type": "string",
                        "enum": ["today", "week", "month"],
                        "description": "取得する期間。today=今日、week=直近7日、month=直近30日",
                    },
                },
                "required": ["period"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_user_info",
            "description": "ユーザーのプロフィール・設定・メタ情報を取得する。レベル、XP、設定状況などを確認したいときに使う。",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["profile", "settings", "meta"],
                        "description": "profile=レベル・XP等、settings=アプリ設定、meta=スキーマ・サマリー日時等",
                    },
                },
                "required": ["type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_quest_data",
            "description": "クエスト一覧やクエスト完了記録を取得する。「今日何をやった？」「アクティブなクエストは？」などに対応。",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["quests", "completions"],
                        "description": "quests=クエスト一覧、completions=クエスト完了記録",
                    },
                    "status": {
                        "type": "string",
                        "enum": ["active", "completed", "archived"],
                        "description": "クエストのステータスフィルタ（type=questsの場合）",
                    },
                    "questType": {
                        "type": "string",
                        "enum": ["repeatable", "one_time"],
                        "description": "クエスト種別フィルタ（type=questsの場合）",
                    },
                    "category": {
                        "type": "string",
                        "description": "カテゴリフィルタ（type=questsの場合）",
                    },
                    "period": {
                        "type": "string",
                        "enum": ["today", "week", "month"],
                        "description": "期間フィルタ（type=completionsの場合。未指定=直近7日）",
                    },
                    "questId": {
                        "type": "string",
                        "description": "特定クエストの完了記録のみ取得（type=completionsの場合）",
                    },
                },
                "required": ["type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_skill_data",
            "description": "スキル一覧や個人スキル辞書を取得する。スキルのレベル・XP・カテゴリを確認したいときに使う。",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["skills", "dictionary"],
                        "description": "skills=スキル一覧、dictionary=個人スキル辞書",
                    },
                    "status": {
                        "type": "string",
                        "enum": ["active", "merged"],
                        "description": "スキルのステータスフィルタ（type=skillsの場合）",
                    },
                    "category": {
                        "type": "string",
                        "description": "カテゴリフィルタ（type=skillsの場合）",
                    },
                },
                "required": ["type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_messages_and_logs",
            "description": "アシスタントメッセージ、AI設定、アクティビティログ、チャット履歴を取得する。過去の発言やログを確認したいときに使う。",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": [
                            "assistant_messages",
                            "ai_config",
                            "activity_logs",
                            "chat_sessions",
                            "chat_messages",
                        ],
                        "description": "assistant_messages=リリィの過去メッセージ、ai_config=AI設定、activity_logs=操作ログ、chat_sessions=チャットセッション一覧、chat_messages=特定セッションのメッセージ",
                    },
                    "triggerType": {
                        "type": "string",
                        "enum": [
                            "quest_completed",
                            "user_level_up",
                            "skill_level_up",
                            "daily_summary",
                            "weekly_reflection",
                            "nudge",
                        ],
                        "description": "メッセージのトリガー種別フィルタ（type=assistant_messagesの場合）",
                    },
                    "period": {
                        "type": "string",
                        "enum": ["today", "week", "month"],
                        "description": "期間フィルタ（type=assistant_messages/activity_logsの場合。未指定=直近7日）",
                    },
                    "sessionId": {
                        "type": "string",
                        "description": "チャットセッションID（type=chat_messagesの場合、必須）",
                    },
                },
                "required": ["type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_quest",
            "description": "ユーザーの代わりにクエストを新規作成する。「〇〇するクエスト作って」「新しいクエストを追加して」などに対応。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "クエストのタイトル",
                    },
                    "description": {
                        "type": "string",
                        "description": "クエストの説明（任意）",
                    },
                    "questType": {
                        "type": "string",
                        "enum": ["repeatable", "one_time"],
                        "description": "クエスト種別。repeatable=繰り返し（デフォルト）、one_time=一回限り",
                    },
                    "xpReward": {
                        "type": "number",
                        "description": "獲得XP（デフォルト: 10）",
                    },
                    "category": {
                        "type": "string",
                        "enum": ["学習", "運動", "仕事", "生活", "対人", "創作", "その他"],
                        "description": "カテゴリ（任意）",
                    },
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_quest",
            "description": "クエストを削除またはアーカイブする。「〇〇のクエスト消して」「クエストをアーカイブして」などに対応。完了履歴があるクエストはアーカイブのみ可能。",
            "parameters": {
                "type": "object",
                "properties": {
                    "questId": {
                        "type": "string",
                        "description": "クエストID（get_quest_dataで取得可能）",
                    },
                    "title": {
                        "type": "string",
                        "description": "クエストのタイトル（部分一致で検索。questIdが不明な場合に使用）",
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["delete", "archive"],
                        "description": "delete=完全削除（デフォルト）、archive=アーカイブ（非表示にするが履歴は保持）",
                    },
                },
            },
        },
    },
]

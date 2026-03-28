from PySide6.QtCore import QObject, Signal


class EventBus(QObject):
    # ユーザー入力
    user_message_received = Signal(str)

    # AI応答: (話者名, テキスト, ポーズヒント)
    ai_response_ready = Signal(str, str, str)

    # 吹き出し: (話者名, テキスト)
    balloon_show = Signal(str, str)
    balloon_hide = Signal()

    # ポーズ変更: (キャラ名, 画像パス)
    pose_change = Signal(str, str)

    # セッション操作
    new_chat_requested = Signal()


# アプリ全体で共有するシングルトン
bus = EventBus()

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

    # 音声入力
    voice_toggle_requested = Signal()       # ON/OFFトグル要求
    voice_state_changed = Signal(bool)      # マイク状態変更通知 (is_running)
    voice_device_selected = Signal(int, str)  # マイク選択 (device_index, device_name)

    # カメラ
    camera_device_selected = Signal(int, str)  # カメラ選択 (device_index, device_name)

    # 音声合成
    tts_playback_started = Signal()    # TTS再生開始（マイク一時停止用）
    tts_playback_finished = Signal()   # TTS再生終了（マイク再開用）
    tts_toggle_requested = Signal()    # 読み上げON/OFFトグル要求

    # デバッグ
    desktop_context_requested = Signal()  # 手動で状況取得を要求
    auto_talk_requested = Signal()        # 手動で雑談を発火
    camera_capture_requested = Signal()   # 手動でカメラ状況取得を要求


# アプリ全体で共有するシングルトン
bus = EventBus()

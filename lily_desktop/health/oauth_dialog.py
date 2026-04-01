"""Health Planet 初回 OAuth 認証ダイアログ"""

from __future__ import annotations

import re
import webbrowser

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QDialog,
    QLabel,
    QLineEdit,
    QPushButton,
    QVBoxLayout,
)


class HealthPlanetOAuthDialog(QDialog):
    """
    非モーダルの初回認証ダイアログ。
    ユーザーがブラウザで認証後、リダイレクト URL（または code の値）を
    貼り付けて「認証する」ボタンを押すと code_submitted シグナルを emit する。
    """

    code_submitted = Signal(str)

    def __init__(self, auth_url: str, parent=None) -> None:
        super().__init__(parent)
        self._auth_url = auth_url
        self.setWindowTitle("Health Planet 認証")
        self.setWindowModality(Qt.NonModal)
        self.setMinimumWidth(480)
        self._build_ui()
        webbrowser.open(auth_url)

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)

        layout.addWidget(QLabel(
            "Health Planet（タニタ体重計）の認証が必要です。\n"
            "「ブラウザで開く」を押してログイン・許可してください。\n"
            "認証後にリダイレクトされた URL（または code= の値）を貼り付けてください。"
        ))

        btn_open = QPushButton("ブラウザで開く")
        btn_open.clicked.connect(self._open_browser)
        layout.addWidget(btn_open)

        layout.addWidget(QLabel("リダイレクト後の URL または code の値:"))
        self._input = QLineEdit()
        self._input.setPlaceholderText("https://jam0824.github.io/?code=XXXX  または  XXXX")
        layout.addWidget(self._input)

        btn_submit = QPushButton("認証する")
        btn_submit.clicked.connect(self._on_submit)
        layout.addWidget(btn_submit)

    def _open_browser(self) -> None:
        webbrowser.open(self._auth_url)

    def _on_submit(self) -> None:
        text = self._input.text().strip()
        if not text:
            return
        code = _extract_code(text)
        if code:
            self.code_submitted.emit(code)
            self.accept()


def _extract_code(text: str) -> str:
    """URL または生の code 値から code パラメータを取り出す"""
    # URL に ?code= や &code= が含まれている場合
    match = re.search(r"[?&]code=([^&\s]+)", text)
    if match:
        return match.group(1)
    # そのまま code 値として扱う
    return text.strip()

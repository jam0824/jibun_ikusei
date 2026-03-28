from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import socket
import sys
import threading
from pathlib import Path

try:
    from PySide6.QtCore import QTimer, Qt, QUrl
    from PySide6.QtGui import QColor
    from PySide6.QtWidgets import QApplication, QVBoxLayout, QWidget
    from PySide6.QtWebEngineCore import QWebEnginePage
    from PySide6.QtWebEngineWidgets import QWebEngineView
except ImportError as exc:
    print(
        "PySide6 with WebEngine is required. Try running this with "
        r"lily_desktop\.venv\Scripts\python.exe experiment\flame_desktop.py",
        file=sys.stderr,
    )
    raise SystemExit(1) from exc


SCRIPT_DIR = Path(__file__).resolve().parent
MODEL_PATH = SCRIPT_DIR / "Flame.glb"
HTML_PATH = SCRIPT_DIR / "model_viewer.html"

PROGMAN_CREATE_WORKERW = 0x052C
SMTO_NORMAL = 0x0000
GWL_STYLE = -16
GWL_EXSTYLE = -20
WS_CHILD = 0x40000000
WS_POPUP = 0x80000000
WS_EX_LAYERED = 0x00080000
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_TRANSPARENT = 0x00000020
WS_EX_NOACTIVATE = 0x08000000
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOACTIVATE = 0x0010
SWP_SHOWWINDOW = 0x0040
SWP_FRAMECHANGED = 0x0020
HWND_TOP = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Show Flame.glb at the bottom-right of the desktop using a transparent "
            "window and play the Idle animation."
        )
    )
    parser.add_argument("--margin-right", type=int, default=24)
    parser.add_argument("--margin-bottom", type=int, default=24)
    parser.add_argument("--size", type=int, default=420)
    parser.add_argument(
        "--auto-exit-ms",
        type=int,
        default=0,
        help="Auto-close after the given time. Useful for smoke tests.",
    )
    parser.add_argument(
        "--click-through",
        action="store_true",
        help="Let mouse input pass through the window.",
    )
    parser.add_argument(
        "--no-desktop",
        action="store_true",
        help="Skip WorkerW desktop attachment and show as a normal overlay window.",
    )
    parser.add_argument(
        "--debug-background",
        action="store_true",
        help="Show a green background behind the model to make visibility checks easier.",
    )
    return parser.parse_args()


class QuietHttpHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".glb": "model/gltf-binary",
    }

    def log_message(self, format: str, *args) -> None:
        return


def get_free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def start_local_server(base_dir: Path) -> tuple[ThreadingHTTPServer, str]:
    port = get_free_port()
    handler = partial(QuietHttpHandler, directory=str(base_dir))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{port}"


class FlamePage(QWebEnginePage):
    def javaScriptConsoleMessage(self, level, message, line_number, source_id) -> None:
        if level != QWebEnginePage.JavaScriptConsoleMessageLevel.InfoMessageLevel:
            print(f"[web] {message} ({source_id}:{line_number})")


class FlameDesktopWindow(QWidget):
    def __init__(
        self,
        page_url: QUrl,
        size: int,
        debug_background: bool,
        stay_on_top: bool,
    ):
        super().__init__()
        window_flags = Qt.WindowType.FramelessWindowHint | Qt.WindowType.Tool
        if stay_on_top:
            window_flags |= Qt.WindowType.WindowStaysOnTopHint
        self.setWindowFlags(window_flags)
        if debug_background:
            self.setStyleSheet("background: #00aa00;")
        else:
            self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
            self.setAttribute(Qt.WidgetAttribute.WA_NoSystemBackground, True)
            self.setStyleSheet("background: transparent;")
        self.setFixedSize(size, size)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self.webview = QWebEngineView(self)
        if not debug_background:
            self.webview.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
            self.webview.setStyleSheet("background: transparent;")
        self.webview.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)
        self.webview.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.webview.setPage(FlamePage(self.webview))
        self.webview.page().setBackgroundColor(
            QColor("#00aa00") if debug_background else QColor(0, 0, 0, 0)
        )
        self.webview.loadFinished.connect(self._on_load_finished)
        layout.addWidget(self.webview)

        self.webview.load(page_url)

    def _on_load_finished(self, ok: bool) -> None:
        print("Viewer load:", "ok" if ok else "failed")


def move_bottom_right(window: QWidget, margin_right: int, margin_bottom: int) -> None:
    screen = window.screen() or QApplication.primaryScreen()
    if screen is None:
        return

    geometry = screen.availableGeometry()
    x = geometry.x() + geometry.width() - window.width() - margin_right
    y = geometry.y() + geometry.height() - window.height() - margin_bottom
    window.move(x, y)


def find_workerw() -> int | None:
    if sys.platform != "win32":
        return None

    user32 = ctypes.windll.user32
    progman = user32.FindWindowW("Progman", None)
    if not progman:
        return None

    result = wintypes.DWORD()
    user32.SendMessageTimeoutW(
        progman,
        PROGMAN_CREATE_WORKERW,
        0,
        0,
        SMTO_NORMAL,
        1000,
        ctypes.byref(result),
    )

    workerw = 0
    enum_windows_proc = ctypes.WINFUNCTYPE(
        wintypes.BOOL, wintypes.HWND, wintypes.LPARAM
    )

    @enum_windows_proc
    def callback(hwnd: int, _lparam: int) -> bool:
        nonlocal workerw
        shell_view = user32.FindWindowExW(hwnd, 0, "SHELLDLL_DefView", None)
        if shell_view:
            workerw = user32.FindWindowExW(0, hwnd, "WorkerW", None)
            if workerw:
                return False
        return True

    user32.EnumWindows(callback, 0)
    return int(workerw or progman)


def apply_window_styles(
    hwnd: int, click_through: bool, use_child_window: bool
) -> None:
    user32 = ctypes.windll.user32

    if use_child_window:
        style = user32.GetWindowLongW(hwnd, GWL_STYLE)
        style = (style | WS_CHILD) & ~WS_POPUP
        user32.SetWindowLongW(hwnd, GWL_STYLE, ctypes.c_long(style).value)

    ex_style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
    ex_style |= WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
    if click_through:
        ex_style |= WS_EX_TRANSPARENT
    user32.SetWindowLongW(hwnd, GWL_EXSTYLE, ctypes.c_long(ex_style).value)

    user32.SetWindowPos(
        hwnd,
        HWND_TOP,
        0,
        0,
        0,
        0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
    )


def attach_window_to_desktop(window: QWidget, click_through: bool) -> bool:
    if sys.platform != "win32":
        return False

    workerw = find_workerw()
    if not workerw:
        return False

    hwnd = int(window.winId())
    if not hwnd:
        return False

    user32 = ctypes.windll.user32
    user32.SetParent(hwnd, workerw)
    apply_window_styles(hwnd, click_through=click_through, use_child_window=True)
    return True


def apply_click_through(window: QWidget) -> None:
    if sys.platform != "win32":
        return

    hwnd = int(window.winId())
    if hwnd:
        apply_window_styles(hwnd, click_through=True, use_child_window=False)


def main() -> int:
    args = parse_args()

    if not MODEL_PATH.exists():
        print(f"Flame.glb was not found: {MODEL_PATH}", file=sys.stderr)
        return 1
    if not HTML_PATH.exists():
        print(f"model_viewer.html was not found: {HTML_PATH}", file=sys.stderr)
        return 1

    app = QApplication(sys.argv)

    server, base_url = start_local_server(SCRIPT_DIR)
    try:
        suffix = "?debug=1" if args.debug_background else ""
        page_url = QUrl(f"{base_url}/{HTML_PATH.name}{suffix}")

        window = FlameDesktopWindow(
            page_url=page_url,
            size=args.size,
            debug_background=args.debug_background,
            stay_on_top=args.no_desktop,
        )
        window.winId()

        attached_to_desktop = False
        if not args.no_desktop:
            attached_to_desktop = attach_window_to_desktop(
                window, click_through=args.click_through
            )
            if not attached_to_desktop:
                window.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, True)

        if args.no_desktop and args.click_through:
            apply_click_through(window)

        move_bottom_right(window, args.margin_right, args.margin_bottom)
        window.show()

        if args.auto_exit_ms > 0:
            QTimer.singleShot(args.auto_exit_ms, app.quit)

        print("Animation: Idle")
        if args.no_desktop:
            print("Desktop attach: disabled")
        else:
            print(
                "Desktop attach: ok"
                if attached_to_desktop
                else "Desktop attach: fallback overlay"
            )

        return app.exec()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())

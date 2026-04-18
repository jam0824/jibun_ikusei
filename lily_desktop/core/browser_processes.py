from __future__ import annotations

BROWSER_PROCESS_NAMES: frozenset[str] = frozenset(
    {
        "chrome.exe",
        "msedge.exe",
        "firefox.exe",
        "brave.exe",
        "opera.exe",
        "vivaldi.exe",
        "arc.exe",
    }
)


def is_browser_process(app_name: str | None) -> bool:
    return str(app_name or "").strip().lower() in BROWSER_PROCESS_NAMES

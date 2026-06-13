from __future__ import annotations

import pytest

import ai.article_fetcher as article_fetcher_mod
from ai.article_fetcher import ArticleSummary, _extract_text_from_html, fetch_article_summary


def test_html抽出はscriptとstyleとタグを除去する():
    html = """
    <html>
      <head><style>.a{color:red}</style><script>var x = 1;</script></head>
      <body>
        <h1>見出し</h1>
        <p>本文の段落です。</p>
        <script>alert('x')</script>
        <p>二つ目の段落。</p>
      </body>
    </html>
    """

    text = _extract_text_from_html(html)

    assert "見出し" in text
    assert "本文の段落です。" in text
    assert "二つ目の段落。" in text
    assert "color:red" not in text
    assert "var x" not in text
    assert "alert" not in text


def test_html抽出は連続する空白を畳んで指定文字数で切り詰める():
    html = "<p>" + ("あ" * 100) + "</p>" + "\n\n   \t  " + "<p>" + ("い" * 100) + "</p>"

    text = _extract_text_from_html(html, max_chars=50)

    assert len(text) == 50
    # 連続する空白・改行が1つに畳まれている
    assert "\n\n" not in text
    assert "\t" not in text


@pytest.mark.asyncio
async def test_本文取得と要約が成功するとサマリーを返す(monkeypatch):
    async def _fake_fetch_html(url, **kwargs):
        del kwargs
        assert url == "https://example.com/article"
        return "<p>" + ("記事本文。" * 50) + "</p>"

    async def _fake_summarize(**kwargs):
        assert "記事本文。" in kwargs["text"]
        return "この記事は記事本文について述べている。"

    monkeypatch.setattr(article_fetcher_mod, "_fetch_html", _fake_fetch_html)
    monkeypatch.setattr(article_fetcher_mod, "_summarize_text", _fake_summarize)

    result = await fetch_article_summary(
        url="https://example.com/article",
        openai_api_key="test",
        provider="ollama",
        base_url="http://127.0.0.1:11434",
        model="dummy",
        title="サンプル記事",
    )

    assert isinstance(result, ArticleSummary)
    assert result.ok is True
    assert result.summary == "この記事は記事本文について述べている。"


@pytest.mark.asyncio
async def test_本文が取得できないとokがFalseになる(monkeypatch):
    async def _fake_fetch_html(url, **kwargs):
        del url, kwargs
        return ""

    monkeypatch.setattr(article_fetcher_mod, "_fetch_html", _fake_fetch_html)

    result = await fetch_article_summary(
        url="https://example.com/empty",
        openai_api_key="test",
        provider="ollama",
        base_url="http://127.0.0.1:11434",
        model="dummy",
    )

    assert result.ok is False
    assert result.summary == ""


@pytest.mark.asyncio
async def test_取得中の例外を握りつぶしてokがFalseになる(monkeypatch):
    async def _raise(url, **kwargs):
        del url, kwargs
        raise RuntimeError("network down")

    monkeypatch.setattr(article_fetcher_mod, "_fetch_html", _raise)

    result = await fetch_article_summary(
        url="https://example.com/boom",
        openai_api_key="test",
        provider="ollama",
        base_url="http://127.0.0.1:11434",
        model="dummy",
    )

    assert result.ok is False

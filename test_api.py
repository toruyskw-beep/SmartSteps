#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_api.py  ― APIキーの動作確認スクリプト
============================================
使い方:
    python3 test_api.py   （Mac/Linux）
    python test_api.py    （Windows）

config.json のAPIキーで以下を順にテストします:
    1. 生成API  (gemini-2.5-flash-lite)
    2. 埋め込みAPI (gemini-embedding-001)
"""

import json
import urllib.request
import urllib.error
from pathlib import Path

CONFIG_PATH = Path(__file__).parent / "config.json"

def load_api_key():
    if not CONFIG_PATH.exists():
        print(f"[エラー] config.json が見つかりません: {CONFIG_PATH}")
        return None
    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    key = cfg.get("gemini_api_key", "")
    if not key or key == "YOUR_API_KEY_HERE":
        print("[エラー] config.json の gemini_api_key を設定してください")
        return None
    print(f"  APIキー: {key[:8]}...{key[-4:]} （一部マスク）")
    return key

def call_api(url, body_dict):
    body = json.dumps(body_dict).encode("utf-8")
    req  = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read())

def test_generation(api_key):
    print("\n【テスト1】生成API (gemini-2.5-flash-lite)")
    url  = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={api_key}"
    body = {"contents": [{"parts": [{"text": "「よくできています」を使った短い通知表の文を1つ書いてください。"}]}]}
    try:
        data = call_api(url, body)
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        print(f"  ✅ 成功")
        print(f"  応答: {text.strip()[:80]}")
        return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  ❌ 失敗: HTTP {e.code}")
        print(f"  詳細: {body[:200]}")
        return False
    except Exception as e:
        print(f"  ❌ 失敗: {e}")
        return False

def test_embedding(api_key):
    print("\n【テスト2】埋め込みAPI (gemini-embedding-001)")
    url  = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key={api_key}"
    body = {
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": "算数の計算がよくできています。"}]},
        "taskType": "RETRIEVAL_DOCUMENT",
        "outputDimensionality": 768
    }
    try:
        data   = call_api(url, body)
        vector = data["embedding"]["values"]
        print(f"  ✅ 成功")
        print(f"  ベクトル次元数: {len(vector)}")
        print(f"  先頭3件: {[round(v,4) for v in vector[:3]]}")
        return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  ❌ 失敗: HTTP {e.code}")
        print(f"  詳細: {body[:300]}")
        return False
    except Exception as e:
        print(f"  ❌ 失敗: {e}")
        return False

def main():
    print("=" * 50)
    print("  Gemini API 動作確認")
    print("=" * 50)

    api_key = load_api_key()
    if not api_key:
        return

    gen_ok  = test_generation(api_key)
    emb_ok  = test_embedding(api_key)

    print("\n" + "=" * 50)
    print("  結果サマリー")
    print(f"  生成API:   {'✅ OK' if gen_ok  else '❌ NG'}")
    print(f"  埋め込みAPI: {'✅ OK' if emb_ok  else '❌ NG'}")
    print("=" * 50)

    if gen_ok and emb_ok:
        print("\n  🎉 両方OK！embed_all.py を実行できます。")
    elif gen_ok and not emb_ok:
        print("\n  ⚠️  生成APIは動いていますが埋め込みAPIが失敗しています。")
        print("  → エラー詳細を確認して対処法を検討してください。")
    elif not gen_ok:
        print("\n  ❌ 生成APIも失敗しています。APIキーを確認してください。")

if __name__ == "__main__":
    main()

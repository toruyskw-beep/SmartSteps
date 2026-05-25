#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
embed_all.py  ― 診断文マスタの全テキストをベクトル化する
=============================================================
使い方:
    cd seiseki-app
    python3 embed_all.py

実行すると data/embeddings_*.json が生成される。
1日1,000件の制限に合わせて、観点別診断文(288件)とめあて(777件)を
自動で2フェーズに分割して実行する。

前提:
    pip install requests
    config.json に gemini_api_key が設定済みであること
"""

import json
import os
import sys
import time
from pathlib import Path

# ─────────────────────────────────────────
# 設定
# ─────────────────────────────────────────
SCRIPT_DIR  = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / "config.json"
DATA_DIR    = SCRIPT_DIR / "data"

EMBEDDING_MODEL    = "gemini-embedding-001"
OUTPUT_DIMENSIONS  = 768       # 1536 / 3072 も可。768 で品質・容量のバランスが良い
TASK_DOC           = "RETRIEVAL_DOCUMENT"   # 事前ベクトル化用
DELAY_SEC          = 0.7       # 100RPM 制限に対して余裕を持たせたウェイト
PROGRESS_SAVE_EACH = 50        # 何件ごとに進捗を保存するか

# 1日の上限を超えないように、フェーズごとの実行上限（余裕を持って設定）
DAILY_LIMIT = 900

# ─────────────────────────────────────────
# config.json からAPIキーを読み込む
# ─────────────────────────────────────────
def load_api_key() -> str:
    if not CONFIG_PATH.exists():
        sys.exit(f"[エラー] {CONFIG_PATH} が見つかりません。")
    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    key = cfg.get("gemini_api_key", "")
    if not key or key == "YOUR_API_KEY_HERE":
        sys.exit("[エラー] config.json の gemini_api_key を設定してください。")
    return key


# ─────────────────────────────────────────
# Gemini Embedding API 呼び出し
# ─────────────────────────────────────────
def embed_text(text: str, api_key: str, retry: int = 3) -> list[float]:
    """テキスト1件をベクトル化して返す。レート制限時は自動リトライ。"""
    import urllib.request
    import urllib.error

    url  = (f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{EMBEDDING_MODEL}:embedContent?key={api_key}")
    body = json.dumps({
        "model": f"models/{EMBEDDING_MODEL}",
        "content": {"parts": [{"text": text}]},
        "taskType": TASK_DOC,
        "outputDimensionality": OUTPUT_DIMENSIONS
    }).encode("utf-8")

    for attempt in range(retry):
        try:
            req = urllib.request.Request(
                url, data=body,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=30) as res:
                data = json.loads(res.read())
            return data["embedding"]["values"]

        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 65 * (attempt + 1)
                print(f"  ⚠ レート制限 (429)。{wait}秒待機してリトライ ({attempt+1}/{retry})...")
                time.sleep(wait)
            elif e.code >= 500:
                print(f"  ⚠ サーバーエラー ({e.code})。10秒待機してリトライ...")
                time.sleep(10)
            else:
                print(f"  ✗ APIエラー: {e.code} {e.reason}")
                raise
        except Exception as e:
            print(f"  ✗ 通信エラー: {e}")
            time.sleep(10)

    raise RuntimeError(f"APIリトライ上限({retry}回)を超えました。")


# ─────────────────────────────────────────
# テキストの抽出
# ─────────────────────────────────────────
def extract_kanten_records() -> list[dict]:
    """観点別診断文マスタ(*.json)から全テキストを抽出する。"""
    records = []
    for key in ["kokugo", "sansu", "rika", "shakai", "gaikokugo"]:
        path = DATA_DIR / f"{key}.json"
        if not path.exists():
            print(f"  [スキップ] {path} が存在しません。")
            continue
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        subject = data["subject"]
        for grade, kantens in data["grades"].items():
            for kanten, evals in kantens.items():
                for ev, text in evals.items():
                    records.append({
                        "id":      f"{key}_{grade}_{kanten}_{ev}",
                        "type":    "kanten",
                        "subject": subject,
                        "grade":   grade,
                        "kanten":  kanten,
                        "eval":    ev,
                        "text":    text
                    })
    return records


def extract_meate_records() -> list[dict]:
    """めあてマスタ(meate_*.json)からユニークなめあてテキストを抽出する。
    同じめあてが複数の準拠に存在するため、(教科+めあて)で重複排除する。
    """
    seen   = set()
    records = []
    subj_map = {
        "sansu":     "算数",
        "rika":      "理科",
        "shakai":    "社会",
        "gaikokugo": "外国語"
    }
    for key, subj in subj_map.items():
        path = DATA_DIR / f"meate_{key}.json"
        if not path.exists():
            print(f"  [スキップ] {path} が存在しません。")
            continue
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for junkyo, grades in data["data"].items():
            for grade, terms in grades.items():
                for term, units in terms.items():
                    for unit in units:
                        meate = unit.get("meate", "")
                        if not meate:
                            continue
                        dedup_key = (key, meate)
                        if dedup_key in seen:
                            continue
                        seen.add(dedup_key)
                        # IDは教科+連番で一意性を保証
                        records.append({
                            "id":      f"meate_{key}_{len(records):04d}",
                            "type":    "meate",
                            "subject": subj,
                            "grade":   grade,
                            "name":    unit["name"],
                            "text":    meate
                        })
    return records


# ─────────────────────────────────────────
# 埋め込みの実行（進捗保存付き）
# ─────────────────────────────────────────
def embed_records(
    records:    list[dict],
    api_key:    str,
    output_path: Path,
    phase_label: str,
    limit:       int = DAILY_LIMIT
) -> list[dict]:
    """
    records をベクトル化して output_path に保存する。
    既存の出力ファイルがあれば処理済みをスキップして続きから再開する。
    limit 件に達したら中断して翌日に持ち越す。
    """
    # 既存の進捗を読み込む
    results: list[dict] = []
    if output_path.exists():
        with open(output_path, encoding="utf-8") as f:
            results = json.load(f)
        done_ids = {r["id"] for r in results}
        print(f"  既存の進捗: {len(done_ids)}件完了")
    else:
        done_ids = set()

    todo = [r for r in records if r["id"] not in done_ids]
    if not todo:
        print(f"  ✓ {phase_label}: すべて完了済みです。")
        return results

    print(f"  残り: {len(todo)}件 (本日の上限: {limit}件)")
    if len(todo) > limit:
        print(f"  ⚠ 1日の上限({limit}件)を超えるため、{limit}件だけ処理して中断します。")
        print(f"    翌日に再実行すると続きから再開します。")
        todo = todo[:limit]

    processed = 0
    for i, record in enumerate(todo):
        try:
            vector = embed_text(record["text"], api_key)
            results.append({**record, "vector": [round(v, 6) for v in vector]})
            done_ids.add(record["id"])
            processed += 1

            # 進捗を定期保存
            if processed % PROGRESS_SAVE_EACH == 0:
                _save_json(results, output_path)
                print(f"  💾 進捗保存: {len(results)}/{len(records)}件 "
                      f"({phase_label} {processed}/{len(todo)})")

            time.sleep(DELAY_SEC)

        except Exception as e:
            print(f"  ✗ スキップ (id={record['id']}): {e}")
            time.sleep(5)

    # 最終保存
    _save_json(results, output_path)
    remaining = len(records) - len(results)
    if remaining > 0:
        print(f"  📅 本日分完了。残り{remaining}件は明日以降に再実行してください。")
    else:
        print(f"  ✓ {phase_label}: 全{len(results)}件の埋め込みが完了しました。")
    return results


def _save_json(data: list, path: Path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


# ─────────────────────────────────────────
# メイン処理
# ─────────────────────────────────────────
def main():
    print("=" * 60)
    print("  診断文マスタ 埋め込みスクリプト")
    print(f"  モデル: {EMBEDDING_MODEL}  次元: {OUTPUT_DIMENSIONS}")
    print("=" * 60)

    api_key = load_api_key()
    print(f"✓ APIキー読み込み完了")

    # ── フェーズ1: 観点別診断文 (288件) ───────────────────────
    print("\n【フェーズ1】観点別診断文の埋め込み (288件)")
    kanten_records = extract_kanten_records()
    print(f"  抽出完了: {len(kanten_records)}件")

    kanten_out = DATA_DIR / "embeddings_kanten.json"
    kanten_results = embed_records(
        kanten_records, api_key, kanten_out,
        "観点別診断文", limit=DAILY_LIMIT
    )
    print(f"  → {kanten_out}")

    # フェーズ1が未完了なら今日はここまで
    if len(kanten_results) < len(kanten_records):
        print("\n⚠ フェーズ1が未完了です。明日再実行してください。")
        return

    # ── フェーズ2: めあて (777件ユニーク) ─────────────────────
    print("\n【フェーズ2】めあてテキストの埋め込み (777件)")
    meate_records = extract_meate_records()
    print(f"  抽出完了: {len(meate_records)}件")

    meate_out = DATA_DIR / "embeddings_meate.json"
    meate_results = embed_records(
        meate_records, api_key, meate_out,
        "めあて", limit=DAILY_LIMIT
    )
    print(f"  → {meate_out}")

    # ── 完了サマリー ────────────────────────────────────────
    print("\n" + "=" * 60)
    if len(meate_results) >= len(meate_records):
        print("  🎉 全埋め込み完了！")
        print(f"  観点別診断文: {len(kanten_results)}件")
        print(f"  めあて:       {len(meate_results)}件")
        print(f"  合計:         {len(kanten_results)+len(meate_results)}件")
        kanten_size = kanten_out.stat().st_size / 1024
        meate_size  = meate_out.stat().st_size / 1024
        print(f"\n  ファイルサイズ:")
        print(f"  {kanten_out.name}: {kanten_size:.0f} KB")
        print(f"  {meate_out.name}:  {meate_size:.0f} KB")
        print("\n  次のステップ: python3 -m http.server 8000 でブラウザを開いてください。")
    else:
        remaining = len(meate_records) - len(meate_results)
        print(f"  📅 めあての残り{remaining}件は明日以降に再実行してください。")
    print("=" * 60)


if __name__ == "__main__":
    main()

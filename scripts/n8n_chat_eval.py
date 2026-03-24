#!/usr/bin/env python3
"""
n8n chat evaluator

Sends test prompts to an n8n chat webhook in one persistent session,
captures responses, and supports manual scoring.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


DEFAULT_QUESTIONS = [
    "Merhaba, ben Ayse. Istanbul Kadikoy'dayim.",
    "Bu bilgiyi hatirla: Fistik alerjim var ve kartla odemek istiyorum.",
    "Bu aksam 19:00 icin corba + manti siparisi vermek istiyorum, nasil ilerlerim?",
    "Adresimi yanlis girdim, sonradan degistirebilir miyim?",
    "Siparisim 45 dakikadir gelmedi, ne yapmaliyim?",
    "Odeme karttan cekildi ama siparis olusmadi gibi gorunuyor.",
    "Soguk geldi, iade veya telafi sureci nasil?",
    "Ben 17 yasindayim, satici olabilir miyim?",
    "Komisyon ve odeme gunleri nedir?",
    "Canli destekte insan temsilciye baglar misin?",
    "Az once hangi alerjim oldugunu soyledim?",
    "Az once hangi odeme yontemini tercih ettigimi soyledim?",
]


@dataclass
class Result:
    idx: int
    question: str
    answer: str
    score: str = ""
    expected: str = ""
    issue: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate n8n chat responses in one persistent session."
    )
    parser.add_argument("--url", required=True, help="n8n chat webhook URL")
    parser.add_argument(
        "--instance-id",
        default="",
        help="Optional X-Instance-Id header from n8n chat page",
    )
    parser.add_argument(
        "--session-id",
        default=f"manual-eval-{int(time.time())}",
        help="Chat session id (same id keeps memory)",
    )
    parser.add_argument(
        "--questions-file",
        default="",
        help="Text file with one question per line",
    )
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="Enter questions manually in terminal; empty line ends input",
    )
    parser.add_argument(
        "--manual-score",
        action="store_true",
        help="Prompt for per-question score (0-5), expected answer and issue notes",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.4,
        help="Delay in seconds between messages (default: 0.4)",
    )
    parser.add_argument(
        "--out-dir",
        default="tmp/n8n-evals",
        help="Output directory (default: tmp/n8n-evals)",
    )
    return parser.parse_args()


def load_questions(args: argparse.Namespace) -> list[str]:
    if args.interactive:
        print("Sorularını gir. Bitirmek için boş satır bırak.")
        out: list[str] = []
        while True:
            q = input(f"Soru {len(out)+1}: ").strip()
            if not q:
                break
            out.append(q)
        return out

    if args.questions_file:
        path = Path(args.questions_file)
        if not path.exists():
            raise FileNotFoundError(f"questions file not found: {path}")
        return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

    return DEFAULT_QUESTIONS


def send_message(url: str, instance_id: str, session_id: str, question: str) -> str:
    payload = {
        "action": "sendMessage",
        "chatInput": question,
        "sessionId": session_id,
    }
    body = json.dumps(payload).encode("utf-8")

    headers = {"Content-Type": "application/json"}
    if instance_id:
        headers["X-Instance-Id"] = instance_id

    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {details}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"request failed: {exc.reason}") from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw

    if isinstance(data, dict):
        return str(data.get("output", data))
    return str(data)


def ask_manual_scores(results: Iterable[Result]) -> None:
    print("\nManuel puanlama (0-5). Boş geçebilirsin.")
    for r in results:
        print(f"\n[{r.idx}] Soru: {r.question}")
        print(f"Cevap: {r.answer}")
        r.score = input("Puan (0-5): ").strip()
        r.expected = input("Beklenen iyi cevap (kısa): ").strip()
        r.issue = input("Risk/sorun notu: ").strip()


def write_csv(path: Path, rows: Iterable[Result]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "question", "answer", "score_0_5", "expected_good_answer", "risk_or_issue"])
        for r in rows:
            writer.writerow([f"Q{r.idx:02d}", r.question, r.answer, r.score, r.expected, r.issue])


def write_markdown(path: Path, rows: list[Result], meta: dict[str, str]) -> None:
    scored = [r for r in rows if r.score]
    numeric = []
    for r in scored:
        try:
            numeric.append(float(r.score))
        except ValueError:
            pass

    avg = (sum(numeric) / len(numeric)) if numeric else None

    lines = [
        "# n8n Chat Evaluation Report",
        "",
        f"- Date: {meta['date']}",
        f"- URL: {meta['url']}",
        f"- Session ID: `{meta['session_id']}`",
        f"- Question count: {len(rows)}",
    ]

    if avg is not None:
        lines.append(f"- Average score: {avg:.2f}/5")
    lines.append("")
    lines.append("| ID | Question | Bot Answer | Score | Expected | Risk/Issue |")
    lines.append("|---|---|---|---:|---|---|")
    for r in rows:
        q = r.question.replace("\n", " ").replace("|", "\\|")
        a = r.answer.replace("\n", " ").replace("|", "\\|")
        e = r.expected.replace("\n", " ").replace("|", "\\|")
        i = r.issue.replace("\n", " ").replace("|", "\\|")
        s = r.score or ""
        lines.append(f"| Q{r.idx:02d} | {q} | {a} | {s} | {e} | {i} |")

    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    args = parse_args()
    questions = load_questions(args)
    if not questions:
        print("No questions provided.")
        return 1

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    results: list[Result] = []
    print(f"Session: {args.session_id}")
    print(f"Total questions: {len(questions)}")

    for idx, q in enumerate(questions, start=1):
        print(f"\nQ{idx:02d}: {q}")
        answer = send_message(args.url, args.instance_id, args.session_id, q)
        print(f"A{idx:02d}: {answer}")
        results.append(Result(idx=idx, question=q, answer=answer))
        time.sleep(args.delay)

    if args.manual_score:
        ask_manual_scores(results)

    csv_path = out_dir / f"eval-{stamp}.csv"
    md_path = out_dir / f"eval-{stamp}.md"

    write_csv(csv_path, results)
    write_markdown(
        md_path,
        results,
        meta={
            "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "url": args.url,
            "session_id": args.session_id,
        },
    )

    print("\nSaved files:")
    print(f"- {csv_path}")
    print(f"- {md_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Local-only CPU smoke benchmark. No real user tasks, cloud tunnel or persistent key.

Run with Python 3.10+: python integrations/laya/run-local-test.py --install
"""
import argparse
import json
import math
import os
from pathlib import Path
import secrets
import socket
import statistics
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler
import venv

ROOT = Path(__file__).resolve().parent
LABELS = {"coding", "files", "research", "general", "unclear"}
# Router defaults to a bundled repository with the multilingual subfolder.
# Its revision is not the standalone laya-multilingual repository revision.
CHECKPOINT = "55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851"
CHECKPOINT_REPO = "convaiinnovations/laya"
CHECKPOINT_SUBFOLDER = "multilingual"

def check_health(health):
    if not isinstance(health, dict) or health.get("status") != "ok":
        raise ValueError("invalid health response")
    revisions = health.get("revisions")
    if (health.get("loaded") != ["multilingual"] or not isinstance(revisions, dict)
        or revisions.get("multilingual") != CHECKPOINT):
        raise ValueError("checkpoint mismatch")

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise URLError("redirect refused")

# Do not send loopback traffic or the temporary key through system HTTP proxies.
OPENER = build_opener(ProxyHandler({}), NoRedirect())

def local_json(path, key, payload=None, timeout=60):
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    request = Request("http://127.0.0.1:8000" + path, data=data, headers=headers)
    with OPENER.open(request, timeout=timeout) as response:
        if response.headers.get_content_type() != "application/json":
            raise ValueError("not JSON")
        raw = response.read(32769)
        if len(raw) > 32768:
            raise ValueError("response too large")
        return json.loads(raw)

def category_from(data):
    if data.get("routing", {}).get("model") != "multilingual":
        raise ValueError("wrong checkpoint")
    answer = data.get("answers", {}).get("intent", {})
    choice, probs = answer.get("choice"), answer.get("probabilities")
    if answer.get("type") != "choice" or choice not in LABELS or answer.get("low_confidence") is True:
        raise ValueError("invalid choice")
    if not isinstance(probs, dict) or set(probs) != LABELS:
        raise ValueError("invalid labels")
    values = list(probs.values())
    if any(type(p) not in (int, float) or not math.isfinite(p) or not 0 <= p <= 1 for p in values):
        raise ValueError("invalid probabilities")
    confidence = answer.get("answer_confidence")
    if (abs(sum(values) - 1) > .01 or abs(probs[choice] - max(values)) > .00001
        or type(confidence) not in (int, float) or not math.isfinite(confidence)
        or not 0 <= confidence <= 1 or abs(confidence - probs[choice]) > .01):
        raise ValueError("inconsistent probabilities")
    return choice

def summary(rows, startup_seconds):
    answered = [r for r in rows if r["category"] is not None]
    correct = sum(r["correct"] for r in answered)
    return {"schema_version": "svoya-intent-v1", "checkpoint_revision": CHECKPOINT,
            "checkpoint_repo": CHECKPOINT_REPO, "checkpoint_subfolder": CHECKPOINT_SUBFOLDER,
            "mode": "local_smoke", "execution_changed": False, "permission_granted": False,
            "cases": len(rows), "answered": len(answered), "correct": correct,
            "accuracy_on_answered": correct / len(answered) if answered else None,
            "complete": len(rows) == len(answered), "startup_seconds": round(startup_seconds, 2),
            "median_seconds": round(statistics.median(r["seconds"] for r in answered), 3) if answered else None,
            "results": rows,
            "note": "Smoke cases are public, not held-out. This does not certify safe autonomy or production accuracy."}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true", help="Create a local venv and install pinned source + upstream dependencies")
    args = parser.parse_args()
    if sys.version_info < (3, 10):
        print("Нужен Python 3.10 или новее."); return 1
    target = ROOT / ".venv"
    python = target / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if args.install:
        print("Создаю окружение и устанавливаю зависимости. Возможны большие загрузки; платные сервисы не используются.", flush=True)
        if not python.exists(): venv.EnvBuilder(with_pip=True).create(target)
        subprocess.run([str(python), "-m", "pip", "install", "-r", str(ROOT / "requirements.txt")], check=True)
    if not python.exists():
        print("Первый запуск: добавь --install. Нужен доступ к GitHub, PyPI и Hugging Face."); return 1
    # Fail before launching if a different service occupies this address.
    with socket.socket() as probe:
        try: probe.bind(("127.0.0.1", 8000))
        except OSError:
            print("Порт 8000 занят. Заверши локальный сервис на этом порту и повтори."); return 1
    env = dict(os.environ)
    env.update(LAYA_HOST="127.0.0.1", LAYA_PORT="8000", LAYA_DEVICE="cpu", LAYA_MODELS="multilingual",
               LAYA_REVISION="reviewed", LAYA_AUTO_TASK="0", LAYA_MAX_LOADED="1", LAYA_MAX_CONCURRENT="1",
               LAYA_API_KEY=secrets.token_urlsafe(32), LAYA_PRELOAD="1", LAYA_LOG_LEVEL="warning", LAYA_THREADS="2")
    key = env["LAYA_API_KEY"]
    started = time.monotonic()
    with tempfile.TemporaryFile(mode="w+b") as log:
        server = subprocess.Popen([str(python), "-c", "from laya.serve import main; main()"], env=env, stdout=log, stderr=log)
        try:
            print("Загружаю один multilingual checkpoint на CPU. Первый запуск скачивает веса; ключ не выводится.", flush=True)
            next_update = started
            while True:
                if server.poll() is not None:
                    print("Сервис завершился до старта. Проверь свободную память и доступ к Hugging Face."); return 1
                if time.monotonic() - started > 900:
                    print("Сервис не стартовал за 15 минут. Тест не пройден; результата точности нет."); return 1
                try:
                    health = local_json("/health", key, timeout=2)
                    try: check_health(health)
                    except ValueError:
                        print("Версия модели или список загруженных моделей не совпадают. Тест остановлен.")
                        revisions = health.get("revisions") if isinstance(health, dict) else None
                        actual = revisions.get("multilingual") if isinstance(revisions, dict) else None
                        if isinstance(actual, str) and len(actual) == 40 and all(c in "0123456789abcdef" for c in actual):
                            print("Ожидаемая ревизия: %s; полученная: %s" % (CHECKPOINT, actual))
                        else: print("Сервис не сообщил корректную ревизию модели.")
                        return 1
                    break
                except (URLError, TimeoutError, OSError):
                    if time.monotonic() >= next_update:
                        print("Ожидание запуска: %d сек." % (time.monotonic() - started), flush=True)
                        next_update = time.monotonic() + 10
                    time.sleep(1)
            startup = time.monotonic() - started
            template = json.loads((ROOT / "request-template.json").read_text(encoding="utf-8"))
            cases = json.loads((ROOT / "cases.json").read_text(encoding="utf-8"))
            rows = []
            for n, case in enumerate(cases, 1):
                payload = dict(template, state=case["task"])
                t = time.monotonic()
                try: category = category_from(local_json("/v1/systemone", key, payload))
                except (ValueError, TypeError, AttributeError, URLError, TimeoutError, OSError): category = None
                rows.append({"id": case["id"], "expected": case["expected"], "category": category,
                             "correct": category == case["expected"], "seconds": round(time.monotonic() - t, 3)})
                print("%d/%d %s: %s" % (n, len(cases), case["id"], category or "недоступно"), flush=True)
            report = summary(rows, startup)
            output = ROOT / "local-results.json"
            output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            print("Отчёт: %s. Ответов %d/%d; правильных %d. Это тест, а не разрешение автономных действий." %
                  (output, report["answered"], report["cases"], report["correct"]), flush=True)
            return 0 if report["complete"] else 1
        finally:
            server.terminate()
            try: server.wait(timeout=10)
            except subprocess.TimeoutExpired: server.kill(); server.wait()

if __name__ == "__main__":
    try: sys.exit(main())
    except KeyboardInterrupt: print("Тест отменён."); sys.exit(130)
    except (OSError, subprocess.CalledProcessError): print("Установка или запуск не завершены. Тест не пройден."); sys.exit(1)

# Laya / СВОЯ AI: compare first

Status: adapter and local benchmark prepared; live model inference not measured in development or CI. No weights or paid runtime are included in the Vercel application. This branch does not activate Laya in the ordinary chat pipeline.

## What is connected

- `POST /api/laya-compare` uses the existing owner/session admission check, validates a single task (1–1000 characters), and optionally compares the existing regex route with a Laya recommendation.
- Fixed schema `svoya-intent-v1`: `coding`, `files`, `research`, `general`, `unclear`. The model is explicitly `multilingual`, language hint `ru`.
- Laya never changes the authoritative route, risk gate, tasks, approvals, Coding Agent or permissions. `permission_granted` and `execution_changed` are always false.
- No URL, model, key, owner or instruction overrides can be passed by the client. No raw upstream action/tool fields are exposed or executed.
- With no runtime configuration the response explicitly says `not_configured`. A bad/unavailable runtime returns a bounded failure. No public demo is used.

## Local test on your PC

Download/unpack the `ai/laya-shadow` branch of СВОЯ AI. In its root directory:

Windows (Python 3.10+):

```powershell
py integrations/laya/run-local-test.py --install
```

macOS/Linux:

```sh
python3 integrations/laya/run-local-test.py --install
```

The script creates an isolated `.venv`, installs the source pinned below and its dependencies, starts one CPU checkpoint on `127.0.0.1:8000` with an ephemeral random key, checks the checkpoint revision, runs 24 synthetic Russian requests, saves `local-results.json` and stops the server. It refuses a busy port and HTTP redirects, bypasses system proxies for loopback requests, and does not print or persist the key. There are no purchases, tunnels or inbound public listeners.

First installation downloads Python dependencies and model weights from GitHub, PyPI and Hugging Face. It can take substantial time and disk/RAM; performance on the user's hardware has not been checked. Setup pins the Laya source and checkpoint, **not every transitive dependency**. No inference dependencies are installed by GitHub CI or Vercel. Run later without `--install` to reuse the environment/cache. Stop with Ctrl+C.

Send the summary or `local-results.json` for review; it contains case IDs/results/timings, not real tasks or keys. `complete: true` means responses were valid, not that predictions were correct. The published smoke cases are not an independent held-out accuracy test.

## Connecting the main website later

A service on your PC's `127.0.0.1` is reachable only from that PC. The Vercel API cannot access it. This local test does not establish a persistent connection to the website. An owned HTTPS inference gateway or a separately designed local companion is needed next; this change opens neither. Avoid buying a GPU service before local results show a benefit.

For an already owned HTTPS runtime only, configure **server-side** environment variables (never put the key in browser code or Git):

```text
SVOYA_LAYA_URL=https://your-owned-runtime.example.com
SVOYA_LAYA_ALLOWED_HOSTS=your-owned-runtime.example.com
SVOYA_LAYA_API_KEY=<private service key>
```

The adapter appends `/v1/systemone`. Exact hostname allowlist, HTTPS/root-only configuration, no redirect following, 8-second deadline and 32-KiB JSON response cap are enforced. Configuration is trusted administrative input; this is not a complete DNS-rebinding/egress firewall. Keep DNS and network egress under your control. Requests send the task text to that configured service; do not configure a third-party demo. The six/minute and single-in-flight owner limiter is per function instance, not a durable distributed quota.

The API receives the ordinary operator bearer token in the Authorization header. The upstream receives only its separate Laya key and task schema, never the user's identity/session token. Testing route classification does not make the existing FILE_TOOL/WEB_RESEARCH labels actual executors.

## Reviewed versions / red team

- Upstream source: [NandhaKishorM/laya at 6d942c9](https://github.com/NandhaKishorM/laya/tree/6d942c92081fbc139e736bbd9ac0023223c29b7f), pyproject 0.3.22, Apache-2.0.
- Multilingual checkpoint: `convaiinnovations/laya-multilingual` revision `e4e9ddf21a7b1903b7acffd8814ad4307bf63a67`, pinned by `LAYA_REVISION=reviewed` in this source version.
- [Staged adoption](https://nandhakishorm.github.io/laya/staged-adoption/) explicitly separates a typed decision from permission and requires held-out evidence before promotion.

| Finding | Evidence / scope | Current boundary |
| --- | --- | --- |
| Confident negation/cancellation errors | Upstream README's known limits; not reproduced on this user's hardware | `unclear` option plus synthetic negative cases; no action authority even if the prediction is wrong |
| Benchmark numbers do not prove Russian task accuracy | Upstream's typed-decision base-model results are weak on that benchmark; tuning/schema differ from ours | No claimed routing improvement; need separate representative held-out evaluation |
| Advertised GPU latency is not local CPU latency | Upstream T4 benchmark | Measure cold start and per-request latency locally |
| Default server listens publicly; auth is optional | Reviewed `laya/serve.py` | Local script forces loopback, random key, one model, CPU and one inference slot |
| Model-supplied actions or high confidence could be mistaken for permission | Decision result includes probabilities/action metadata | Allowlisted sanitized fields only; no executor reads this recommendation |
| Supply-chain/runtime cost | Torch/Transformers dependencies and checkpoint downloads | Pin reviewed source/checkpoint, separate environment; transitive dependency lock remains future work |
| Secret-bearing or private real requests | Runtime would receive the complete request | Benchmark uses only fixed synthetic cases; no production traffic collection or task logging added |

Additional existing СВОЯ AI Coding Agent risks are **outside this integration and remain open**: shell interpolation of task text in the reporting step, verification code mutable by the coding agent, and weaker repair-run restrictions. Do not use that workflow as a bootstrapper for this runtime. This branch is written directly and validated with mocked service responses; no Coding Agent was dispatched.

## Validation and promotion

Run `node --test scripts/*.test.cjs scripts/*.test.mjs` and `python -m unittest discover -s integrations/laya -p 'test_*.py'`. CI validates auth boundaries, schema, injected executable fields, bad hosts/redirect policy, response bounds, failure behavior, limiter and local report semantics. These are software checks with mocks, not real model evaluation.

Before making Laya influence routing: review the local report, collect independently labeled Russian held-out cases (including ambiguity/negation), compare with the baseline, measure failure rate/latency, pin/lock the deployment dependencies and define a limited reversible rollout. Payment, deletion, publishing and external communication remain controlled by application policy and explicit authorization. Laya alone does not create persistent memory, tool executors, a worker or a multiagent system.

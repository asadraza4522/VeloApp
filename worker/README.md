# velo-worker

Turns a page URL into **direct media URLs + headers** for the phone to download. It never downloads or stores media.

```bash
python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
pytest -m "not network"          # unit tests
pytest -m network                # live canaries (real internet)
WORKER_SHARED_SECRET=dev uvicorn app.main:app --port 8080
curl -s localhost:8080/v1/resolve -H 'Authorization: Bearer dev' -H 'content-type: application/json' \
     -d '{"url":"https://archive.org/details/BigBuckBunny_124"}'
```

Design: `docs/VELO_TECHNICAL_PLAN.md` §6. Failure codes and fallback rules: `app/failures.py`. Lite/Full gating: `app/policy.py`.

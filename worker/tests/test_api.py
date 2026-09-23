import pytest
from fastapi.testclient import TestClient

from app import main
from app.failures import FailureCode as F
from app.manager import Attempt, ResolveFailed
from tests.test_manager import Fake

HEADERS = {"Authorization": "Bearer s3cret"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", "s3cret")
    c = TestClient(main.app)
    main.app.state.manager = main.ResolverManager([Fake("fake")])
    return c


def test_health_is_open(client):
    assert client.get("/healthz").json() == {"ok": True}


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer nope"}, {"Authorization": "s3cret"}])
def test_resolve_requires_shared_secret(client, headers):
    assert client.post("/v1/resolve", json={"url": "https://example.com/a.mp4"}, headers=headers).status_code == 401


def test_fails_closed_when_secret_unset(monkeypatch):
    monkeypatch.delenv("WORKER_SHARED_SECRET", raising=False)
    assert TestClient(main.app).post("/v1/resolve", json={"url": "https://example.com/a.mp4"}, headers={"Authorization": "Bearer "}).status_code == 401


def test_success_shape(client):
    r = client.post("/v1/resolve", json={"url": "https://youtube.com/watch?v=abc"}, headers=HEADERS).json()
    assert r["ok"] is True and r["result"]["resolver_id"] == "fake"


def test_domain_failure_is_200_with_error_body(client):
    class Boom(Fake):
        async def resolve(self, url):
            raise ResolveFailed(F.AUTH_REQUIRED, "login", [Attempt("boom", False, F.AUTH_REQUIRED, 3)])

    main.app.state.manager = main.ResolverManager([Boom("boom")])
    resp = client.post("/v1/resolve", json={"url": "https://youtube.com/watch?v=abc"}, headers=HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False and body["error"]["code"] == "AUTH_REQUIRED"


def test_input_validation(client):
    assert client.post("/v1/resolve", json={"url": "x"}, headers=HEADERS).status_code == 422
    assert client.post("/v1/resolve", json={"url": "https://example.com/a", "distribution": "weird"}, headers=HEADERS).status_code == 422


def test_lite_distribution_is_enforced(client):
    body = client.post("/v1/resolve", json={"url": "https://youtube.com/watch?v=abc", "distribution": "lite"}, headers=HEADERS).json()
    assert body["ok"] is False and body["error"]["code"] == "UNSUPPORTED"

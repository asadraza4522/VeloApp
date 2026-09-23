import time

import pytest

from app.failures import FailureCode as F
from app.failures import ResolveError
from app.manager import ResolveFailed, ResolverManager
from app.models import MediaMetadata, MediaResult


def ok_result(rid: str) -> MediaResult:
    return MediaResult(resolver_id=rid, resolved_at=time.time(), variants=[],
                       metadata=MediaMetadata(source_url="u", platform="YouTube", title="t"))


class Fake:
    def __init__(self, rid, priority=50, score=50, error: F | None = None, exc: Exception | None = None):
        self.id, self.priority, self._score, self._error, self._exc, self.calls = rid, priority, score, error, exc, 0

    def score(self, url, platform):
        return self._score

    async def resolve(self, url):
        self.calls += 1
        if self._exc:
            raise self._exc
        if self._error:
            raise ResolveError(self._error, "boom")
        return ok_result(self.id)


URL = "https://youtube.com/watch?v=abc"


async def test_best_resolver_wins():
    a, b = Fake("a", score=90), Fake("b", score=50)
    r = await ResolverManager([b, a]).resolve(URL)
    assert r.resolver_id == "a" and b.calls == 0


async def test_falls_back_when_provider_changed():
    a, b = Fake("a", score=90, error=F.PROVIDER_CHANGED), Fake("b", score=50)
    r = await ResolverManager([a, b]).resolve(URL)
    assert r.resolver_id == "b" and a.calls == 1


async def test_unexpected_exception_is_classified_and_falls_back():
    a, b = Fake("a", score=90, exc=RuntimeError("Unable to extract stuff")), Fake("b", score=50)
    assert (await ResolverManager([a, b]).resolve(URL)).resolver_id == "b"


@pytest.mark.parametrize("code", [F.AUTH_REQUIRED, F.PRIVATE, F.DRM_PROTECTED, F.CAPTCHA_REQUIRED, F.MEDIA_NOT_FOUND, F.RATE_LIMITED])
async def test_never_works_around_access_control(code):
    a, b = Fake("a", score=90, error=code), Fake("b", score=50)
    with pytest.raises(ResolveFailed) as e:
        await ResolverManager([a, b]).resolve(URL)
    assert e.value.code is code and b.calls == 0
    assert [x.resolver_id for x in e.value.attempts] == ["a"]


async def test_all_failed_reports_last_code_and_attempts():
    a, b = Fake("a", score=90, error=F.PROVIDER_CHANGED), Fake("b", score=50, error=F.UNSUPPORTED)
    with pytest.raises(ResolveFailed) as e:
        await ResolverManager([a, b]).resolve(URL)
    assert e.value.code is F.UNSUPPORTED and len(e.value.attempts) == 2


async def test_no_applicable_resolver():
    with pytest.raises(ResolveFailed) as e:
        await ResolverManager([Fake("a", score=0)]).resolve(URL)
    assert e.value.code is F.UNSUPPORTED


async def test_unhealthy_resolver_is_demoted():
    a, b = Fake("a", score=90, error=F.PROVIDER_CHANGED), Fake("b", score=70)
    m = ResolverManager([a, b])
    for _ in range(8):
        await m.resolve(URL)
    # a is tried until its health drops below b's weight, then b is simply served first
    assert a.calls < 8 and b.calls == 8
    assert m.health.rate("a", "YouTube") < 1.0
    a.calls = 0
    await m.resolve(URL)
    assert a.calls == 0


async def test_access_failures_do_not_hurt_health():
    a = Fake("a", error=F.AUTH_REQUIRED)
    m = ResolverManager([a])
    for _ in range(5):
        with pytest.raises(ResolveFailed):
            await m.resolve(URL)
    assert m.health.rate("a", "YouTube") == 1.0


async def test_lite_blocks_third_party_platforms_before_any_resolver_runs():
    a = Fake("a")
    with pytest.raises(ResolveError) as e:
        await ResolverManager([a]).resolve(URL, distribution="lite")
    assert e.value.code is F.UNSUPPORTED and a.calls == 0
    assert (await ResolverManager([a]).resolve("https://archive.org/details/x", distribution="lite")).resolver_id == "a"


async def test_private_addresses_rejected_before_resolving():
    a = Fake("a")
    with pytest.raises(ResolveError):
        await ResolverManager([a]).resolve("http://internal.test/x.mp4")
    assert a.calls == 0

import httpx
import pytest

from app import policy
from app.failures import FailureCode as F
from app.failures import ResolveError, classify
from app.security import safe_request, validate_url


@pytest.mark.parametrize("text,code", [
    ("ERROR: This video is protected by DRM", F.DRM_PROTECTED),
    ("Sign in to confirm you're not a bot", F.CAPTCHA_REQUIRED),
    ("This video is private", F.PRIVATE),
    ("Sign in to confirm your age", F.AUTH_REQUIRED),
    ("Login required to view this post", F.AUTH_REQUIRED),
    ("HTTP Error 429: Too Many Requests", F.RATE_LIMITED),
    ("Unsupported URL: https://x.test/a", F.UNSUPPORTED),
    ("Requested format is not available", F.FORMAT_UNAVAILABLE),
    ("HTTP Error 404: Not Found", F.MEDIA_NOT_FOUND),
    ("Video unavailable", F.MEDIA_NOT_FOUND),
    ("Unable to extract player response; please report this issue", F.PROVIDER_CHANGED),
    ("Connection timed out", F.NETWORK_ERROR),
    ("something entirely new", F.UNKNOWN),
])
def test_classify(text, code):
    assert classify(RuntimeError(text)) is code


def test_classify_timeout_and_passthrough():
    assert classify(TimeoutError()) is F.NETWORK_ERROR
    assert classify(ResolveError(F.PRIVATE)) is F.PRIVATE


@pytest.mark.parametrize("url", [
    "http://localhost/a", "http://internal.test/a", "http://meta.test/latest/meta-data", "http://v6.test/a",
    "http://127.0.0.1/a", "http://10.1.2.3/a", "ftp://example.com/a", "file:///etc/passwd", "javascript:alert(1)",
    "https://user:pw@example.com/a",
])
async def test_ssrf_blocked(url):
    with pytest.raises(ResolveError):
        await validate_url(url)


async def test_public_url_ok():
    assert await validate_url(" https://example.com/a.mp4 ") == "https://example.com/a.mp4"


async def test_redirect_to_private_address_is_blocked():
    def handler(req: httpx.Request):
        if req.url.host == "example.com":
            return httpx.Response(302, headers={"location": "http://meta.test/latest/meta-data"})
        return httpx.Response(200, text="secret")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        with pytest.raises(ResolveError) as e:
            await safe_request(c, "GET", "https://example.com/redir")
    assert e.value.code is F.UNSUPPORTED


def test_lite_policy():
    policy.enforce("full", "https://youtube.com/watch?v=x")
    policy.enforce("lite", "https://cdn.example.com/video.MP4?x=1")
    policy.enforce("lite", "https://archive.org/details/foo")
    policy.enforce("lite", "https://upload.wikimedia.org/a/b")
    for bad in ["https://youtube.com/watch?v=x", "https://www.instagram.com/reel/abc/", "https://evilarchive.org/x"]:
        with pytest.raises(ResolveError) as e:
            policy.enforce("lite", bad)
        assert e.value.code is F.UNSUPPORTED

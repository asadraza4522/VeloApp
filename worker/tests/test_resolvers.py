import httpx
import pytest

from app.failures import FailureCode as F
from app.failures import ResolveError
from app.health import HealthTracker, SupabaseHealthSink
from app.resolvers.direct import DirectResolver
from app.resolvers.oembed import OEmbedResolver
from app.resolvers.ytdlp import normalize


def client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_direct_resolver_reads_headers():
    seen = []

    def handler(req):
        seen.append(req.method)
        return httpx.Response(200, headers={"content-type": "video/mp4", "content-length": "1048576"})

    r = await DirectResolver(client=client(handler)).resolve("https://cdn.example.com/clips/My%20Clip.mp4")
    v = r.variants[0]
    assert (v.type, v.container, v.filesize, v.url) == ("video", "mp4", 1048576, "https://cdn.example.com/clips/My%20Clip.mp4")
    assert r.metadata.title == "My Clip.mp4" and seen == ["HEAD"]


async def test_direct_resolver_head_rejected_falls_back_to_range_get():
    def handler(req):
        if req.method == "HEAD":
            return httpx.Response(405)
        return httpx.Response(206, headers={"content-type": "audio/mpeg", "content-range": "bytes 0-0/5000"})

    r = await DirectResolver(client=client(handler)).resolve("https://cdn.example.com/a.mp3")
    assert r.variants[0].type == "audio" and r.variants[0].filesize == 5000


@pytest.mark.parametrize("status,code", [(403, F.AUTH_REQUIRED), (404, F.MEDIA_NOT_FOUND), (429, F.RATE_LIMITED), (500, F.SERVER_ERROR)])
async def test_direct_resolver_http_errors(status, code):
    with pytest.raises(ResolveError) as e:
        await DirectResolver(client=client(lambda req: httpx.Response(status))).resolve("https://cdn.example.com/a.mp4")
    assert e.value.code is code


async def test_direct_resolver_rejects_html_page():
    h = lambda req: httpx.Response(200, headers={"content-type": "text/html"})  # noqa: E731
    with pytest.raises(ResolveError) as e:
        await DirectResolver(client=client(h)).resolve("https://example.com/page")
    assert e.value.code is F.UNSUPPORTED


async def test_oembed_is_metadata_only():
    h = lambda req: httpx.Response(200, json={"title": "Hi", "author_name": "Me", "provider_name": "YouTube", "thumbnail_url": "https://i/x.jpg"})  # noqa: E731
    r = await OEmbedResolver(client=client(h)).resolve("https://www.youtube.com/watch?v=abc")
    assert r.degraded and r.variants == [] and r.metadata.title == "Hi"


YT_INFO = {
    "id": "abc123", "title": "Demo", "uploader": "Chan", "channel_id": "UC1", "extractor_key": "Youtube", "duration": 65,
    "upload_date": "20260910", "thumbnail": "https://i/t.jpg", "description": "d",
    "http_headers": {"User-Agent": "UA", "Cookie": "secret=1", "Accept-Encoding": "gzip"},
    "formats": [
        {"format_id": "sb0", "ext": "mhtml", "format_note": "storyboard", "url": "https://s", "protocol": "mhtml", "vcodec": "none", "acodec": "none"},
        {"format_id": "18", "ext": "mp4", "vcodec": "avc1.42001E", "acodec": "mp4a.40.2", "height": 360, "width": 640, "protocol": "https", "tbr": 500,
         "url": "https://rr1.googlevideo.com/videoplayback?expire=1900000000&ip=1.2.3.4&id=x"},
        {"format_id": "137", "ext": "mp4", "vcodec": "avc1.640028", "acodec": "none", "height": 1080, "protocol": "https", "tbr": 4000, "filesize": 90_000_000,
         "url": "https://rr1.googlevideo.com/videoplayback?expire=1900000000&ip=1.2.3.4&id=y"},
        {"format_id": "248", "ext": "webm", "vcodec": "vp9", "acodec": "none", "height": 1080, "protocol": "https", "tbr": 3000, "url": "https://rr/x"},
        {"format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2", "abr": 129, "protocol": "https", "tbr": 129, "url": "https://rr/a"},
        {"format_id": "251", "ext": "webm", "vcodec": "none", "acodec": "opus", "abr": 130, "protocol": "https", "tbr": 130, "url": "https://rr/o"},
        {"format_id": "drm1", "ext": "mp4", "vcodec": "avc1", "acodec": "aac", "height": 720, "protocol": "https", "has_drm": True, "url": "https://rr/d"},
        {"format_id": "hls1", "ext": "mp4", "vcodec": "avc1", "acodec": "aac", "height": 720, "protocol": "m3u8_native", "url": "https://rr/h.m3u8"},
        {"format_id": "rtmp", "ext": "flv", "vcodec": "avc1", "acodec": "aac", "height": 480, "protocol": "rtmp", "url": "rtmp://x"},
    ],
}


def test_normalize_selects_and_maps_variants():
    r = normalize(YT_INFO, "https://youtu.be/abc123")
    ids = [v.id for v in r.variants]
    assert "sb0" not in ids and "drm1" not in ids and "rtmp" not in ids       # storyboard / DRM / non-http dropped
    assert ids.index("137") < ids.index("18")                                  # highest resolution first
    assert "248" not in ids                                                    # mp4/avc preferred over webm/vp9 at same height
    assert {"140", "251"} <= set(ids)                                          # audio-only tracks kept
    hls = next(v for v in r.variants if v.id == "hls1")
    assert hls.protocol == "hls"
    v137 = next(v for v in r.variants if v.id == "137")
    assert (v137.has_video, v137.has_audio, v137.ip_bound, v137.filesize) == (True, False, True, 90_000_000)
    assert v137.label == "1080p MP4 (video only)"
    assert "Cookie" not in v137.headers and v137.headers == {"User-Agent": "UA"}   # only safe headers are forwarded
    assert r.expires_at == 1900000000
    m = r.metadata
    assert (m.platform, m.platform_media_id, m.creator, m.media_type) == ("YouTube", "abc123", "Chan", "video")
    assert m.published_at.startswith("2026-09-10") and m.duration == 65


def test_health_tracker_and_sink():
    t = HealthTracker()
    for _ in range(5):
        t.record("ytdlp", "YouTube", False)
    assert t.rate("ytdlp", "YouTube") < 0.7 and t.rate("ytdlp", "TikTok") == 1.0
    rows = t.drain_dirty()
    assert rows[0]["resolver_id"] == "ytdlp" and rows[0]["attempts"] == 5 and t.drain_dirty() == []


async def test_health_sink_upserts_via_postgrest():
    sent = {}

    def handler(req: httpx.Request):
        sent.update(url=str(req.url), auth=req.headers["authorization"], prefer=req.headers["prefer"], body=req.content)
        return httpx.Response(201)

    t = HealthTracker()
    t.record("ytdlp", "YouTube", True)
    sink = SupabaseHealthSink("https://proj.supabase.co", "eyJlegacy.jwt.key", client=client(handler))
    assert await sink.flush(t) == 1
    assert sent["url"].startswith("https://proj.supabase.co/rest/v1/resolver_health") and "on_conflict=resolver_id%2Cplatform" in sent["url"]
    assert sent["auth"] == "Bearer eyJlegacy.jwt.key" and "merge-duplicates" in sent["prefer"]
    assert await sink.flush(t) == 0  # nothing dirty → no request


def test_new_style_secret_key_is_sent_as_apikey_only():
    sink = SupabaseHealthSink("https://proj.supabase.co", "sb_secret_abc")
    assert sink._headers["apikey"] == "sb_secret_abc" and "Authorization" not in sink._headers

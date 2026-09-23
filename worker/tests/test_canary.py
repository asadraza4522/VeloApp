"""Live canaries: run nightly in CI (`pytest -m network`), page on failure. They hit the real internet."""

import pytest

from app.main import build_manager

pytestmark = pytest.mark.network

CANARIES = {
    "direct-file": "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4",
    "internet-archive": "https://archive.org/details/BigBuckBunny_124",
    "youtube": "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
}


@pytest.mark.parametrize("name", CANARIES)
async def test_canary(name):
    result = await build_manager().resolve(CANARIES[name])
    assert result.variants, f"{name}: resolved but no downloadable variants"
    assert all(v.url.startswith("http") for v in result.variants)

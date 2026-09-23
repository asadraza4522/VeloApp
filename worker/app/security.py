"""URL safety for a service that fetches user-supplied URLs (SSRF guard)."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urljoin, urlparse

import httpx

from app.failures import FailureCode, ResolveError

MAX_REDIRECTS = 5


def _blocked(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved
            or addr.is_multicast or addr.is_unspecified)


def _check_sync(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ResolveError(FailureCode.UNSUPPORTED, "Only http(s) URLs are accepted")
    if parsed.username or parsed.password:
        raise ResolveError(FailureCode.UNSUPPORTED, "URLs with credentials are not accepted")
    try:
        answers = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror as exc:
        raise ResolveError(FailureCode.NETWORK_ERROR, "Host cannot be resolved") from exc
    for answer in answers:
        if _blocked(ipaddress.ip_address(answer[4][0])):
            raise ResolveError(FailureCode.UNSUPPORTED, "Private or local destinations are not allowed")
    return url.strip()


async def validate_url(url: str) -> str:
    """Scheme + resolve-then-check every address the host maps to."""
    return await asyncio.to_thread(_check_sync, url)


async def safe_request(client: httpx.AsyncClient, method: str, url: str, **kw) -> httpx.Response:
    """Like client.request but validates every redirect hop (a public URL can 302 to 169.254.169.254)."""
    for _ in range(MAX_REDIRECTS + 1):
        await validate_url(url)
        resp = await client.request(method, url, follow_redirects=False, **kw)
        if resp.is_redirect and (loc := resp.headers.get("location")):
            url = urljoin(url, loc)
            continue
        return resp
    raise ResolveError(FailureCode.SERVER_ERROR, "Too many redirects")

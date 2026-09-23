"""Failure taxonomy (PRD §16) and the policy that decides what may fall back (PRD §17, §23, §68)."""

from __future__ import annotations

import asyncio
import re
from enum import StrEnum


class FailureCode(StrEnum):
    AUTH_REQUIRED = "AUTH_REQUIRED"
    PRIVATE = "PRIVATE"
    RATE_LIMITED = "RATE_LIMITED"
    MEDIA_NOT_FOUND = "MEDIA_NOT_FOUND"
    PROVIDER_CHANGED = "PROVIDER_CHANGED"
    FORMAT_UNAVAILABLE = "FORMAT_UNAVAILABLE"
    NETWORK_ERROR = "NETWORK_ERROR"
    UNSUPPORTED = "UNSUPPORTED"
    CAPTCHA_REQUIRED = "CAPTCHA_REQUIRED"
    SERVER_ERROR = "SERVER_ERROR"
    DRM_PROTECTED = "DRM_PROTECTED"
    UNKNOWN = "UNKNOWN"


# Trying another resolver can only help when the *resolver* failed. Access-control failures are never
# worked around (no DRM / auth / private-content bypass).
FALLBACK_ALLOWED = frozenset({
    FailureCode.PROVIDER_CHANGED,
    FailureCode.UNSUPPORTED,
    FailureCode.FORMAT_UNAVAILABLE,
    FailureCode.SERVER_ERROR,
    FailureCode.UNKNOWN,
})


class ResolveError(Exception):
    def __init__(self, code: FailureCode, message: str = ""):
        super().__init__(message or code.value)
        self.code = code
        self.message = message or code.value


# Order matters: first match wins. Patterns are matched case-insensitively against the error text.
_RULES: list[tuple[re.Pattern[str], FailureCode]] = [
    (re.compile(r"drm|widevine|fairplay|protected by", re.I), FailureCode.DRM_PROTECTED),
    (re.compile(r"captcha|verify you are (a )?human|confirm you.re not a bot", re.I), FailureCode.CAPTCHA_REQUIRED),
    (re.compile(r"private (video|account|post)|this video is private|is private", re.I), FailureCode.PRIVATE),
    (re.compile(r"sign in|log ?in|login required|authentication|age.restricted|members.only|cookies", re.I), FailureCode.AUTH_REQUIRED),
    (re.compile(r"429|too many requests|rate.?limit", re.I), FailureCode.RATE_LIMITED),
    (re.compile(r"unsupported url|no suitable extractor|not a valid url", re.I), FailureCode.UNSUPPORTED),
    (re.compile(r"requested format is not available|no video formats|format.*not available", re.I), FailureCode.FORMAT_UNAVAILABLE),
    (re.compile(r"404|not found|does not exist|has been removed|video unavailable|no longer available|deleted", re.I), FailureCode.MEDIA_NOT_FOUND),
    (re.compile(r"unable to extract|please report this issue|unexpected response|extractor error|json", re.I), FailureCode.PROVIDER_CHANGED),
    (re.compile(r"timed out|timeout|connection|unreachable|name resolution|network|ssl", re.I), FailureCode.NETWORK_ERROR),
    (re.compile(r"\b5\d\d\b|server error|bad gateway", re.I), FailureCode.SERVER_ERROR),
]


def classify(exc: BaseException) -> FailureCode:
    if isinstance(exc, ResolveError):
        return exc.code
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return FailureCode.NETWORK_ERROR
    text = f"{type(exc).__name__}: {exc}"
    for pattern, code in _RULES:
        if pattern.search(text):
            return code
    return FailureCode.UNKNOWN

import socket

import pytest

HOSTS = {"localhost": "127.0.0.1", "internal.test": "10.0.0.5", "meta.test": "169.254.169.254", "v6.test": "::1"}


@pytest.fixture(autouse=True)
def fake_dns(monkeypatch):
    """Deterministic DNS: named private hosts map to private IPs, everything else is a public address."""
    real = socket.getaddrinfo

    def fake(host, *a, **k):
        if host in HOSTS:
            ip = HOSTS[host]
        else:
            try:
                socket.inet_pton(socket.AF_INET, host)
                ip = host
            except OSError:
                ip = "93.184.216.34"
        fam = socket.AF_INET6 if ":" in ip else socket.AF_INET
        return [(fam, socket.SOCK_STREAM, 6, "", (ip, 0))]

    monkeypatch.setattr(socket, "getaddrinfo", fake)
    yield
    monkeypatch.setattr(socket, "getaddrinfo", real)

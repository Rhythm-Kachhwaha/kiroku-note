import re
import pytest
from fastapi.testclient import TestClient

from app.config import get_allowed_host_regex
from app.main import app


def test_default_loopback_hosts_match():
    pattern = re.compile(get_allowed_host_regex({}))
    assert pattern.match("localhost")
    assert pattern.match("localhost:21828")
    assert pattern.match("localhost:8000")
    assert pattern.match("127.0.0.1")
    assert pattern.match("127.0.0.1:21828")
    assert pattern.match("testserver")
    assert pattern.match("testserver:80")


def test_malicious_hosts_rejected():
    pattern = re.compile(get_allowed_host_regex({}))
    assert not pattern.match("evil.com")
    assert not pattern.match("localhost.evil.com")
    assert not pattern.match("attacker.com:21828")
    assert not pattern.match("evil-localhost")
    assert not pattern.match("127.0.0.1.attacker.com")
    assert not pattern.match("testserver.phishing.net")


def test_custom_allowed_hosts_comma_separated_and_escaped():
    env = {"KIROKU_ALLOWED_HOSTS": "my-tunnel.loca.lt, kiroku.example.com"}
    pattern = re.compile(get_allowed_host_regex(env))

    assert pattern.match("my-tunnel.loca.lt")
    assert pattern.match("my-tunnel.loca.lt:443")
    assert pattern.match("kiroku.example.com")
    assert pattern.match("kiroku.example.com:8443")

    # Escaping special characters: dots should not match arbitrary characters
    assert not pattern.match("kirokuXexampleXcom")
    assert not pattern.match("my-tunnelXlocaXlt")


def test_wildcard_in_allowed_hosts_ignored():
    env = {"KIROKU_ALLOWED_HOSTS": "*, trusted-host.com"}
    pattern = re.compile(get_allowed_host_regex(env))

    assert pattern.match("trusted-host.com")
    assert pattern.match("localhost")
    assert not pattern.match("evil.com")
    assert not pattern.match("*")


def test_api_rejects_invalid_host_header():
    client = TestClient(app)
    response = client.get("/api/health", headers={"Host": "attacker.com"})
    assert response.status_code == 403
    assert "Invalid Host header" in response.json()["detail"]


def test_api_accepts_valid_host_header():
    client = TestClient(app)
    response = client.get("/api/health", headers={"Host": "localhost:21828"})
    assert response.status_code == 200

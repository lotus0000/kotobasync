from ipaddress import ip_network

import pytest
from sqlalchemy import select
from starlette.requests import Request

from kotobasync.auth.client_ip import client_ip
from kotobasync.auth.passphrase import set_passphrase
from kotobasync.auth.tokens import hash_token
from kotobasync.db.models import Device

PASS = "correct horse battery"


def _set_pass(app, passphrase: str = PASS) -> None:
    with app.state.session_factory() as s:
        set_passphrase(s, passphrase)
        s.commit()


def _login(client, passphrase: str = PASS):
    return client.post("/api/auth/login", json={"passphrase": passphrase, "device_name": "iPhone"})


def test_login_before_passphrase_is_set_returns_503(client):
    assert _login(client).status_code == 503


def test_short_passphrase_rejected(app):
    with app.state.session_factory() as s, pytest.raises(ValueError):
        set_passphrase(s, "short")


def test_login_issues_token_that_is_stored_hashed(app, client):
    _set_pass(app)
    r = _login(client)
    assert r.status_code == 200
    token = r.json()["token"]
    assert len(token) >= 40
    devices = client.get("/api/devices", headers={"Authorization": f"Bearer {token}"}).json()
    assert [(d["name"], d["current"]) for d in devices] == [("iPhone", True)]
    with app.state.session_factory() as s:
        stored = s.scalars(select(Device)).one()
        assert stored.token_hash == hash_token(token)
        assert stored.token_hash != token


def test_five_failures_lock_out_even_the_right_passphrase(app, client, clock):
    _set_pass(app)
    for _ in range(5):
        assert _login(client, "wrong passphrase").status_code == 401
    assert _login(client).status_code == 429
    clock.advance(15 * 60_000 + 1)
    assert _login(client).status_code == 200


def test_missing_or_unknown_token_is_401(client):
    assert client.get("/api/devices").status_code == 401
    assert client.get("/api/devices", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get("/api/devices", headers={"Authorization": "Basic abc"}).status_code == 401


def test_revoked_device_is_rejected(client, auth):
    me = client.get("/api/devices", headers=auth).json()[0]
    assert client.delete(f"/api/devices/{me['id']}", headers=auth).status_code == 204
    assert client.get("/api/devices", headers=auth).status_code == 401


def test_revoke_unknown_device_is_404(client, auth):
    assert client.delete("/api/devices/nope", headers=auth).status_code == 404


def test_last_seen_is_throttled_to_once_per_minute(app, client, auth, clock):
    def last_seen() -> int:
        with app.state.session_factory() as s:
            return s.scalars(select(Device)).one().last_seen_at

    first = last_seen()
    clock.advance(30_000)
    client.get("/api/devices", headers=auth)
    assert last_seen() == first
    clock.advance(31_000)
    client.get("/api/devices", headers=auth)
    assert last_seen() == clock()


def _request(peer: str, cf: str | None = None) -> Request:
    headers = [(b"cf-connecting-ip", cf.encode())] if cf else []
    return Request({"type": "http", "client": (peer, 1234), "headers": headers})


def test_client_ip_trusts_cf_header_only_from_trusted_proxies():
    nets = [ip_network("127.0.0.1/32"), ip_network("172.16.0.0/12")]
    assert client_ip(_request("172.17.0.1", "203.0.113.9"), nets) == "203.0.113.9"
    assert client_ip(_request("198.51.100.7", "203.0.113.9"), nets) == "198.51.100.7"
    assert client_ip(_request("172.17.0.1"), nets) == "172.17.0.1"

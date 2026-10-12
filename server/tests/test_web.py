import pytest
from fastapi.testclient import TestClient

from kotobasync.app import create_app


@pytest.fixture
def web_client(settings, clock, enricher, tmp_path):
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<!doctype html><title>KotobaSync</title>")
    (static / "assets" / "app.js").write_text("console.log('hi')")
    app = create_app(settings.model_copy(update={"static_dir": str(static)}), clock=clock, enricher=enricher)
    with TestClient(app) as c:
        yield c


def test_serves_index_and_assets(web_client):
    assert "KotobaSync" in web_client.get("/").text
    r = web_client.get("/assets/app.js")
    assert r.status_code == 200
    assert "console.log" in r.text


def test_client_side_routes_fall_back_to_index(web_client):
    r = web_client.get("/words/abc")
    assert r.status_code == 200
    assert "KotobaSync" in r.text


def test_unknown_api_path_is_json_404_not_index(web_client):
    r = web_client.get("/api/nope")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")


def test_api_still_works_with_pwa_mounted(web_client):
    assert web_client.get("/api/health").json()["ok"] is True


def test_security_headers_on_every_response(web_client):
    for path in ("/", "/api/health"):
        h = web_client.get(path).headers
        assert h["x-content-type-options"] == "nosniff"
        assert h["referrer-policy"] == "no-referrer"
        assert "default-src 'self'" in h["content-security-policy"]


def test_without_build_output_only_api_is_served(client):
    assert client.get("/").status_code == 404
    assert client.get("/api/health").status_code == 200


PREFLIGHT = {
    "Access-Control-Request-Method": "PUT",
    "Access-Control-Request-Headers": "authorization,content-type,cf-access-client-id,cf-access-client-secret",
}


def test_cors_allows_only_the_extension_origin(client):
    ok = client.options("/api/words/x", headers={"Origin": "chrome-extension://testextensionid", **PREFLIGHT})
    assert ok.status_code == 200
    assert ok.headers["access-control-allow-origin"] == "chrome-extension://testextensionid"
    bad = client.options("/api/words/x", headers={"Origin": "https://evil.example", **PREFLIGHT})
    assert "access-control-allow-origin" not in bad.headers


def test_relogin_bounces_back_to_the_app(client):
    # Navigating here (an /api/ path the service worker never serves) lets Cloudflare Access re-authenticate.
    r = client.get("/api/relogin", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "/"

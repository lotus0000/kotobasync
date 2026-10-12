import pytest

from conftest import delete_req, live_count, new_id, word_body
from kotobasync.db.models import EnrichJob, Word


def test_requires_auth(client):
    assert client.put(f"/api/words/{new_id()}", json=word_body()).status_code == 401


def test_new_word_without_reading_is_pending_and_queued(app, put):
    wid = new_id()
    r = put(wid)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["canonical_id"] == wid
    assert data["word"]["enrich_status"] == "pending"
    assert data["word"]["server_seq"] > 0
    with app.state.session_factory() as s:
        assert s.get(EnrichJob, wid) is not None


def test_word_with_reading_and_meaning_is_manual_and_not_queued(app, put):
    wid = new_id()
    assert put(wid, reading="たべもの", meaning_zh="食物").json()["word"]["enrich_status"] == "manual"
    with app.state.session_factory() as s:
        assert s.get(EnrichJob, wid) is None


def test_identical_retry_is_idempotent(app, put):
    wid = new_id()
    first = put(wid).json()
    assert put(wid).json() == first
    assert live_count(app) == 1


def test_newer_write_wins_and_stale_write_is_ignored(put):
    wid = new_id()
    put(wid, updated_at=1_000)
    assert put(wid, meaning_zh="A", updated_at=2_000).json()["word"]["meaning_zh"] == "A"
    assert put(wid, meaning_zh="B", updated_at=1_500).json()["word"]["meaning_zh"] == "A"


def test_same_surface_and_reading_merges_into_existing(app, put):
    a, b = new_id(), new_id()
    put(a, surface="上手", reading="じょうず", meaning_zh="擅长")
    r = put(b, surface="上手", reading="じょうず", sentence="彼は料理が上手だ。", familiarity=3,
            created_at=2_000, updated_at=2_000).json()
    assert r["canonical_id"] == a
    assert r["word"]["meaning_zh"] == "擅长"
    assert r["word"]["sentence"] == "彼は料理が上手だ。"
    assert r["word"]["familiarity"] == 3
    with app.state.session_factory() as s:
        tomb = s.get(Word, b)
        assert tomb.deleted_at is not None
        assert tomb.merged_into == a
    assert live_count(app) == 1


def test_retry_after_merge_returns_same_canonical(app, put):
    a, b = new_id(), new_id()
    put(a, surface="上手", reading="じょうず")
    put(b, surface="上手", reading="じょうず", created_at=2_000, updated_at=2_000)
    again = put(b, surface="上手", reading="じょうず", created_at=2_000, updated_at=2_000)
    assert again.status_code == 200
    assert again.json()["canonical_id"] == a
    assert live_count(app) == 1


def test_homographs_with_different_readings_coexist(app, put):
    a, b = new_id(), new_id()
    put(a, surface="上手", reading="じょうず")
    assert put(b, surface="上手", reading="うわて").json()["canonical_id"] == b
    assert live_count(app) == 2


def test_two_saves_without_reading_are_both_kept_pending(app, put):
    a, b = new_id(), new_id()
    put(a, surface="猫")
    put(b, surface="猫", created_at=2_000, updated_at=2_000)
    assert live_count(app) == 2


@pytest.mark.parametrize("older_is_editor", [True, False])
def test_edit_that_collides_with_live_word_merges_into_older(app, put, older_is_editor):
    a, b = new_id(), new_id()
    put(a, surface="上手", reading="じょうず", meaning_zh="擅长", created_at=1_000, updated_at=1_000)
    put(b, surface="上手", reading="うわて", created_at=2_000, updated_at=2_000)
    if older_is_editor:
        r = put(a, surface="上手", reading="うわて", created_at=1_000, updated_at=3_000)
    else:
        r = put(b, surface="上手", reading="じょうず", created_at=2_000, updated_at=3_000)
    assert r.status_code == 200, r.text
    assert r.json()["canonical_id"] == a
    assert live_count(app) == 1
    with app.state.session_factory() as s:
        assert s.get(Word, b).merged_into == a


def test_width_and_whitespace_variants_are_the_same_word(put):
    a, b = new_id(), new_id()
    put(a, surface="ＡＩ", reading="えーあい")
    r = put(b, surface=" AI ", reading="えーあい", created_at=2_000, updated_at=2_000).json()
    assert r["canonical_id"] == a
    assert r["word"]["surface_norm"] == "AI"


@pytest.mark.parametrize(
    "overrides",
    [
        {"surface": "   "},
        {"surface": "　"},
        {"surface": "あ" * 65},
        {"sentence": "あ" * 301},
        {"meaning_zh": "あ" * 1001},
        {"familiarity": 6},
        {"user_edited": ["sentence"]},
        {"source": "web"},
    ],
)
def test_invalid_payloads_rejected(put, overrides):
    assert put(new_id(), **overrides).status_code == 422


def test_delete_resurrect_and_stale_delete(app, client, auth, put):
    wid = new_id()
    put(wid, updated_at=1_000)
    r = delete_req(client, auth, wid, 2_000)
    assert r.status_code == 200
    assert r.json()["word"]["deleted_at"] == 2_000
    with app.state.session_factory() as s:
        assert s.get(EnrichJob, wid) is None
    revived = put(wid, updated_at=3_000).json()["word"]
    assert revived["deleted_at"] is None
    with app.state.session_factory() as s:
        assert s.get(EnrichJob, wid) is not None
    assert delete_req(client, auth, wid, 2_500).json()["word"]["deleted_at"] is None


def test_delete_unknown_word_is_a_noop(client, auth):
    assert delete_req(client, auth, new_id(), 1).status_code == 204


def test_sync_pages_by_server_seq_and_includes_tombstones(client, auth, put):
    ids = [new_id() for _ in range(3)]
    for i, wid in enumerate(ids):
        put(wid, surface=f"語{i}")
    delete_req(client, auth, ids[0], 5_000)

    page1 = client.get("/api/sync", params={"since": 0, "limit": 2}, headers=auth).json()
    assert page1["has_more"] is True
    page2 = client.get("/api/sync", params={"since": page1["next_seq"], "limit": 2}, headers=auth).json()
    assert page2["has_more"] is False
    seen = page1["changes"] + page2["changes"]
    assert [c["id"] for c in seen] == [ids[1], ids[2], ids[0]]
    assert seen[-1]["deleted_at"] == 5_000

    empty = client.get("/api/sync", params={"since": page2["next_seq"]}, headers=auth).json()
    assert empty == {"changes": [], "next_seq": page2["next_seq"], "has_more": False}


def test_search_matches_text_and_filters_and_hides_deleted(client, auth, put):
    a, b, c = new_id(), new_id(), new_id()
    put(a, surface="猫", reading="ねこ", meaning_zh="猫咪", familiarity=2)
    put(b, surface="犬", reading="いぬ", meaning_zh="狗")
    put(c, surface="鳥", reading="とり", meaning_zh="鸟")
    delete_req(client, auth, c, 9_000)

    def ids_for(**params) -> list[str]:
        return [w["id"] for w in client.get("/api/words", params=params, headers=auth).json()]

    assert ids_for(q="ねこ") == [a]
    assert ids_for(q="狗") == [b]
    assert ids_for(q="100%") == []
    assert ids_for(familiarity=2) == [a]
    assert sorted(ids_for(status="manual")) == sorted([a, b])
    assert c not in ids_for()

import asyncio

from conftest import live_count, new_id
from kotobasync.db.models import EnrichJob, Word
from kotobasync.enrich.config import save_ai_config
from kotobasync.enrich.types import EnrichError, EnrichResult
from kotobasync.enrich.worker import BACKOFF_BASE_MS, MAX_ATTEMPTS, process_one


def run_once(app) -> bool:
    st = app.state
    return asyncio.run(process_one(st.session_factory, st.enricher, st.settings, st.clock))


def get_word(app, wid: str) -> Word:
    with app.state.session_factory() as s:
        return s.get(Word, wid)


def get_job(app, wid: str) -> EnrichJob | None:
    with app.state.session_factory() as s:
        return s.get(EnrichJob, wid)


def test_worker_fills_pending_word_and_bumps_seq(app, client, auth, put, enricher):
    enricher.results["勉強"] = EnrichResult(
        surface="勉強", reading="べんきょう", meaning_zh="学习", example_ja="毎日勉強します。", example_zh="每天学习。"
    )
    wid = new_id()
    seq_before = put(wid, surface="勉強", sentence="毎日勉強する。").json()["word"]["server_seq"]
    assert run_once(app) is True
    w = get_word(app, wid)
    assert (w.reading, w.meaning_zh, w.example_ja, w.enrich_status) == ("べんきょう", "学习", "毎日勉強します。", "done")
    assert w.server_seq > seq_before
    assert get_job(app, wid) is None
    assert run_once(app) is False
    changes = client.get("/api/sync", params={"since": seq_before}, headers=auth).json()["changes"]
    assert [c["id"] for c in changes] == [wid]


def test_worker_never_overwrites_user_edited_fields(app, put):
    wid = new_id()
    put(wid, surface="勉強", meaning_zh="我的释义", user_edited=["meaning_zh"])
    run_once(app)
    w = get_word(app, wid)
    assert w.meaning_zh == "我的释义"
    assert w.reading == "てすと"
    assert w.enrich_status == "done"


def test_worker_corrects_surface_unless_user_edited(app, put, enricher):
    enricher.results["食べ"] = EnrichResult(surface="食べる", reading="たべる", meaning_zh="吃")
    a, b = new_id(), new_id()
    put(a, surface="食べ")
    put(b, surface="食べ", user_edited=["surface"], created_at=2_000, updated_at=2_000)
    run_once(app)
    run_once(app)
    wa, wb = get_word(app, a), get_word(app, b)
    assert (wa.surface, wa.surface_norm, wa.reading) == ("食べる", "食べる", "たべる")
    assert (wb.surface, wb.reading) == ("食べ", "たべる")


def test_worker_merges_offline_twins_into_older(app, put):
    a, b = new_id(), new_id()
    put(a, surface="猫", created_at=1_000, updated_at=1_000)
    put(b, surface="猫", sentence="猫が好き。", created_at=2_000, updated_at=2_000)
    run_once(app)
    run_once(app)
    assert live_count(app) == 1
    assert get_word(app, b).merged_into == a
    assert get_word(app, a).sentence == "猫が好き。"
    assert get_job(app, a) is None and get_job(app, b) is None


def test_worker_backs_off_then_marks_failed(app, put, enricher, clock):
    wid = new_id()
    put(wid, surface="謎")
    enricher.error = EnrichError("model said no")
    for attempt in range(1, MAX_ATTEMPTS):
        assert run_once(app) is True
        job = get_job(app, wid)
        assert job.attempts == attempt
        assert job.next_run_at == clock() + BACKOFF_BASE_MS * 2**attempt
        assert "model said no" in job.last_error
        assert run_once(app) is False
        clock.advance(BACKOFF_BASE_MS * 2**attempt)
    assert run_once(app) is True
    assert get_word(app, wid).enrich_status == "failed"
    assert get_job(app, wid) is None


def test_worker_survives_unexpected_exceptions(app, put, enricher):
    wid = new_id()
    put(wid, surface="謎")
    enricher.error = RuntimeError("connection reset")
    assert run_once(app) is True
    assert get_job(app, wid).attempts == 1


def test_worker_idles_unless_mode_is_auto(app, put):
    wid = new_id()
    put(wid)
    with app.state.session_factory() as s:
        save_ai_config(s, {"enrich_mode": "external"})
        s.commit()
    assert run_once(app) is False
    assert get_job(app, wid) is not None


def test_retry_requeues_failed_word(app, client, auth, put):
    wid = new_id()
    put(wid)
    with app.state.session_factory() as s:
        s.get(Word, wid).enrich_status = "failed"
        s.delete(s.get(EnrichJob, wid))
        s.commit()
    r = client.post(f"/api/words/{wid}/enrich", headers=auth)
    assert r.status_code == 200
    assert r.json()["word"]["enrich_status"] == "pending"
    assert get_job(app, wid).attempts == 0
    assert client.post(f"/api/words/{new_id()}/enrich", headers=auth).status_code == 404


def test_pending_lists_words_for_agents(app, client, auth, put):
    a, b, c = new_id(), new_id(), new_id()
    put(a, surface="一", created_at=1_000)
    put(b, surface="二", reading="に", meaning_zh="二", created_at=2_000)
    put(c, surface="三", created_at=3_000)
    with app.state.session_factory() as s:
        s.get(Word, c).enrich_status = "failed"
        s.commit()
    assert [w["id"] for w in client.get("/api/enrich/pending", headers=auth).json()] == [a, c]
    only_pending = client.get("/api/enrich/pending", params={"include_failed": False}, headers=auth).json()
    assert [w["id"] for w in only_pending] == [a]


def _enrich(client, auth, wid, payload):
    return client.put(f"/api/words/{wid}/enrichment", json=payload, headers=auth)


def test_agent_enrichment_fills_blanks_by_default(client, auth, put):
    wid = new_id()
    put(wid, surface="勉強", meaning_zh="学", user_edited=["meaning_zh"])
    w = _enrich(client, auth, wid, {"reading": "べんきょう", "meaning_zh": "学习", "example_ja": "勉強する。"}).json()["word"]
    assert (w["reading"], w["meaning_zh"], w["example_ja"], w["enrich_status"]) == ("べんきょう", "学", "勉強する。", "done")


def test_agent_enrichment_overwrite_still_respects_user_edited(client, auth, put):
    wid = new_id()
    put(wid, surface="勉強", reading="べんきょう", meaning_zh="学", example_ja="旧", user_edited=["meaning_zh"])
    w = _enrich(client, auth, wid, {"meaning_zh": "学习", "example_ja": "新", "overwrite": True}).json()["word"]
    assert (w["meaning_zh"], w["example_ja"]) == ("学", "新")


def test_agent_enrichment_rejects_non_hiragana_reading(client, auth, put):
    wid = new_id()
    put(wid)
    assert _enrich(client, auth, wid, {"reading": "タベモノ"}).status_code == 422


def test_agent_enrichment_merges_on_collision(app, client, auth, put):
    a, b = new_id(), new_id()
    put(a, surface="上手", reading="じょうず", created_at=1_000, updated_at=1_000)
    put(b, surface="上手", created_at=2_000, updated_at=2_000)
    r = _enrich(client, auth, b, {"reading": "じょうず"})
    assert r.status_code == 200
    assert r.json()["canonical_id"] == a
    assert live_count(app) == 1


def test_agent_enrichment_unknown_word_is_404(client, auth):
    assert _enrich(client, auth, new_id(), {"reading": "あ"}).status_code == 404


def _upsert_direct(app, wid: str, **overrides) -> None:
    from conftest import word_body
    from kotobasync.words.schemas import WordIn
    from kotobasync.words.service import upsert_word

    with app.state.session_factory() as s:
        upsert_word(s, wid, WordIn(**word_body(**overrides)), app.state.clock())
        s.commit()


def test_worker_keeps_edits_made_during_the_llm_call(app, put, enricher):
    wid = new_id()
    put(wid, surface="勉強")
    enricher.during = lambda: _upsert_direct(
        app, wid, surface="勉強", meaning_zh="我的释义", user_edited=["meaning_zh"], updated_at=5_000
    )
    assert run_once(app) is True
    w = get_word(app, wid)
    assert w.meaning_zh == "我的释义"
    assert w.reading == "てすと"
    assert w.updated_at > 5_000


def test_worker_leaves_words_deleted_during_the_llm_call_alone(app, put, enricher, clock):
    from kotobasync.words.service import delete_word

    a, b = new_id(), new_id()
    put(a, surface="勉強", created_at=1_000, updated_at=1_000)
    put(b, surface="勉強", reading="てすと", meaning_zh="我的", created_at=2_000, updated_at=2_000)

    def delete_a() -> None:
        with app.state.session_factory() as s:
            delete_word(s, a, 6_000, clock())
            s.commit()

    enricher.during = delete_a
    assert run_once(app) is True
    wb = get_word(app, b)
    assert (wb.deleted_at, wb.merged_into, wb.meaning_zh) == (None, None, "我的")
    assert get_word(app, a).updated_at == 6_000


def test_worker_failure_does_not_mark_a_word_completed_meanwhile(app, put, enricher):
    wid = new_id()
    put(wid, surface="謎")
    enricher.error = EnrichError("boom")
    enricher.during = lambda: _upsert_direct(app, wid, surface="謎", reading="なぞ", meaning_zh="谜", updated_at=5_000)
    run_once(app)
    assert get_word(app, wid).enrich_status == "manual"
    assert get_job(app, wid) is None


def test_stale_full_record_put_requeues_instead_of_stranding_the_word(app, put):
    wid = new_id()
    put(wid, surface="勉強", updated_at=1_000)
    run_once(app)
    assert get_word(app, wid).enrich_status == "done"
    # A device that pulled before enrichment rates the word: its copy still has blank AI fields.
    r = put(wid, surface="勉強", familiarity=3, updated_at=9_000).json()["word"]
    assert r["enrich_status"] == "pending"
    run_once(app)
    w = get_word(app, wid)
    assert (w.reading, w.meaning_zh, w.enrich_status, w.familiarity) == ("てすと", "测试", "done", 3)


def test_fields_the_user_cleared_on_purpose_are_not_re_enriched(app, put):
    wid = new_id()
    put(wid, reading="たべもの", meaning_zh="食物")
    r = put(wid, reading="", meaning_zh="食物", user_edited=["reading"], updated_at=2_000).json()["word"]
    assert r["enrich_status"] == "manual"
    assert get_job(app, wid) is None

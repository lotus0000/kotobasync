import pytest
from sqlalchemy.exc import IntegrityError

from kotobasync.db.models import Word
from kotobasync.db.seq import next_seq
from kotobasync.words.normalize import is_hiragana_reading, normalize_surface


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "version": "0.1.0"}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [(" 食べ物 ", "食べ物"), ("ＡＩ", "AI"), ("ｶﾀｶﾅ", "カタカナ"), ("　猫\n", "猫")],
)
def test_normalize_surface(raw, expected):
    assert normalize_surface(raw) == expected


def test_is_hiragana_reading():
    assert is_hiragana_reading("たべもの")
    assert is_hiragana_reading("らーめん")
    assert not is_hiragana_reading("タベモノ")
    assert not is_hiragana_reading("食べ物")
    assert not is_hiragana_reading("")


def test_next_seq_is_monotonic_across_sessions(app):
    with app.state.session_factory() as s:
        assert [next_seq(s) for _ in range(3)] == [1, 2, 3]
        s.commit()
    with app.state.session_factory() as s:
        assert next_seq(s) == 4


def _word(word_id: str, reading: str, deleted_at: int | None = None) -> Word:
    return Word(
        id=word_id, surface="上手", surface_norm="上手", reading=reading, source="manual",
        enrich_status="manual", created_at=1, updated_at=1, deleted_at=deleted_at, server_seq=0,
    )


def test_unique_index_only_covers_live_words_with_reading(app):
    with app.state.session_factory() as s:
        s.add_all([
            _word("a", "じょうず"),
            _word("b", "うわて"),
            _word("c", "じょうず", deleted_at=5),
            _word("d", ""),
            _word("e", ""),
        ])
        s.commit()
        s.add(_word("f", "じょうず"))
        with pytest.raises(IntegrityError):
            s.commit()

from sqlalchemy import text
from sqlalchemy.orm import Session


def next_seq(session: Session) -> int:
    """Next value of the global change counter; SQLite's single writer keeps it monotonic."""
    row = session.execute(
        text("UPDATE meta SET value = value + 1 WHERE key = 'server_seq' RETURNING value")
    ).first()
    if row is None:
        session.execute(text("INSERT INTO meta (key, value) VALUES ('server_seq', 1)"))
        return 1
    return int(row[0])

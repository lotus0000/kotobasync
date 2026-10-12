from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy.orm import Session

from kotobasync.db.models import Setting

_KEY = "passphrase_hash"
_hasher = PasswordHasher()


def set_passphrase(session: Session, passphrase: str) -> None:
    if len(passphrase) < 8:
        raise ValueError("passphrase must be at least 8 characters")
    digest = _hasher.hash(passphrase)
    row = session.get(Setting, _KEY)
    if row is None:
        session.add(Setting(key=_KEY, value=digest))
    else:
        row.value = digest


def verify_passphrase(session: Session, passphrase: str) -> bool | None:
    """None means no passphrase has been configured yet."""
    row = session.get(Setting, _KEY)
    if row is None:
        return None
    try:
        return _hasher.verify(row.value, passphrase)
    except (VerificationError, InvalidHashError):
        return False

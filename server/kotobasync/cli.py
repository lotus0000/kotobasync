import argparse
import getpass
import sys
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from kotobasync.auth.devices import create_device, revoke_device
from kotobasync.auth.passphrase import set_passphrase
from kotobasync.clock import now_ms
from kotobasync.config import Settings
from kotobasync.db.models import Device
from kotobasync.db.session import make_engine


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="kotobasync")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("set-passphrase", help="set the login passphrase (prompts twice)")
    device = sub.add_parser("device", help="manage device tokens")
    dsub = device.add_subparsers(dest="dcmd", required=True)
    add = dsub.add_parser("add", help="create a device and print its token once")
    add.add_argument("name")
    dsub.add_parser("list")
    revoke = dsub.add_parser("revoke")
    revoke.add_argument("device_id")
    return parser


def main(
    argv: list[str] | None = None,
    *,
    session_factory: Callable[[], Session] | None = None,
    getpass_fn: Callable[[str], str] = getpass.getpass,
) -> int:
    args = _parser().parse_args(argv)
    if session_factory is None:
        session_factory = sessionmaker(make_engine(Settings().database_url), expire_on_commit=False)
    now = now_ms()
    with session_factory() as s:
        if args.cmd == "set-passphrase":
            first = getpass_fn("New passphrase: ")
            if getpass_fn("Repeat passphrase: ") != first:
                print("passphrases do not match", file=sys.stderr)
                return 1
            try:
                set_passphrase(s, first)
            except ValueError as exc:
                print(exc, file=sys.stderr)
                return 1
            s.commit()
            print("passphrase set")
            return 0
        if args.dcmd == "add":
            device, token = create_device(s, args.name, now)
            s.commit()
            print(f"device_id={device.id}")
            print(token)
            return 0
        if args.dcmd == "list":
            for d in s.scalars(select(Device).order_by(Device.created_at)):
                print(f"{d.id}\t{d.name}\t{'revoked' if d.revoked_at else 'active'}")
            return 0
        if args.dcmd == "revoke":
            if not revoke_device(s, args.device_id, now):
                print("no such device", file=sys.stderr)
                return 1
            s.commit()
            print("revoked")
            return 0
    return 2

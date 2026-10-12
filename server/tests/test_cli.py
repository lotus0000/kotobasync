from kotobasync.auth.devices import authenticate
from kotobasync.auth.passphrase import verify_passphrase
from kotobasync.cli import main


def test_device_add_list_revoke(app, capsys):
    sf = app.state.session_factory
    assert main(["device", "add", "iPhone"], session_factory=sf) == 0
    out = capsys.readouterr().out.strip().splitlines()
    device_id = out[0].removeprefix("device_id=")
    token = out[-1]

    assert main(["device", "list"], session_factory=sf) == 0
    listing = capsys.readouterr().out
    assert f"{device_id}\tiPhone\tactive" in listing

    assert main(["device", "revoke", device_id], session_factory=sf) == 0
    with sf() as s:
        assert authenticate(s, token, 0) is None
    assert main(["device", "revoke", "nope"], session_factory=sf) == 1


def test_set_passphrase(app):
    sf = app.state.session_factory
    answers = iter(["correct horse battery", "correct horse battery"])
    assert main(["set-passphrase"], session_factory=sf, getpass_fn=lambda _prompt: next(answers)) == 0
    with sf() as s:
        assert verify_passphrase(s, "correct horse battery") is True


def test_set_passphrase_rejects_mismatch_and_short(app):
    sf = app.state.session_factory
    mismatch = iter(["correct horse battery", "something else entirely"])
    assert main(["set-passphrase"], session_factory=sf, getpass_fn=lambda _p: next(mismatch)) == 1
    short = iter(["short", "short"])
    assert main(["set-passphrase"], session_factory=sf, getpass_fn=lambda _p: next(short)) == 1

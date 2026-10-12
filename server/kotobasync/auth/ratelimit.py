import threading


class LoginRateLimiter:
    """Per-IP lockout kept in memory; good enough because the app runs as one process."""

    def __init__(self, max_failures: int = 5, window_ms: int = 15 * 60_000, lockout_ms: int = 15 * 60_000) -> None:
        self._max = max_failures
        self._window = window_ms
        self._lockout = lockout_ms
        self._failures: dict[str, list[int]] = {}
        self._locked_until: dict[str, int] = {}
        self._lock = threading.Lock()

    def is_locked(self, ip: str, now: int) -> bool:
        with self._lock:
            until = self._locked_until.get(ip)
            if until is None:
                return False
            if now >= until:
                del self._locked_until[ip]
                return False
            return True

    def record_failure(self, ip: str, now: int) -> None:
        with self._lock:
            recent = [t for t in self._failures.get(ip, []) if now - t < self._window]
            recent.append(now)
            if len(recent) >= self._max:
                self._locked_until[ip] = now + self._lockout
                self._failures.pop(ip, None)
            else:
                self._failures[ip] = recent

    def reset(self, ip: str) -> None:
        with self._lock:
            self._failures.pop(ip, None)

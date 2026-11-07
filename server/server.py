#!/usr/bin/env python3
"""Private, API-only leaderboard service using the Python standard library.

Luke Steuber. See README.md beside this file for the adapter boundary and limits.
"""

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import secrets
import selectors
import signal
import socket
import sqlite3
import subprocess
import threading
import time
import unicodedata
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parents[1]
IDENTITY_FIELDS = ("game", "mode", "puzzleId", "layoutHash", "rulesVersion", "scoringPolicy")
GAMES = {"hexsweeper", "notan", "akari", "spiral-galaxies", "galaxies", "bridges",
         "slant", "fold", "bending", "tilt", "horologist"}
CATEGORIES = {"unassisted", "assisted", "repeat", "repeat-assisted", "practice"}
DEFAULT_ORIGINS = frozenset({"https://html-classic.itch.zone"})
RETENTION_MS = 90 * 86400 * 1000
MAX_ONLINE_MS = 24 * 3600 * 1000
MAX_VALUE = 2**53 - 1
SUBMISSION_RE = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,127}\Z")
TOKEN_RE = re.compile(r"Bearer ([a-f0-9]{64})\Z")


@dataclass(frozen=True)
class Limits:
    max_body: int = 60 * 1024  # Leaves room for the validator envelope (64 KiB).
    request_timeout: float = 5.0
    validator_timeout: float = 3.0
    max_connections: int = 16
    read_per_minute: int = 120
    write_per_minute: int = 60
    owner_per_minute: int = 40
    global_per_minute: int = 2000
    max_rate_keys: int = 10000
    max_runs: int = 500000
    max_scores: int = 100000


class APIError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class ValidatorUnavailable(Exception):
    pass


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False)


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate key")
            result[key] = value
        return result

    def constant(_):
        raise ValueError("Non-finite number")

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def identity(raw):
    if not isinstance(raw, dict) or set(raw) != set(IDENTITY_FIELDS):
        raise APIError(400, "Invalid identity")
    for key, value in raw.items():
        if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}", value):
            raise APIError(400, "Invalid identity")
    if raw["game"] not in GAMES or not re.fullmatch(r"[a-f0-9]{64}", raw["layoutHash"]):
        raise APIError(400, "Invalid identity")
    return {key: raw[key] for key in IDENTITY_FIELDS}


def submission(raw):
    if not isinstance(raw, str) or not SUBMISSION_RE.fullmatch(raw):
        raise APIError(400, "Invalid submission")
    return raw


def flags(data, names):
    if any(key in data and type(data[key]) is not bool for key in names):
        raise APIError(400, "Flags must be booleans")
    return {key: data.get(key, False) for key in names}


def nickname(raw):
    if not isinstance(raw, str):
        raise APIError(400, "Use a nickname of 1-20 letters, numbers, spaces, dots or dashes")
    name = unicodedata.normalize("NFKC", raw).strip()
    if not re.fullmatch(r"[\w .-]{1,20}", name, flags=re.UNICODE):
        raise APIError(400, "Use a nickname of 1-20 letters, numbers, spaces, dots or dashes")
    return name


def infinite(board):
    return board["game"] == "hexsweeper" and (board["scoringPolicy"] == "cleared-v1" or board["mode"].lower() in {
        "infinite", "infinite-v1", "hexsweeper-infinite", "hexsweeper-infinite-v1"})


def measured(board):
    return board["game"] in {"horologist", "tilt", "fold"} or infinite(board)


def checked_result(result):
    if not isinstance(result, dict) or result.get("valid") is not True:
        raise APIError(400, "Invalid proof")
    value = result.get("value")
    if type(value) is not int or not 0 <= value <= MAX_VALUE:
        raise APIError(400, "Invalid proof")
    flags(result, ("assisted", "repeat", "practice"))
    return result


class NodeValidator:
    """One persistent, serialized child with bounded writes, reads and wall time."""

    def __init__(self, *, module_path=None, timeout=3.0, command=None):
        self.timeout = timeout
        self.command = command or ["node", "--max-old-space-size=64", "--disable-proto=throw",
                                   str(Path(__file__).with_name("validate.mjs"))]
        if module_path is not None:
            self.command = [*self.command, str(Path(module_path).resolve())]
        self.lock = threading.Lock()
        self.process = None
        self.sequence = 0
        self.closed = False

    def _stop(self):
        process, self.process = self.process, None
        if process is None:
            return
        try:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    # A child can exit between poll and killpg (macOS may
                    # report EPERM for the vanished group). Reap it normally;
                    # if still alive, fall back to terminating the direct child.
                    if process.poll() is None:
                        process.kill()
            process.wait(timeout=2)
        finally:
            process.stdin.close()
            process.stdout.close()

    def close(self):
        with self.lock:
            self.closed = True
            self._stop()

    def __call__(self, request):
        deadline = time.monotonic() + self.timeout
        if not self.lock.acquire(timeout=self.timeout):
            raise ValidatorUnavailable("Validator busy")
        try:
            if self.closed:
                raise ValidatorUnavailable("Validator closed")
            if self.process is None or self.process.poll() is not None:
                self._stop()
                # No inherited credentials or private environment in the worker.
                env = {key: os.environ[key] for key in ("PATH", "SYSTEMROOT", "TMPDIR")
                       if key in os.environ}
                self.process = subprocess.Popen(self.command, stdin=subprocess.PIPE,
                                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                                cwd=ROOT, env=env, start_new_session=True, bufsize=0)
                os.set_blocking(self.process.stdin.fileno(), False)
                os.set_blocking(self.process.stdout.fileno(), False)
            self.sequence += 1
            raw = (encode({**request, "id": self.sequence}) + "\n").encode()
            if len(raw) > 65536:
                raise APIError(413, "Proof too large")
            incoming = bytearray()
            offset = 0
            with selectors.DefaultSelector() as selector:
                selector.register(self.process.stdin, selectors.EVENT_WRITE)
                selector.register(self.process.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise ValidatorUnavailable("Validator timeout")
                    events = selector.select(remaining)
                    if not events:
                        raise ValidatorUnavailable("Validator timeout")
                    for key, _ in events:
                        if key.fileobj is self.process.stdin:
                            written = os.write(key.fd, raw[offset:])
                            offset += written
                            if offset == len(raw):
                                selector.unregister(self.process.stdin)
                        else:
                            chunk = os.read(key.fd, 4096)
                            if not chunk:
                                raise ValidatorUnavailable("Validator exited")
                            incoming.extend(chunk)
                            if len(incoming) > 4096:
                                raise ValidatorUnavailable("Validator response too large")
                            if b"\n" in incoming:
                                line, extra = incoming.split(b"\n", 1)
                                if extra or offset != len(raw):
                                    raise ValidatorUnavailable("Validator protocol")
                                result = strict_json(line)
                                if not isinstance(result, dict) or type(result.get("id")) is not int or result["id"] != self.sequence:
                                    raise ValidatorUnavailable("Validator protocol")
                                if result.get("unavailable") is True:
                                    raise ValidatorUnavailable("Validator unavailable")
                                return result
        except APIError:
            raise
        except (OSError, ValueError, RecursionError, subprocess.SubprocessError, ValidatorUnavailable) as exc:
            self._stop()
            raise ValidatorUnavailable("Validation unavailable") from exc
        finally:
            self.lock.release()


SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, start_submission TEXT NOT NULL,
 identity TEXT NOT NULL, started_at INTEGER NOT NULL,
 assisted INTEGER NOT NULL DEFAULT 0, repeat INTEGER NOT NULL DEFAULT 0,
 practice INTEGER NOT NULL DEFAULT 0,
 finish_submission TEXT, fingerprint TEXT, score_id TEXT, category TEXT,
 value INTEGER, elapsed_ms INTEGER,
 UNIQUE(owner, start_submission), UNIQUE(owner, finish_submission)
);
CREATE INDEX IF NOT EXISTS runs_seen ON runs(owner, identity);
CREATE INDEX IF NOT EXISTS runs_age ON runs(started_at);
CREATE TABLE IF NOT EXISTS scores (
 id TEXT PRIMARY KEY, run TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
 owner TEXT NOT NULL, identity TEXT NOT NULL, category TEXT NOT NULL,
 nickname TEXT NOT NULL, value INTEGER NOT NULL, elapsed_ms INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scores_board ON scores(identity, category, owner);
CREATE INDEX IF NOT EXISTS scores_age ON scores(created_at);
"""


class Store:
    def __init__(self, path, limits, clock):
        self.path = Path(path).expanduser().resolve()
        if self.path == ROOT or ROOT in self.path.parents:
            raise ValueError("Database must be outside the source/web root")
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(descriptor)
        os.chmod(self.path, 0o600)
        self.limits, self.clock = limits, clock
        self.lock = threading.RLock()
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(SCHEMA)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=2)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")
            with db:
                yield db
        finally:
            db.close()

    def now(self):
        return int(self.clock() * 1000)

    def prune(self, db, now):
        db.execute("DELETE FROM scores WHERE created_at < ?", (now - RETENTION_MS,))
        db.execute("DELETE FROM runs WHERE started_at < ?", (now - RETENTION_MS,))

    def start(self, owner, data):
        if set(data) - {"submission", "identity", "repeat"}:
            raise APIError(400, "Unexpected run fields")
        key = submission(data.get("submission"))
        board = encode(identity(data.get("identity")))
        repeat = flags(data, ("repeat",))["repeat"]
        now = self.now()
        with self.lock, self.connect() as db:
            self.prune(db, now)
            row = db.execute("SELECT * FROM runs WHERE owner=? AND start_submission=?", (owner, key)).fetchone()
            if row:
                if row["identity"] != board:
                    raise APIError(409, "Submission already used")
                if repeat:
                    if row["finish_submission"] is not None and not row["repeat"]:
                        raise APIError(409, "Run already finished")
                    db.execute("UPDATE runs SET repeat=1 WHERE id=?", (row["id"],))
                return 200, {"run": row["id"], "startedAt": row["started_at"]}
            if db.execute("SELECT COUNT(*) FROM runs").fetchone()[0] >= self.limits.max_runs:
                raise APIError(503, "Run capacity reached")
            seen = db.execute("SELECT 1 FROM runs WHERE owner=? AND identity=? LIMIT 1", (owner, board)).fetchone()
            run = secrets.token_hex(16)
            db.execute("INSERT INTO runs(id,owner,start_submission,identity,started_at,repeat) VALUES(?,?,?,?,?,?)",
                       (run, owner, key, board, now, int(repeat or bool(seen))))
            return 201, {"run": run, "startedAt": now}

    @staticmethod
    def owned(db, run, owner):
        row = db.execute("SELECT * FROM runs WHERE id=?", (run,)).fetchone()
        if row is None or not hmac.compare_digest(row["owner"], owner):
            raise APIError(404, "Not found")
        return row

    @staticmethod
    def response(db, row):
        return {"score": {"id": row["score_id"], "run": row["id"],
                          "identity": json.loads(row["identity"]), "category": row["category"],
                          "value": row["value"], "elapsedMs": row["elapsed_ms"]},
                "ranked": db.execute("SELECT 1 FROM scores WHERE id=?", (row["score_id"],)).fetchone() is not None}

    def finish(self, owner, run, data, validator):
        if set(data) - {"submission", "proof", "assisted", "repeat", "practice", "publish", "nickname"}:
            raise APIError(400, "Unexpected finish fields")
        key = submission(data.get("submission"))
        state = flags(data, ("assisted", "repeat", "practice", "publish"))
        name = nickname(data.get("nickname")) if state["publish"] else None
        if not isinstance(data.get("proof"), (dict, list)):
            raise APIError(400, "Invalid proof")
        fingerprint = hashlib.sha256(encode(data).encode()).hexdigest()
        now = self.now()
        with self.lock, self.connect() as db:
            self.prune(db, now)
            row = self.owned(db, run, owner)
            if row["finish_submission"] is not None:
                if row["finish_submission"] != key or row["fingerprint"] != fingerprint:
                    raise APIError(409, "Run already finished")
                return self.response(db, row)
            conflict = db.execute("SELECT 1 FROM runs WHERE owner=? AND finish_submission=?", (owner, key)).fetchone()
            if conflict:
                raise APIError(409, "Submission already used")
            elapsed = max(0, now - row["started_at"])
            state["practice"] |= elapsed > MAX_ONLINE_MS or now < row["started_at"]
            # Commit disclosures before validation, so an invalid proof/timeout
            # followed by a retry cannot remove a hint, restart or interruption.
            for flag in ("assisted", "repeat", "practice"):
                state[flag] |= bool(row[flag])
            db.execute("UPDATE runs SET assisted=?,repeat=?,practice=? WHERE id=?",
                       (state["assisted"], state["repeat"], state["practice"], run))
            board = json.loads(row["identity"])
            started = row["started_at"]
        result = checked_result(validator({"identity": board, "proof": data["proof"],
                                           "startedAt": started, "elapsedMs": elapsed,
                                           **{flag: state[flag] for flag in ("assisted", "repeat", "practice")}}))
        with self.lock, self.connect() as db:
            self.prune(db, self.now())
            row = self.owned(db, run, owner)
            if row["finish_submission"] is not None:
                if row["finish_submission"] != key or row["fingerprint"] != fingerprint:
                    raise APIError(409, "Run already finished")
                return self.response(db, row)
            if db.execute("SELECT 1 FROM runs WHERE owner=? AND finish_submission=?", (owner, key)).fetchone():
                raise APIError(409, "Submission already used")
            for flag in ("assisted", "repeat", "practice"):
                state[flag] |= bool(row[flag]) or result.get(flag, False)
            category = ("practice" if state["practice"] else
                        "repeat-assisted" if state["repeat"] and state["assisted"] else
                        "repeat" if state["repeat"] else "assisted" if state["assisted"] else "unassisted")
            public = state["publish"] and category != "practice"
            if public and db.execute("SELECT COUNT(*) FROM scores").fetchone()[0] >= self.limits.max_scores:
                # Validated replay disclosures must survive a transient capacity
                # failure too. Commit only these flags, leaving finish retryable.
                db.execute("UPDATE runs SET assisted=?,repeat=?,practice=? WHERE id=?",
                           (state["assisted"], state["repeat"], state["practice"], run))
                db.commit()
                raise APIError(503, "Score capacity reached")
            score = secrets.token_hex(16)
            value = result["value"] if measured(board) else elapsed
            db.execute("UPDATE runs SET finish_submission=?,fingerprint=?,score_id=?,category=?,value=?,elapsed_ms=?,assisted=?,repeat=?,practice=? WHERE id=?",
                       (key, fingerprint, score, category, value, elapsed, state["assisted"], state["repeat"], state["practice"], run))
            if public:
                db.execute("INSERT INTO scores VALUES(?,?,?,?,?,?,?,?,?)",
                           (score, run, owner, row["identity"], category, name, value, elapsed, now))
            return self.response(db, self.owned(db, run, owner))

    def board(self, query):
        if set(query) != {*IDENTITY_FIELDS, "category"} or any(len(values) != 1 for values in query.values()):
            raise APIError(400, "Invalid board query")
        board = identity({key: query[key][0] for key in IDENTITY_FIELDS})
        category = query["category"][0]
        if category not in CATEGORIES:
            raise APIError(400, "Invalid category")
        if category == "practice":
            return {"entries": [], "category": category}
        order = "value DESC, elapsed_ms ASC, id ASC" if infinite(board) else "value ASC, elapsed_ms ASC, id ASC"
        with self.lock, self.connect() as db:
            self.prune(db, self.now())
            rows = db.execute(f"""SELECT id,nickname,value,elapsed_ms FROM (
                SELECT *,ROW_NUMBER() OVER(PARTITION BY owner ORDER BY {order}) AS best
                FROM scores WHERE identity=? AND category=?
                ) WHERE best=1 ORDER BY {order} LIMIT 50""", (encode(board), category)).fetchall()
        entries, last, rank = [], None, 0
        for index, row in enumerate(rows, 1):
            measure = (row["value"], row["elapsed_ms"])
            if measure != last:
                rank, last = index, measure
            entries.append({"id": row["id"], "rank": rank, "nickname": row["nickname"],
                            "value": row["value"], "elapsedMs": row["elapsed_ms"]})
        return {"entries": entries, "category": category}

    def remove(self, owner, score):
        with self.lock, self.connect() as db:
            self.prune(db, self.now())
            row = db.execute("SELECT owner FROM scores WHERE id=?", (score,)).fetchone()
            if row is None or not hmac.compare_digest(row["owner"], owner):
                raise APIError(404, "Not found")
            db.execute("DELETE FROM scores WHERE id=?", (score,))
        return {"removed": True}


class RateLimiter:
    def __init__(self, limits):
        self.limits, self.buckets = limits, {}
        self.lock = threading.Lock()
        self.minute = -1

    def allow(self, key, limit):
        minute = int(time.monotonic() // 60)
        with self.lock:
            if minute != self.minute:
                self.buckets.clear()
                self.minute = minute
            if key not in self.buckets and len(self.buckets) >= self.limits.max_rate_keys:
                return False
            count = self.buckets.get(key, 0) + 1
            self.buckets[key] = count
            return count <= limit


def configured_origins(origins):
    if origins is None:
        return DEFAULT_ORIGINS
    if isinstance(origins, str):
        origins = origins.split(",")
    allowed = set()
    for origin in origins:
        parts = urlsplit(origin)
        if (parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or
                parts.password or parts.path or parts.query or parts.fragment or
                origin != f"{parts.scheme}://{parts.netloc}" or "*" in origin or
                any(ord(c) <= 32 or ord(c) >= 127 for c in origin)):
            raise ValueError("Configure exact HTTP(S) origins without paths or wildcards")
        # Also check malformed ports before the listener is opened.
        parts.port
        allowed.add(origin)
    if not allowed:
        raise ValueError("Configure at least one exact origin")
    return frozenset(allowed)


class ScoreServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def process_request(self, request, address):
        request.settimeout(self.limits.request_timeout)
        if not self.slots.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    def handle_error(self, request, address):
        pass  # No raw requests, bearer tokens, proofs or client addresses in logs.

    def server_close(self):
        super().server_close()
        if self.owns_validator:
            self.validator.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "Minimal/1"
    sys_version = ""

    def setup(self):
        super().setup()
        self.read_deadline = time.monotonic() + self.server.limits.request_timeout
        # A total read deadline also bounds slowly trickled HTTP headers. Shut
        # down only reading so a partial body can still receive an error reply.
        self.read_timer = threading.Timer(self.server.limits.request_timeout, self.expire_read)
        self.read_timer.daemon = True
        self.read_timer.start()

    def expire_read(self):
        try:
            self.connection.shutdown(socket.SHUT_RD)
        except OSError:
            pass

    def finish(self):
        self.read_timer.cancel()
        super().finish()

    def log_message(self, *args):
        pass

    def reply(self, status, data=None, preflight=False):
        raw = b"" if data is None else encode(data).encode()
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.send_header("Vary", "Origin")
        origin = getattr(self, "headers", {}).get("Origin")
        if origin in self.server.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
        if status == 429:
            self.send_header("Retry-After", "60")
        if preflight:
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()
        if getattr(self, "command", None) != "HEAD":
            self.wfile.write(raw)

    def send_error(self, code, message=None, explain=None):
        self.reply(code, {"error": "Request rejected"})

    def owner(self):
        values = self.headers.get_all("Authorization", [])
        match = TOKEN_RE.fullmatch(values[0]) if len(values) == 1 else None
        if match is None:
            raise APIError(401, "A 32-byte hex bearer token is required")
        owner = hashlib.sha256(match[1].encode()).hexdigest()
        if not self.server.rates.allow(("owner", owner), self.server.limits.owner_per_minute):
            raise APIError(429, "Rate limit reached")
        return owner

    def body(self, optional=False):
        if self.headers.get_all("Transfer-Encoding") or self.headers.get_all("Content-Encoding"):
            raise APIError(400, "Unsupported body encoding")
        lengths = self.headers.get_all("Content-Length", [])
        if not lengths and optional:
            return {}
        if not lengths:
            raise APIError(411, "Content-Length required")
        if len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,10}", lengths[0]):
            raise APIError(400, "Invalid Content-Length")
        length = int(lengths[0])
        if length > self.server.limits.max_body:
            raise APIError(413, "Request too large")
        if length == 0 and optional:
            return {}
        content_types = self.headers.get_all("Content-Type", [])
        if len(content_types) != 1 or content_types[0].split(";", 1)[0].strip().lower() != "application/json":
            raise APIError(415, "Use application/json")
        raw = bytearray()
        while len(raw) < length:
            remaining = self.read_deadline - time.monotonic()
            if remaining <= 0:
                raise APIError(408, "Request timeout")
            self.connection.settimeout(remaining)
            chunk = self.rfile.read1(length - len(raw))
            if not chunk:
                raise APIError(408 if time.monotonic() >= self.read_deadline else 400,
                               "Incomplete body")
            raw.extend(chunk)
        try:
            data = strict_json(raw.decode("utf-8"))
            # Enforce nesting/encoding limits before dispatch or fingerprinting.
            if len(encode(data)) > self.server.limits.max_body:
                raise APIError(413, "Request too large")
        except (ValueError, UnicodeError, RecursionError, OverflowError):
            raise APIError(400, "Invalid JSON") from None
        if not isinstance(data, dict):
            raise APIError(400, "Use a JSON object")
        return data

    def dispatch(self):
        try:
            if time.monotonic() >= self.read_deadline:
                raise APIError(408, "Request timeout")
            origins = self.headers.get_all("Origin", [])
            if len(origins) > 1 or (origins and origins[0] not in self.server.origins):
                raise APIError(403, "Origin rejected")
            if len(self.path) > 2048:
                raise APIError(414, "URI too long")
            url = urlsplit(self.path)
            if url.scheme or url.netloc or url.fragment:
                raise APIError(400, "Invalid request target")
            path, method = url.path, self.command
            mutation = method in {"POST", "DELETE"}
            budget = self.server.limits.write_per_minute if mutation else self.server.limits.read_per_minute
            if (not self.server.rates.allow(("global",), self.server.limits.global_per_minute) or
                    not self.server.rates.allow(("peer", self.client_address[0], mutation), budget)):
                raise APIError(429, "Rate limit reached")
            finish = re.fullmatch(r"/api/v1/runs/([a-f0-9]{32})/finish", path)
            remove = re.fullmatch(r"/api/v1/scores/([a-f0-9]{32})", path)
            known = path in {"/api/v1/health", "/api/v1/runs", "/api/v1/boards"} or finish or remove
            if not known:
                raise APIError(404, "Not found")
            if url.query and path != "/api/v1/boards":
                raise APIError(400, "Unexpected query")
            if method == "OPTIONS":
                requested = self.headers.get("Access-Control-Request-Method", "")
                expected = "POST" if finish or path == "/api/v1/runs" else "DELETE" if remove else "GET"
                requested_headers = {s.strip().lower() for s in self.headers.get("Access-Control-Request-Headers", "").split(",") if s.strip()}
                if not origins or requested != expected or requested_headers - {"authorization", "content-type"}:
                    raise APIError(403, "Preflight rejected")
                return self.reply(204, preflight=True)
            if method == "GET" and path == "/api/v1/health":
                with self.server.store.connect() as db:
                    self.server.store.prune(db, self.server.store.now())
                    db.execute("SELECT 1")
                return self.reply(200, {"ok": True})
            if method == "GET" and path == "/api/v1/boards":
                try:
                    query = parse_qs(url.query, keep_blank_values=True, strict_parsing=True, max_num_fields=7)
                except ValueError:
                    raise APIError(400, "Invalid board query") from None
                return self.reply(200, self.server.store.board(query))
            if method == "POST" and path == "/api/v1/runs":
                owner = self.owner()
                status, result = self.server.store.start(owner, self.body())
                return self.reply(status, result)
            if method == "POST" and finish:
                owner = self.owner()
                result = self.server.store.finish(owner, finish[1], self.body(), self.server.validator)
                return self.reply(200, result)
            if method == "DELETE" and remove:
                owner = self.owner()
                if self.body(optional=True):
                    raise APIError(400, "Unexpected delete fields")
                return self.reply(200, self.server.store.remove(owner, remove[1]))
            raise APIError(405, "Method not allowed")
        except APIError as exc:
            self.reply(exc.status, {"error": exc.message})
        except ValidatorUnavailable:
            self.reply(503, {"error": "Validation unavailable; retry the same submission"})
        except (TimeoutError, socket.timeout):
            self.reply(408, {"error": "Request timeout"})
        except sqlite3.Error:
            self.reply(503, {"error": "Storage unavailable; retry the same submission"})
        except (ValueError, RecursionError, OverflowError):
            self.reply(400, {"error": "Invalid request"})

    do_GET = do_POST = do_DELETE = do_OPTIONS = do_HEAD = do_PUT = do_PATCH = dispatch


def create_server(bind="127.0.0.1", port=5059, db_path=None, *, origins=None,
                  validator=None, limits=None, clock=time.time):
    """Return a bound server; caller owns serve_forever/shutdown/server_close.

    A test validator is a callable(request)->{valid: bool, value: integer, ...}.
    Production always uses NodeValidator unless a callable is explicitly injected.
    """
    if bind == "localhost":
        bind = "127.0.0.1"
    if not ipaddress.ip_address(bind).is_loopback:
        raise ValueError("The score service must bind to loopback")
    if db_path is None:
        raise ValueError("An explicit database path outside the source/web root is required")
    limits = limits or Limits()
    if any(not isinstance(value, (int, float)) or isinstance(value, bool) or
           not math.isfinite(value) or value <= 0 for value in vars(limits).values()):
        raise ValueError("Limits must be positive and finite")
    if any(type(value) is not int for key, value in vars(limits).items()
           if key not in {"request_timeout", "validator_timeout"}):
        raise ValueError("Count and size limits must be integers")
    allowed = configured_origins(origins)
    store = Store(db_path, limits, clock)
    server_type = ScoreServer
    if ":" in bind:
        class IPv6ScoreServer(ScoreServer):
            address_family = socket.AF_INET6
        server_type = IPv6ScoreServer
    # Initialize metadata before binding, so bind-failure cleanup is safe.
    instance = server_type.__new__(server_type)
    instance.owns_validator = validator is None
    instance.validator = validator if validator is not None else NodeValidator(timeout=limits.validator_timeout)
    instance.limits, instance.origins, instance.store = limits, allowed, store
    instance.slots = threading.BoundedSemaphore(limits.max_connections)
    instance.rates = RateLimiter(limits)
    server_type.__init__(instance, (bind, port), Handler)
    return instance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5059)
    parser.add_argument("--bind", default="127.0.0.1", help="Loopback address only")
    parser.add_argument("--db", required=True, help="SQLite path outside the source/web root")
    parser.add_argument("--origins", default=",".join(sorted(DEFAULT_ORIGINS)),
                        help="Comma-separated exact HTTP(S) origins; replaces defaults")
    args = parser.parse_args()
    try:
        server = create_server(args.bind, args.port, args.db, origins=args.origins)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(f"Minimal scores on {server.server_address[0]}:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

"""Isolated service contract and subprocess tests. Luke Steuber.

All databases and adapter fixtures live in disposable directories, never the
checkout. No original/public leaderboard is contacted.
"""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import hashlib
import http.client
import json
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from urllib.parse import urlencode

from server import Limits, NodeValidator, ValidatorUnavailable, create_server
from server.server import APIError, DEFAULT_ORIGINS, MAX_ONLINE_MS, RETENTION_MS, ROOT


TOKEN = secrets.token_hex(32)
ORIGIN = "http://127.0.0.1:4173"
BOARD = {"game": "tilt", "mode": "campaign", "puzzleId": "1",
         "layoutHash": "a" * 64, "rulesVersion": "v1", "scoringPolicy": "native-v1"}


class Clock:
    def __init__(self):
        self.value = 1800000000.0

    def __call__(self):
        return self.value

    def advance(self, milliseconds):
        self.value += milliseconds / 1000


def fixture_validator(request):
    proof = request["proof"]
    return {"valid": proof.get("ok", True), "value": proof.get("value", 7),
            **{flag: proof[flag] for flag in ("assisted", "repeat", "practice") if flag in proof}}


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="minimal-service-")
        self.addCleanup(self.temp.cleanup)
        self.clock = Clock()
        self.db = Path(self.temp.name) / "private" / "scores.sqlite3"
        limits = replace(Limits(), read_per_minute=5000, write_per_minute=5000,
                         owner_per_minute=5000, global_per_minute=10000)
        self.server = create_server("127.0.0.1", 0, self.db, origins={ORIGIN},
                                    clock=self.clock, validator=fixture_validator, limits=limits)
        self.thread = threading.Thread(target=self.server.serve_forever,
                                       kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, method, path, data=None, *, token=TOKEN, origin=ORIGIN,
                raw=None, headers=None):
        fields = {}
        if token is not None:
            fields["Authorization"] = "Bearer " + token
        if origin is not None:
            fields["Origin"] = origin
        if data is not None:
            raw = json.dumps(data).encode()
            fields["Content-Type"] = "application/json"
        if headers:
            fields.update(headers)
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            connection.request(method, path, body=raw, headers=fields)
            response = connection.getresponse()
            payload = response.read()
            return response.status, json.loads(payload) if payload else None, dict(response.getheaders())
        finally:
            connection.close()

    def start(self, board=None, *, token=TOKEN, repeat=False, key=None):
        status, response, _ = self.request("POST", "/api/v1/runs", {
            "submission": key or secrets.token_hex(16), "identity": board or BOARD,
            "repeat": repeat}, token=token)
        self.assertIn(status, (200, 201), response)
        self.assertEqual(set(response), {"run", "startedAt"})
        return response["run"]

    def finish_data(self, **changes):
        return {"submission": secrets.token_hex(16), "proof": {"value": 7},
                "assisted": False, "repeat": False, "practice": False,
                "publish": True, "nickname": "Luke", **changes}

    def finish(self, run, data=None, *, token=TOKEN):
        return self.request("POST", f"/api/v1/runs/{run}/finish",
                            data if data is not None else self.finish_data(), token=token)

    def board(self, board=None, category="unassisted"):
        status, response, _ = self.request("GET", "/api/v1/boards?" + urlencode({
            **(board or BOARD), "category": category}), token=None)
        self.assertEqual(status, 200, response)
        return response["entries"]

    def publish(self, *, board=None, token=None, value=7, elapsed=1000, category="unassisted"):
        token = token or secrets.token_hex(32)
        run = self.start(board, token=token, repeat=category.startswith("repeat"))
        self.clock.advance(elapsed)
        status, response, _ = self.finish(run, self.finish_data(
            proof={"value": value}, assisted="assisted" in category and category != "unassisted"), token=token)
        self.assertEqual(status, 200, response)
        self.assertTrue(response["ranked"])
        return response

    def test_health_public_and_no_static_files(self):
        status, data, headers = self.request("GET", "/api/v1/health", token=None, origin=None)
        self.assertEqual((status, data), (200, {"ok": True}))
        self.assertEqual(headers["Cache-Control"], "no-store")
        for path in ("/", "/server/server.py", "/docs/implementation.md", "/../README.md", "/%2e%2e/README.md"):
            self.assertEqual(self.request("GET", path)[0], 404)
        self.assertEqual(self.request("HEAD", "/api/v1/health")[0], 405)

    def test_start_is_private_and_idempotent(self):
        key = secrets.token_hex(16)
        run = self.start(key=key)
        self.clock.advance(6000)
        self.assertEqual(self.start(key=key), run)
        self.assertEqual(self.board(), [])
        status, data, _ = self.finish(run)
        self.assertEqual(status, 200)
        self.assertEqual(data["score"]["elapsedMs"], 6000)
        self.assertEqual(data["score"]["category"], "unassisted")

    def test_finish_contract_and_owner_privacy(self):
        run = self.start()
        proof = {"value": 9, "secret": "unique-proof-not-for-storage"}
        self.clock.advance(4000)
        status, response, _ = self.finish(run, self.finish_data(proof=proof))
        self.assertEqual(status, 200)
        self.assertEqual(set(response), {"score", "ranked"})
        self.assertEqual(set(response["score"]), {"id", "run", "identity", "category", "value", "elapsedMs"})
        entries = self.board()
        self.assertEqual(set(entries[0]), {"id", "rank", "nickname", "value", "elapsedMs"})
        self.assertNotIn(run, json.dumps(entries))
        with self.server.store.connect() as db:
            owner = db.execute("SELECT owner FROM runs").fetchone()[0]
            dump = "\n".join(db.iterdump())
        self.assertEqual(owner, hashlib.sha256(TOKEN.encode()).hexdigest())
        self.assertNotIn(TOKEN, dump)
        self.assertNotIn(proof["secret"], dump)
        self.assertEqual(self.db.stat().st_mode & 0o777, 0o600)

    def test_finish_retry_and_conflicting_replay(self):
        run = self.start()
        data = self.finish_data()
        first = self.finish(run, data)
        self.clock.advance(20000)
        self.assertEqual(self.finish(run, dict(reversed(list(data.items()))))[:2], first[:2])
        self.assertEqual(self.finish(run, {**data, "proof": {"value": 2}})[0], 409)
        self.assertEqual(self.finish(run, {**data, "submission": "another"})[0], 409)
        second = self.start()
        self.assertEqual(self.finish(second, data)[0], 409)
        self.assertEqual(len(self.board()), 1)

    def test_concurrent_identical_start_and_finish(self):
        key = secrets.token_hex(16)
        with ThreadPoolExecutor(max_workers=6) as pool:
            runs = list(pool.map(lambda _: self.start(key=key), range(6)))
        self.assertEqual(len(set(runs)), 1)
        data = self.finish_data()
        with ThreadPoolExecutor(max_workers=6) as pool:
            responses = list(pool.map(lambda _: self.finish(runs[0], data), range(6)))
        self.assertTrue(all(r[:2] == responses[0][:2] for r in responses))
        self.assertEqual(responses[0][0], 200)
        with self.server.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM scores").fetchone()[0], 1)

    def test_wrong_owner_and_missing_or_malformed_bearer(self):
        run = self.start()
        self.assertEqual(self.finish(run, token=secrets.token_hex(32))[0], 404)
        for token in (None, "x" * 64, "a" * 63, "a" * 65, "A" * 64):
            self.assertEqual(self.finish(run, token=token)[0], 401)
        self.assertEqual(self.finish("0" * 32)[0], 404)

    def test_publication_requires_explicit_boolean_and_valid_name(self):
        for changes in ({"publish": False}, {"publish": False, "nickname": ""}):
            status, data, _ = self.finish(self.start(), self.finish_data(**changes))
            self.assertEqual(status, 200)
            self.assertFalse(data["ranked"])
        data = self.finish_data()
        del data["publish"]
        self.assertFalse(self.finish(self.start(), data)[1]["ranked"])
        for invalid in ("", " ", "x" * 21, "<script>", "Luke\nSteuber", 7, None):
            self.assertEqual(self.finish(self.start(), self.finish_data(nickname=invalid))[0], 400)
        for invalid in (1, "true", None):
            self.assertEqual(self.finish(self.start(), self.finish_data(publish=invalid))[0], 400)
        self.assertEqual(self.board(), [])

    def test_private_finish_cannot_be_promoted(self):
        run = self.start()
        data = self.finish_data(publish=False)
        self.assertEqual(self.finish(run, data)[0], 200)
        self.assertEqual(self.finish(run, {**data, "publish": True})[0], 409)
        self.assertEqual(self.board(), [])

    def test_practice_interruptions_and_old_runs_never_rank(self):
        run = self.start()
        status, data, _ = self.finish(run, self.finish_data(practice=True))
        self.assertEqual(status, 200)
        self.assertEqual(data["score"]["category"], "practice")
        self.assertFalse(data["ranked"])
        run = self.start()
        self.clock.advance(MAX_ONLINE_MS + 1)
        status, data, _ = self.finish(run)
        self.assertEqual(status, 200)
        self.assertFalse(data["ranked"])
        run = self.start()
        self.clock.advance(-1000)
        self.assertFalse(self.finish(run)[1]["ranked"])
        self.assertEqual(self.board(category="practice"), [])

    def test_strict_fields_prevent_historical_or_client_elapsed_uploads(self):
        for field in ("elapsedMs", "startedAt", "historical", "midattempt", "practice"):
            status = self.request("POST", "/api/v1/runs", {
                "submission": secrets.token_hex(16), "identity": BOARD, field: True})[0]
            self.assertEqual(status, 400)
        self.assertEqual(self.finish(self.start(), self.finish_data(elapsedMs=1))[0], 400)

    def test_assistance_repeat_and_practice_stick_after_failed_proof(self):
        run = self.start()
        self.assertEqual(self.finish(run, self.finish_data(
            proof={"ok": False}, assisted=True, repeat=True))[0], 400)
        status, result, _ = self.finish(run)
        self.assertEqual(status, 200)
        self.assertEqual(result["score"]["category"], "repeat-assisted")
        run = self.start()
        self.assertEqual(self.finish(run, self.finish_data(proof={"ok": False}, practice=True))[0], 400)
        self.assertFalse(self.finish(run)[1]["ranked"])

    def test_repeat_detected_server_side_and_retry_does_not_clear_it(self):
        key = secrets.token_hex(16)
        run = self.start(key=key)
        self.start(key=key, repeat=True)
        self.start(key=key, repeat=False)
        self.assertEqual(self.finish(run)[1]["score"]["category"], "repeat")
        run = self.start()
        self.assertEqual(self.finish(run)[1]["score"]["category"], "repeat")
        fresh = self.start(token=secrets.token_hex(32))
        self.assertEqual(self.finish(fresh)[0], 404)

    def test_adapter_can_only_upgrade_flags(self):
        for flag, category in (("assisted", "assisted"), ("repeat", "repeat"), ("practice", "practice")):
            token = secrets.token_hex(32)
            run = self.start(token=token)
            result = self.finish(run, self.finish_data(proof={"value": 1, flag: True}), token=token)[1]
            self.assertEqual(result["score"]["category"], category)
            self.assertEqual(result["ranked"], flag != "practice")
        run = self.start(repeat=True)
        result = self.finish(run, self.finish_data(assisted=True,
                             proof={"value": 1, "assisted": False, "repeat": False}))[1]
        self.assertEqual(result["score"]["category"], "repeat-assisted")

    def test_timed_value_uses_only_server_wall_clock(self):
        board = {**BOARD, "game": "bridges"}
        run = self.start(board)
        self.clock.advance(3210)
        status, result, _ = self.finish(run, self.finish_data(proof={"value": 1, "elapsedMs": -999}))
        self.assertEqual(status, 200)
        self.assertEqual((result["score"]["value"], result["score"]["elapsedMs"]), (3210, 3210))

    def test_native_ascending_and_infinite_descending_order_and_ties(self):
        for game in ("horologist", "tilt", "fold", "hexsweeper"):
            board = {**BOARD, "game": game, "mode": "infinite" if game == "hexsweeper" else "campaign"}
            for value, elapsed in ((7, 1000), (5, 2000), (5, 2000), (9, 4000)):
                self.publish(board=board, value=value, elapsed=elapsed)
            entries = self.board(board)
            self.assertEqual([row["value"] for row in entries], [9, 7, 5, 5] if game == "hexsweeper" else [5, 5, 7, 9])
            self.assertEqual([row["rank"] for row in entries], [1, 2, 3, 3] if game == "hexsweeper" else [1, 1, 3, 4])

    def test_per_owner_best_and_elapsed_tiebreak(self):
        owner = secrets.token_hex(32)
        self.publish(token=owner, value=10, elapsed=4000, category="repeat")
        best = self.publish(token=owner, value=5, elapsed=3000, category="repeat")
        self.publish(value=5, elapsed=2000, category="repeat")
        self.publish(value=5, elapsed=4000, category="repeat")
        entries = self.board(category="repeat")
        self.assertEqual(len(entries), 3)
        self.assertEqual([row["elapsedMs"] for row in entries], [2000, 3000, 4000])
        self.assertEqual(entries[1]["id"], best["score"]["id"])

    def test_each_identity_field_and_category_partition_board(self):
        self.publish()
        alternatives = {"game": "fold", "mode": "other", "puzzleId": "2", "layoutHash": "b" * 64,
                        "rulesVersion": "v2", "scoringPolicy": "native-v2"}
        for key, value in alternatives.items():
            changed = {**BOARD, key: value}
            self.assertEqual(self.board(changed), [])
            self.publish(board=changed)
            self.assertEqual(len(self.board(changed)), 1)
        self.assertEqual(len(self.board()), 1)
        self.assertEqual(self.board(category="assisted"), [])

    def test_start_id_cannot_change_identity(self):
        key = secrets.token_hex(16)
        self.start(key=key)
        status = self.request("POST", "/api/v1/runs", {"submission": key,
            "identity": {**BOARD, "mode": "other"}})[0]
        self.assertEqual(status, 409)

    def test_start_retry_cannot_rewrite_completed_category(self):
        run = self.start(key="one")
        self.finish(run)
        status = self.request("POST", "/api/v1/runs", {
            "submission": "one", "identity": BOARD, "repeat": True})[0]
        self.assertEqual(status, 409)
        self.assertEqual(len(self.board()), 1)

    def test_delete_owner_only_and_retries_cannot_resurrect(self):
        run = self.start()
        data = self.finish_data()
        score = self.finish(run, data)[1]["score"]["id"]
        path = f"/api/v1/scores/{score}"
        self.assertEqual(self.request("DELETE", path, token=secrets.token_hex(32))[0], 404)
        self.assertEqual(self.request("DELETE", path)[:2], (200, {"removed": True}))
        self.assertEqual(self.board(), [])
        self.assertFalse(self.finish(run, data)[1]["ranked"])
        self.assertEqual(self.request("DELETE", path)[0], 404)

    def test_ninety_day_retention_and_expired_run_rejection(self):
        run = self.start()
        self.finish(run)
        self.clock.advance(RETENTION_MS + 1)
        self.assertEqual(self.board(), [])
        self.assertEqual(self.finish(run)[0], 404)
        with self.server.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM runs").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT count(*) FROM scores").fetchone()[0], 0)

    def test_health_prunes_expired_data(self):
        self.publish()
        self.clock.advance(RETENTION_MS + 1)
        self.assertEqual(self.request("GET", "/api/v1/health", token=None)[0], 200)
        with self.server.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM scores").fetchone()[0], 0)

    def test_cors_exact_origins_and_preflight(self):
        status, _, headers = self.request("GET", "/api/v1/health", token=None)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(headers["Vary"], "Origin")
        for origin in ("null", "https://example.org", ORIGIN + ".evil", ORIGIN + "/", "https://html-classic.itch.zone"):
            status, _, headers = self.request("GET", "/api/v1/health", origin=origin)
            self.assertEqual(status, 403)
            self.assertNotIn("Access-Control-Allow-Origin", headers)
        status, _, headers = self.request("OPTIONS", "/api/v1/runs", token=None, headers={
            "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type"})
        self.assertEqual(status, 204)
        self.assertIn("DELETE", headers["Access-Control-Allow-Methods"])
        for changes in ({"Access-Control-Request-Method": "DELETE"},
                        {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "X-Evil"}):
            self.assertEqual(self.request("OPTIONS", "/api/v1/runs", headers=changes)[0], 403)
        self.assertEqual(self.request("OPTIONS", "/api/v1/runs", origin=None)[0], 403)

    def test_strict_json_and_body_and_target_bounds(self):
        for raw in (b'{}{}', b'[]', b'{"x":NaN}', b'{"x":1,"x":2}', b'\xff', b'{', b'[' * 2000 + b']' * 2000):
            self.assertEqual(self.request("POST", "/api/v1/runs", raw=raw,
                                        headers={"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.request("POST", "/api/v1/runs", raw=b'x' * (self.server.limits.max_body + 1))[0], 413)
        self.assertEqual(self.request("POST", "/api/v1/runs", raw=b'{}')[0], 415)
        self.assertEqual(self.request("POST", "/api/v1/runs", raw=b'{}', headers={"Transfer-Encoding": "chunked"})[0], 400)
        self.assertEqual(self.request("POST", "/api/v1/runs", raw=b'{}', headers={"Content-Length": "-1"})[0], 400)
        self.assertEqual(self.request("GET", "/" + "x" * 2049)[0], 414)
        self.assertEqual(self.request("POST", "/api/v1/runs?unexpected=1", {})[0], 400)

    def test_raw_headers_duplicates_missing_length_and_short_body(self):
        base = b"POST /api/v1/runs HTTP/1.0\r\nAuthorization: Bearer " + TOKEN.encode() + b"\r\nContent-Type: application/json\r\n"
        for suffix, expected in ((b"\r\n", 411),
                                 (b"Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}", 400),
                                 (b"Content-Length: 10\r\n\r\n{}", 400),
                                 (b"Origin: " + ORIGIN.encode() + b"\r\nOrigin: " + ORIGIN.encode() + b"\r\nContent-Length: 2\r\n\r\n{}", 403)):
            with socket.create_connection(self.server.server_address, timeout=2) as connection:
                connection.sendall(base + suffix)
                connection.shutdown(socket.SHUT_WR)
                self.assertIn(f" {expected} ".encode(), connection.recv(4096).split(b"\r\n")[0])

    def test_malformed_http_headers_return_bounded_json_errors(self):
        for payload in (b"GET /api/v1/health HTTP/bad\r\n\r\n",
                        b"GET /api/v1/health HTTP/1.0\r\n" + b"X-Test: x\r\n" * 101 + b"\r\n"):
            with socket.create_connection(self.server.server_address, timeout=2) as connection:
                connection.sendall(payload)
                connection.shutdown(socket.SHUT_WR)
                chunks = []
                while chunk := connection.recv(4096):
                    chunks.append(chunk)
                response = b"".join(chunks)
                self.assertIn(b'{"error":"Request rejected"}', response)
                self.assertLess(len(response), 1024)

    def test_malformed_board_query_and_flags(self):
        for query in ("", "category=practice", urlencode({**BOARD, "category": "bad"}),
                      urlencode({**BOARD, "category": "unassisted"}) + "&mode=other"):
            self.assertEqual(self.request("GET", "/api/v1/boards?" + query)[0], 400)
        for flag in ("assisted", "repeat", "practice"):
            self.assertEqual(self.finish(self.start(), self.finish_data(**{flag: "false"}))[0], 400)
        for invalid in ({**BOARD, "game": "unknown"}, {**BOARD, "layoutHash": "bad"},
                        {**BOARD, "mode": ["campaign"]}, {**BOARD, "extra": "x"}):
            self.assertEqual(self.request("POST", "/api/v1/runs", {"submission": "x", "identity": invalid})[0], 400)

    def test_invalid_validator_values_fail_closed(self):
        for value in (-1, True, 1.5, 2**53, "2", None):
            self.assertEqual(self.finish(self.start(), self.finish_data(proof={"value": value}))[0], 400)
        self.assertEqual(self.board(), [])

    def test_rate_limit_and_forwarded_headers_cannot_bypass(self):
        self.server.limits = replace(self.server.limits, read_per_minute=2)
        self.server.rates.buckets.clear()
        for index in range(2):
            self.assertEqual(self.request("GET", "/api/v1/health", headers={"X-Forwarded-For": f"192.0.2.{index}"})[0], 200)
        status, _, headers = self.request("GET", "/api/v1/health", headers={"X-Score-Client": "another"})
        self.assertEqual(status, 429)
        self.assertEqual(headers["Retry-After"], "60")

    def test_owner_and_global_rate_limits(self):
        self.server.limits = replace(self.server.limits, owner_per_minute=1)
        self.start()
        self.assertEqual(self.request("POST", "/api/v1/runs", {"submission": "next", "identity": BOARD})[0], 429)
        self.server.rates.buckets.clear()
        self.server.limits = replace(self.server.limits, global_per_minute=1)
        self.assertEqual(self.request("GET", "/api/v1/health")[0], 200)
        self.assertEqual(self.request("GET", "/api/v1/health")[0], 429)

    def test_run_and_score_capacity_and_retry(self):
        self.server.store.limits = replace(self.server.limits, max_runs=1, max_scores=1)
        run = self.start(key="one")
        self.assertEqual(self.start(key="one"), run)
        self.assertEqual(self.request("POST", "/api/v1/runs", {"submission": "two", "identity": BOARD})[0], 503)
        self.assertEqual(self.finish(run)[0], 200)
        self.server.store.limits = replace(self.server.limits, max_runs=10, max_scores=1)
        second = self.start()
        data = self.finish_data(proof={"value": 1, "assisted": True})
        self.assertEqual(self.finish(second, data)[0], 503)
        self.server.store.limits = self.server.limits
        status, response, _ = self.finish(second, {**data, "proof": {"value": 1}})
        self.assertEqual(status, 200)
        self.assertEqual(response["score"]["category"], "repeat-assisted")

    def test_body_total_timeout(self):
        self.server.limits = replace(self.server.limits, request_timeout=0.15)
        with socket.create_connection(self.server.server_address, timeout=2) as connection:
            connection.sendall(b"POST /api/v1/runs HTTP/1.0\r\nAuthorization: Bearer " + TOKEN.encode() +
                               b"\r\nContent-Type: application/json\r\nContent-Length: 20\r\n\r\n{")
            started = time.monotonic()
            self.assertIn(b" 408 ", connection.recv(4096).split(b"\r\n")[0])
            self.assertLess(time.monotonic() - started, 1.5)

    def test_slow_headers_have_total_deadline(self):
        self.server.limits = replace(self.server.limits, request_timeout=0.15)
        with socket.create_connection(self.server.server_address, timeout=2) as connection:
            connection.sendall(b"GET /api/v1/health HTTP/1.0\r\nX-Slow: ")
            started = time.monotonic()
            # An incomplete header cannot keep a worker occupied indefinitely.
            response = connection.recv(4096)
            self.assertLess(time.monotonic() - started, 1.5)
            self.assertTrue(response.startswith(b"HTTP/") or response == b"")

    def test_connection_concurrency_is_bounded(self):
        self.server.slots = threading.BoundedSemaphore(1)
        self.server.slots.acquire()
        try:
            self.assertEqual(self.request("GET", "/api/v1/health")[0], 503)
        finally:
            self.server.slots.release()
        self.assertEqual(self.request("GET", "/api/v1/health")[0], 200)

    @unittest.skipUnless(shutil.which("node"), "Node is required for HTTP subprocess tests")
    def test_http_real_subprocess_rejection_timeout_and_retry(self):
        path = Path(self.temp.name) / "validators.mjs"
        path.write_text("""export function validateProof(r) {
            if (r.proof.hang) { while(true) {} }
            if (r.identity.mode === 'unknown' || r.proof.invalid) return {valid:false};
            return {valid:true,value:4};
        }""")
        worker = NodeValidator(module_path=path, timeout=0.3)
        self.addCleanup(worker.close)
        self.server.validator = worker
        run = self.start()
        self.assertEqual(self.finish(run, self.finish_data(proof={"invalid": True}))[0], 400)
        self.assertEqual(self.finish(run, self.finish_data(proof={"hang": True}, assisted=True))[0], 503)
        self.assertEqual(self.board(), [])
        data = self.finish_data()
        status, response, _ = self.finish(run, data)
        self.assertEqual(status, 200)
        self.assertEqual(response["score"]["category"], "assisted")
        self.assertEqual(self.finish(run, data)[:2], (status, response))
        unknown = self.start({**BOARD, "mode": "unknown"})
        self.assertEqual(self.finish(unknown)[0], 400)

    def test_cli_supports_port_db_and_origins(self):
        process = subprocess.Popen([sys.executable, "-m", "server", "--port", "0",
                                    "--db", str(Path(self.temp.name) / "cli.sqlite3"),
                                    "--origins", ORIGIN], cwd=ROOT,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            # Bound the startup read without leaving an orphan on failure.
            import selectors
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                self.assertTrue(selector.select(3), "CLI did not start")
            address = process.stdout.readline().strip().rsplit(" ", 1)[1]
            host, port = address.rsplit(":", 1)
            connection = http.client.HTTPConnection(host, int(port), timeout=2)
            try:
                connection.request("GET", "/api/v1/health", headers={"Origin": ORIGIN})
                response = connection.getresponse()
                self.assertEqual((response.status, json.loads(response.read())), (200, {"ok": True}))
                self.assertEqual(response.getheader("Access-Control-Allow-Origin"), ORIGIN)
            finally:
                connection.close()
        finally:
            process.terminate()
            process.communicate(timeout=3)

    def test_factory_rejects_nonloopback_webroot_and_bad_origins(self):
        for kwargs in ({"bind": "0.0.0.0"}, {"db_path": ROOT / "scores.sqlite3"},
                       {"origins": {"null"}}, {"origins": {"https://*.itch.zone"}},
                       {"origins": {"https://example.org/"}}, {"origins": {"https://example.org:bad"}}):
            with self.assertRaises(ValueError):
                create_server(**{"bind": "127.0.0.1", "port": 0, "db_path": self.db, **kwargs})
        self.assertEqual(DEFAULT_ORIGINS, {"https://html-classic.itch.zone"})


@unittest.skipUnless(shutil.which("node"), "Node is required for real subprocess tests")
class ValidatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="minimal-validator-")
        self.addCleanup(self.temp.cleanup)

    def validator(self, source, *, timeout=1.5):
        path = Path(self.temp.name) / (secrets.token_hex(8) + ".mjs")
        path.write_text(source)
        worker = NodeValidator(module_path=path, timeout=timeout)
        self.addCleanup(worker.close)
        return worker

    def request(self, **changes):
        return {"identity": BOARD, "proof": {"value": 7}, "elapsedMs": 1000,
                "startedAt": 1800000000000, "assisted": False, "repeat": False,
                "practice": False, **changes}

    def test_persistent_dispatch_and_fixed_output(self):
        worker = self.validator("export function validateProof(r) { return {valid:true, value:r.proof.value, proof:'private', token:'private'}; }")
        first = worker(self.request())
        process = worker.process
        second = worker(self.request(proof={"value": 2}))
        self.assertIs(worker.process, process)
        self.assertEqual(first["value"], 7)
        self.assertEqual(second["value"], 2)
        self.assertNotIn("proof", first)
        self.assertNotIn("token", first)

    def test_missing_module_and_missing_export_fail_closed(self):
        worker = NodeValidator(module_path=Path(self.temp.name) / "missing.mjs", timeout=1)
        self.addCleanup(worker.close)
        with self.assertRaises(ValidatorUnavailable):
            worker(self.request())
        worker = self.validator("export const wrong = true;")
        with self.assertRaises(ValidatorUnavailable):
            worker(self.request())

    def test_unknown_proof_exception_and_invalid_results_rejected(self):
        for source in ("export function validateProof() { return {valid:false}; }",
                       "export function validateProof() { throw Error('private proof'); }",
                       "export function validateProof() { return {valid:true,value:NaN}; }",
                       "export function validateProof() { return {valid:true,value:true}; }",
                       "export function validateProof() { return {valid:true,value:1,assisted:1}; }"):
            with self.subTest(source=source):
                self.assertFalse(self.validator(source)(self.request())["valid"])

    def test_sync_loop_and_async_hang_are_killed_and_restartable(self):
        for source in ("export function validateProof() { while(true) {} }",
                       "export async function validateProof() { await new Promise(()=>{}); }"):
            worker = self.validator(source, timeout=0.25)
            start = time.monotonic()
            with self.assertRaises(ValidatorUnavailable):
                worker(self.request())
            self.assertLess(time.monotonic() - start, 1.5)
            self.assertIsNone(worker.process)
            # Repair only this private fixture; next call must start a fresh child.
            Path(worker.command[-1]).write_text("export function validateProof(){return {valid:true,value:1};}")
            self.assertTrue(worker(self.request())["valid"])

    def test_no_credentials_in_child(self):
        from unittest.mock import patch
        worker = self.validator("export function validateProof(){return {valid:true,value:('SAMPLE_API_KEY' in process.env || 'NODE_OPTIONS' in process.env) ? 0 : 1};}")
        with patch.dict("os.environ", {"SAMPLE_API_KEY": "private", "NODE_OPTIONS": "--bad-option"}):
            self.assertEqual(worker(self.request())["value"], 1)

    def test_oversize_input_and_stdout_noise_fail_closed(self):
        worker = self.validator("export function validateProof(){console.log('bad protocol');return {valid:true,value:1};}")
        with self.assertRaises(ValidatorUnavailable):
            worker(self.request())
        worker = self.validator("export function validateProof(){return {valid:true,value:1};}")
        with self.assertRaises(APIError):
            worker(self.request(proof={"padding": "x" * 65536}))

    def test_crash_wrong_id_excess_output_and_blocked_write(self):
        for script in ("import sys; sys.exit(1)",
                       "import sys; sys.stdin.readline(); print('{\"id\":999,\"valid\":true,\"value\":1}', flush=True)",
                       "import sys; sys.stdin.readline(); print('x'*5000, flush=True)",
                       "import time; time.sleep(10)"):
            worker = NodeValidator(command=[sys.executable, "-c", script], timeout=0.25)
            self.addCleanup(worker.close)
            with self.assertRaises(ValidatorUnavailable):
                worker(self.request(proof={"padding": "x" * 60000}))
            self.assertIsNone(worker.process)

    def test_dispatcher_rejects_bad_json_and_oversized_line(self):
        for payload in (b"{bad}\n", b"x" * 65537 + b"\n"):
            process = subprocess.run(["node", str(ROOT / "server" / "validate.mjs")],
                                     input=payload, capture_output=True, timeout=2)
            self.assertNotEqual(process.returncode, 0)
            self.assertEqual(process.stdout, b"")


if __name__ == "__main__":
    unittest.main()

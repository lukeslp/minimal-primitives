"""Real HTTP -> SQLite -> Node dispatcher -> pinned engine acceptance. Luke Steuber.

MINIMAL_ROOT selects the code under test, never the acceptance test implementation.
Only loopback ports in the approved fixture ranges are used; all data is temporary.
"""
import copy
from contextlib import closing
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from urllib.parse import urlencode

TEST_ROOT = Path(__file__).resolve().parents[1]
ROOT = Path(os.environ.get('MINIMAL_ROOT', TEST_ROOT)).resolve()
sys.path.insert(0, str(ROOT))
from server.server import create_server, Limits, NodeValidator

ORIGIN = os.environ.get('MINIMAL_REAL_SCORE_ORIGIN', 'https://minimal-real-score.test')
PORTS = (*range(5011, 5020), *range(5051, 5060))


class RealService:
    def __enter__(self):
        self.temp = tempfile.TemporaryDirectory(prefix='minimal-real-scores-')
        self.db = Path(self.temp.name) / 'scores.sqlite3'
        if self.db.is_relative_to(ROOT) or self.db.is_relative_to(TEST_ROOT):
            raise RuntimeError('Disposable database must be outside Git')
        # Rate limiting is covered elsewhere. This fixture still uses the default
        # real validator and wall clock, with enough capacity for the full audit.
        limits = Limits(read_per_minute=10000, write_per_minute=10000,
                        owner_per_minute=10000, global_per_minute=20000)
        for port in PORTS:
            with socket.socket() as probe:
                try:
                    probe.bind(('127.0.0.1', port))
                except OSError:
                    continue
            try:
                self.server = create_server('127.0.0.1', port, self.db,
                                            origins={ORIGIN}, limits=limits)
                break
            except OSError:
                continue  # A concurrent fixture may win the bind race.
        else:
            self.temp.cleanup()
            raise RuntimeError('No free approved fixture port (5010 is excluded)')
        self.port = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()  # Also reaps the actual Node child.
        self.temp.cleanup()

    def request(self, method, path, body=None, secret=None, origin=ORIGIN, headers=None):
        if not path.startswith('/api/v1/'):
            raise ValueError('Fixture requests must remain under the local API')
        h = {'Content-Type': 'application/json'}
        if origin is not None:
            h['Origin'] = origin
        if secret is not None:
            h['Authorization'] = 'Bearer ' + secret
        h.update(headers or {})
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        try:
            conn.request(method, path, None if body is None else json.dumps(body), h)
            response = conn.getresponse()
            raw = response.read()
            return response.status, dict(response.getheaders()), json.loads(raw) if raw else None
        finally:
            conn.close()


class RealScores(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        env = {**os.environ, 'MINIMAL_ROOT': str(ROOT)}
        cls.cases = json.loads(subprocess.check_output(
            ['node', str(TEST_ROOT / 'tests/real-score-fixtures/proofs.cjs')], env=env, text=True))
        cls.fixture = RealService()
        cls.svc = cls.fixture.__enter__()
        cls.addClassCleanup(cls.fixture.__exit__, None, None, None)

    def req(self, method, path, body=None, secret=None, status=200, **kw):
        actual, headers, data = self.svc.request(method, '/api/v1/' + path, body, secret, **kw)
        self.assertEqual(actual, status, f'{method} {path}: {data}')
        if kw.get('origin', ORIGIN) == ORIGIN:
            self.assertEqual(headers.get('Access-Control-Allow-Origin'), ORIGIN)
        return data

    def start(self, case, owner, repeat=False, submission=None):
        return self.req('POST', 'runs', {'submission': submission or secrets.token_hex(12),
                        'identity': case['identity'], 'repeat': repeat}, owner, status=201)

    def body(self, case, **kw):
        return {'submission': secrets.token_hex(12), 'proof': copy.deepcopy(case['proof']),
                'assisted': False, 'repeat': False, 'practice': False,
                'publish': True, 'nickname': 'Fixture Player', **kw}

    def board(self, case, category='unassisted'):
        return self.req('GET', 'boards?' + urlencode({**case['identity'], 'category': category}))['entries']

    def test_01_first_boards_through_real_dispatcher(self):
        self.assertEqual(len(self.cases), 12)
        validator = self.svc.server.validator
        self.assertIsInstance(validator, NodeValidator)
        self.assertEqual(validator.command[-1], str(ROOT / 'server/validate.mjs'))
        node_pid = None
        for case in self.cases:
            with self.subTest(case=case['name']):
                owner = secrets.token_hex(32)
                run = self.start(case, owner)
                receipt = self.req('POST', f"runs/{run['run']}/finish", self.body(case), owner)
                score = receipt['score']
                self.assertTrue(receipt['ranked'])
                self.assertEqual(score['identity'], case['identity'])
                self.assertEqual(score['category'], 'unassisted')
                self.assertEqual(score['value'], score['elapsedMs'] if case['expectedValue'] is None else case['expectedValue'])
                rows = self.board(case)
                self.assertIn(score['id'], [r['id'] for r in rows])
                self.assertTrue(all(set(r) == {'id', 'rank', 'nickname', 'value', 'elapsedMs'} for r in rows))
                self.assertTrue(owner not in json.dumps(receipt) + json.dumps(rows), 'Bearer secret leaked into response')
                self.assertIsNone(validator.process.poll())
                node_pid = node_pid or validator.process.pid
                self.assertEqual(validator.process.pid, node_pid, 'Persistent real dispatcher must survive all pins')
        self.assertGreaterEqual(validator.sequence, 12)
        self.assertEqual(self.svc.db.stat().st_mode & 0o777, 0o600)

    def test_02_reject_identity_and_proof_changes(self):
        for original in self.cases:
            changes = [('layoutHash', '0' * 64), ('rulesVersion', 'unknown'),
                       ('scoringPolicy', 'unknown-v1'), ('puzzleId', 'nonexistent'), ('mode', 'unsupported')]
            for field, value in changes:
                with self.subTest(case=original['name'], field=field):
                    case = copy.deepcopy(original)
                    case['identity'][field] = value
                    owner = secrets.token_hex(32)
                    run = self.start(case, owner)
                    self.req('POST', f"runs/{run['run']}/finish", self.body(case), owner, status=400)
                    self.assertEqual(self.board(case), [])
            with self.subTest(case=original['name'], field='proof'):
                owner = secrets.token_hex(32)
                run = self.start(original, owner)
                body = self.body(original)
                self.req('POST', f"runs/{run['run']}/finish", {**body, 'proof': {}}, owner, status=400)
                # Rejection does not consume the finish submission.
                receipt = self.req('POST', f"runs/{run['run']}/finish", body, owner)
                self.assertTrue(receipt['ranked'])

    def test_03_native_replays_and_hex_number_evidence(self):
        for case in self.cases:
            invalid = []
            p = case['proof']
            if case['name'] == 'tilt':
                wrong = copy.deepcopy(p); wrong['states'][-1]['moves'] += 1
                invalid = [wrong, {'states': [p['states'][0], p['states'][-1]]}]
            elif case['name'] == 'horologist':
                invalid = [{**p, 'hits': 0}, {**p, 'history': []}]
            elif case['name'] == 'fold':
                invalid = [{'path': []}, {'path': [{'axis': 'v', 'k': 999}]}]
            elif case['name'] == 'bending':
                invalid = [{'planets': []}, {'planets': p['planets'] + [p['planets'][0]]},
                           {'planets': [-1] * len(p['planets'])}]
            elif case['name'].startswith('hex-'):
                wrong = copy.deepcopy(p); wrong['final']['counts'][0][1] += 1
                duplicate = copy.deepcopy(p); duplicate['final']['safe'].append(duplicate['final']['safe'][0])
                changed = copy.deepcopy(p); changed['final']['mines'].pop()
                invalid = [wrong, duplicate, changed]
            else:
                invalid = [{'cells': []}, {'cells': [0] * len(p['cells'])}]
            for proof in invalid:
                with self.subTest(case=case['name'], proof='corrupted native state/replay'):
                    owner = secrets.token_hex(32)
                    run = self.start(case, owner)
                    self.req('POST', f"runs/{run['run']}/finish", self.body(case, proof=proof), owner, status=400)

    def test_04_disclosures_stick_after_real_validator_rejection(self):
        case = self.cases[0]
        for flags, category in [({'assisted': True}, 'assisted'), ({'repeat': True}, 'repeat'),
                                ({'assisted': True, 'repeat': True}, 'repeat-assisted'),
                                ({'practice': True}, 'practice')]:
            with self.subTest(category=category):
                owner = secrets.token_hex(32)
                run = self.start(case, owner)
                body = self.body(case)
                self.req('POST', f"runs/{run['run']}/finish", {**body, **flags, 'proof': {}}, owner, status=400)
                receipt = self.req('POST', f"runs/{run['run']}/finish", body, owner)
                self.assertEqual(receipt['score']['category'], category)
                self.assertEqual(receipt['ranked'], category != 'practice')
                self.assertEqual(self.board(case, 'practice'), [])
                if category != 'practice':
                    self.assertIn(receipt['score']['id'], [r['id'] for r in self.board(case, category)])
                next_run = self.start(case, owner)
                repeated = self.req('POST', f"runs/{next_run['run']}/finish", self.body(case), owner)
                self.assertEqual(repeated['score']['category'], 'repeat')

    def test_05_idempotency_withdrawal_and_private_receipts(self):
        case, owner = self.cases[0], secrets.token_hex(32)
        start_id = secrets.token_hex(12)
        run = self.start(case, owner, submission=start_id)
        retry = self.req('POST', 'runs', {'submission': start_id, 'identity': case['identity'], 'repeat': False}, owner)
        self.assertEqual(retry, run)
        changed = {**case['identity'], 'layoutHash': '0' * 64}
        self.req('POST', 'runs', {'submission': start_id, 'identity': changed}, owner, status=409)
        body = self.body(case)
        receipt = self.req('POST', f"runs/{run['run']}/finish", body, owner)
        self.assertEqual(self.req('POST', f"runs/{run['run']}/finish", dict(reversed(list(body.items()))), owner), receipt)
        self.req('POST', f"runs/{run['run']}/finish", {**body, 'assisted': True}, owner, status=409)
        second = self.start(case, owner)
        self.req('POST', f"runs/{second['run']}/finish", body, owner, status=409)
        score_id = receipt['score']['id']
        self.req('DELETE', f'scores/{score_id}', secret=secrets.token_hex(32), status=404)
        self.req('DELETE', f'scores/{score_id}', secret=owner)
        self.assertNotIn(score_id, [r['id'] for r in self.board(case)])
        replay = self.req('POST', f"runs/{run['run']}/finish", body, owner)
        self.assertEqual(replay['score'], receipt['score'])
        self.assertFalse(replay['ranked'])
        private_run = self.start(case, owner)
        private_body = self.body(case, publish=False)
        private = self.req('POST', f"runs/{private_run['run']}/finish", private_body, owner)
        self.assertFalse(private['ranked'])
        self.req('POST', f"runs/{private_run['run']}/finish", {**private_body, 'publish': True}, owner, status=409)
        with closing(sqlite3.connect(self.svc.db)) as db, db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM runs WHERE id=?', (run['run'],)).fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM scores WHERE id=?', (score_id,)).fetchone()[0], 0)
            row = db.execute('SELECT owner FROM runs WHERE id=?', (run['run'],)).fetchone()
            self.assertEqual(row[0], hashlib.sha256(owner.encode()).hexdigest())
            columns = [r[1] for r in db.execute('PRAGMA table_info(runs)')]
            self.assertFalse({'proof', 'secret', 'authorization'} & set(columns))
            self.assertTrue(owner not in '\n'.join(db.iterdump()), 'Plain bearer secret persisted in SQLite')

    def test_06_infinite_light_count_descending_and_best_per_owner(self):
        case = next(c for c in self.cases if c['name'] == 'hex-infinite')
        self.assertEqual(case['identity']['mode'], 'infinite-light:easy')
        def counted(n):
            p = copy.deepcopy(case['proof'])
            keys = ['0,0'] + [k for k in p['final']['safe'] if k != '0,0'][:n-1]
            p['final']['safe'] = keys
            p['final']['counts'] = [r for r in p['final']['counts'] if r[0] in keys]
            return p
        ids = []
        for n in (1, 2, 3):
            owner = secrets.token_hex(32)
            run = self.start(case, owner)
            receipt = self.req('POST', f"runs/{run['run']}/finish", self.body(case, proof=counted(n)), owner)
            self.assertEqual(receipt['score']['value'], n)
            ids.append(receipt['score']['id'])
        rows = [r for r in self.board(case) if r['id'] in ids]
        self.assertEqual([r['value'] for r in rows], [3, 2, 1])
        owner, repeat_ids = secrets.token_hex(32), []
        for n in (1, 3, 2):
            run = self.start(case, owner, repeat=True)
            receipt = self.req('POST', f"runs/{run['run']}/finish", self.body(case, proof=counted(n)), owner)
            repeat_ids.append(receipt['score']['id'])
        best = [r for r in self.board(case, 'repeat') if r['id'] in repeat_ids]
        self.assertEqual([r['id'] for r in best], [repeat_ids[1]])

    def test_07_exact_cors_rejects_before_mutating(self):
        case, owner = self.cases[0], secrets.token_hex(32)
        run = self.start(case, owner)
        receipt = self.req('POST', f"runs/{run['run']}/finish", self.body(case), owner)
        for origin in ('https://forbidden.test', 'null', ORIGIN + '.evil.test'):
            with self.subTest(origin=origin):
                with closing(sqlite3.connect(self.svc.db)) as db, db:
                    before = (db.execute('SELECT COUNT(*) FROM runs').fetchone(), db.execute('SELECT COUNT(*) FROM scores').fetchone())
                for method, endpoint, body in [('POST', 'runs', {'submission': secrets.token_hex(12), 'identity': case['identity']}),
                        ('POST', f"runs/{run['run']}/finish", self.body(case)),
                        ('DELETE', f"scores/{receipt['score']['id']}", None), ('GET', 'health', None)]:
                    status, headers, _ = self.svc.request(method, '/api/v1/' + endpoint, body, owner, origin)
                    self.assertEqual(status, 403)
                    self.assertNotIn('Access-Control-Allow-Origin', headers)
                with closing(sqlite3.connect(self.svc.db)) as db, db:
                    after = (db.execute('SELECT COUNT(*) FROM runs').fetchone(), db.execute('SELECT COUNT(*) FROM scores').fetchone())
                self.assertEqual(before, after)
        self.req('OPTIONS', 'runs', status=204, headers={'Access-Control-Request-Method': 'POST',
                 'Access-Control-Request-Headers': 'authorization,content-type'})
        self.req('OPTIONS', 'runs', status=403, headers={'Access-Control-Request-Method': 'POST',
                 'Access-Control-Request-Headers': 'x-forbidden'})

    def test_08_alternate_native_modes_still_validate_real_proofs(self):
        for name, mode in [('bridges', 'circuits'), ('slant', 'hard')]:
            with self.subTest(game=name, mode=mode):
                case = copy.deepcopy(next(c for c in self.cases if c['name'] == name))
                case['identity']['mode'] = mode
                owner = secrets.token_hex(32)
                run = self.start(case, owner)
                receipt = self.req('POST', f"runs/{run['run']}/finish", self.body(case), owner)
                self.assertTrue(receipt['ranked'])
                self.assertEqual(receipt['score']['identity'], case['identity'])
                self.assertIn(receipt['score']['id'], [r['id'] for r in self.board(case)])


if __name__ == '__main__':
    if sys.argv[1:] == ['--serve']:
        with RealService() as service:
            print(json.dumps({'base': f'http://127.0.0.1:{service.port}/api/v1/', 'db': str(service.db)}), flush=True)
            # The parent closes stdin to stop; cleanup reaps Node and removes DB.
            sys.stdin.read()
    else:
        unittest.main()

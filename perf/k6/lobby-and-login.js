/**
 * Escenario k6 N1: login + listado de lobby + listado de perfil.
 *
 * Mide el rendimiento HTTP de los endpoints críticos sin WebSocket
 * (autenticación y lobby) sobre el stack completo (PostgreSQL 16 + Redis 7).
 *
 *     k6 run perf/k6/lobby-and-login.js -e BASE_URL=http://localhost:3000
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_URL } from './lib.js';

export const options = {
  scenarios: {
    lobby_and_login: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '1m', target: 100 },
        { duration: '2m', target: 100 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300'],
  },
};

const errors = new Rate('errors');
const loginTrend = new Trend('login_duration_ms');
const lobbyTrend = new Trend('lobby_list_duration_ms');
const profileTrend = new Trend('profile_duration_ms');

function jsonHeaders() {
  return { 'Content-Type': 'application/json' };
}

export default function () {
  const suffix = `${__VU}-${__ITER}`;
  const nickname = `k6-${suffix}`;
  const email = `${nickname}@perftest.truco.ar`;
  const password = `perfPass-${suffix}`;

  // 1) Registro
  const regRes = http.post(
    `${BASE_URL}/v1/auth/register`,
    JSON.stringify({ nickname, email, password }),
    { headers: jsonHeaders() },
  );
  check(regRes, { 'register ok': (r) => r.status === 200 || r.status === 201 });
  if (regRes.status !== 200 && regRes.status !== 201) {
    errors.add(1);
    sleep(1);
    return;
  }
  errors.add(0);
  sleepRange(0.3, 1.2);

  // 2) Login
  const t0 = Date.now();
  const loginRes = http.post(`${BASE_URL}/v1/auth/login`, JSON.stringify({ email, password }), {
    headers: jsonHeaders(),
  });
  loginTrend.add(Date.now() - t0);
  check(loginRes, { 'login ok': (r) => r.status === 200 });
  const cookies = loginRes.cookies;
  sleepRange(0.2, 0.8);

  // 3) Perfil
  const t1 = Date.now();
  const meRes = http.get(`${BASE_URL}/v1/me`, { cookies });
  profileTrend.add(Date.now() - t1);
  check(meRes, { 'me ok': (r) => r.status === 200 });

  // 4) Lobby list
  const t2 = Date.now();
  const lobbyRes = http.get(`${BASE_URL}/v1/tables?limit=25`, { cookies });
  lobbyTrend.add(Date.now() - t2);
  check(lobbyRes, { 'lobby ok': (r) => r.status === 200 });

  // 5) Stats/history
  http.get(`${BASE_URL}/v1/me/matches?limit=20`, { cookies });

  sleepRange(0.5, 2.0);
}

function sleepRange(minS, maxS) {
  sleep(minS + Math.random() * (maxS - minS));
}

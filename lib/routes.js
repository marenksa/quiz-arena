// All API routes. Each handler takes a Web Request and returns a Response.
import crypto from 'node:crypto';
import { bank } from './questions.js';
import { COURSE, LECTURES, SAMPLES_FILE, publicCourse } from './course.js';
import { db, ensureSchema } from './db.js';
import { pointsFor } from './points.js';
import {
  clearedCookie,
  createSession,
  deleteSession,
  hashPin,
  sessionCookie,
  sessionUser,
  verifyPin,
} from './auth.js';

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function routeOf(request) {
  const url = new URL(request.url);
  const route = url.searchParams.get('route') ?? url.pathname.replace(/^\/api\/?/, '');
  return route.replace(/^\/+|\/+$/g, '');
}

async function readBody(request) {
  try {
    return (await request.json()) || {};
  } catch {
    throw new HttpError(400, 'bad_request', 'Invalid request body.');
  }
}

async function requireUser(request) {
  const user = await sessionUser(db(), request);
  if (!user) throw new HttpError(401, 'signed_out', 'Please log in again.');
  return user;
}

// A round covers the whole bank ('all'), one lecture/topic ('t:<topic>') or the player's
// custom selection ('custom': chosen lectures and length, fixed when the round starts).
function cleanScope(raw) {
  const scope = raw == null || raw === '' ? 'all' : String(raw);
  if (scope.length > 300 || (scope !== 'all' && scope !== 'custom' && !scope.startsWith('t:'))) {
    throw new HttpError(400, 'bad_scope', 'Unknown lecture.');
  }
  return scope;
}

// Questions in a round's scope. With includePensum false, pensum-only questions are left out.
// A custom round's questions are fixed at start, so its scope here is the whole bank.
function scopeQuestions(scope, includePensum = true) {
  const { list } = bank();
  const topic = scope === 'all' || scope === 'custom' ? null : scope.slice(2);
  return list.filter((q) => (topic === null || q.topic === topic) && (includePensum || !q.pensum));
}

const byTopicName = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

// A question as the player sees it before answering: no answer, no explanation.
function publicQuestion(q) {
  const order = q.shuffle ? shuffle(q.options.map((_, i) => i)) : q.options.map((_, i) => i);
  return {
    id: q.id,
    question: q.question,
    topic: q.topic,
    pensum: q.pensum,
    code: q.code || undefined,
    options: order.map((i) => ({ i, text: q.options[i] })),
  };
}

// Per-question history for one player: attempts, ever correct, latest answer correct.
async function questionStates(sql, userId) {
  const rows = await sql`
    select question_id, count(*)::int as n, bool_or(correct) as ever,
           (array_agg(correct order by id desc))[1] as last
    from attempts where user_id = ${userId} group by question_id`;
  return new Map(rows.map((r) => [r.question_id, r]));
}

// "Hard for everyone": questions that many players miss on their first try.
// Only each player's first answer to a question counts, and only if it was not given from the
// hard list itself (people answer differently once they are told a question is hard).
// A question qualifies once HARD_MIN_PLAYERS players have answered it and at least
// HARD_MIN_MISS of them missed it. Until then the feature stays hidden.
const HARD_MIN_PLAYERS = Math.max(1, Number(process.env.HARD_MIN_PLAYERS) || 3);
const HARD_MIN_MISS = Math.min(1, Math.max(0, Number(process.env.HARD_MIN_MISS) || 0.5));

async function hardQuestions(sql) {
  const { byId } = bank();
  const rows = await sql`
    select question_id, count(*)::int as players, count(*) filter (where not correct)::int as missed
    from (
      select distinct on (user_id, question_id) question_id, correct, mode
      from attempts order by user_id, question_id, id
    ) first_try
    where mode <> 'hard'
    group by question_id`;
  return rows
    .filter((r) => byId.has(r.question_id) && r.players >= HARD_MIN_PLAYERS && r.missed / r.players >= HARD_MIN_MISS)
    .map((r) => ({ id: r.question_id, players: r.players, missRate: r.missed / r.players }))
    .sort((a, b) => b.missRate - a.missRate || b.players - a.players);
}

// Mastered counts the whole syllabus (pensum included), so 100% always means everything.
// Mistakes count only what the player currently studies, so the Study mistakes button matches its list.
async function userStats(sql, user) {
  const { list, byId } = bank();
  const [states, hard] = await Promise.all([questionStates(sql, user.id), hardQuestions(sql)]);
  let mastered = 0;
  let mistakes = 0;
  for (const [id, s] of states) {
    const q = byId.get(id);
    if (!q) continue;
    if (s.last) mastered++;
    else if (user.include_pensum || !q.pensum) mistakes++;
  }
  const [{ points }] = await sql`select coalesce(sum(points), 0)::int as points from attempts where user_id = ${user.id}`;
  const topics = new Set([...LECTURES, ...list.map((q) => q.topic)]).size;
  const pensum = list.filter((q) => q.pensum).length;
  const hardCount = hard.filter((h) => user.include_pensum || !byId.get(h.id).pensum).length;
  return {
    points, mastered, mistakes, hard: hardCount, total: list.length, pensum, topics,
    streak: user.streak, bestStreak: user.best_streak,
  };
}

// Loads the player's test round and brings it up to date with the current question bank:
// removed questions are dropped and newly added ones are appended (shuffled) to an unfinished round.
// Turning pensum off drops unanswered pensum questions from the round; turning it on adds them back.
async function loadRun(sql, user, scope = 'all') {
  const userId = user.id;
  const [run] = await sql`
    select question_order, position, finished_at from test_runs where user_id = ${userId} and scope = ${scope}`;
  if (!run) return null;
  const allIds = new Set(scopeQuestions(scope).map((q) => q.id));
  const inScope = scopeQuestions(scope, user.include_pensum);
  const ids = new Set(inScope.map((q) => q.id));
  const old = run.question_order;
  const done = old.slice(0, run.position).filter((id) => allIds.has(id));
  let rest = old.slice(run.position).filter((id) => ids.has(id));
  let finished = Boolean(run.finished_at);
  // New questions join unfinished full and lecture rounds; a custom round keeps the questions it started with.
  if (!finished && scope !== 'custom') {
    const inRound = new Set(old);
    rest = rest.concat(shuffle(inScope.map((q) => q.id).filter((id) => !inRound.has(id))));
  }
  if (!finished && !rest.length) finished = true;
  const order = done.concat(rest);
  const changed = order.length !== old.length || order.some((id, i) => id !== old[i]);
  if (changed || finished !== Boolean(run.finished_at)) {
    await sql`
      update test_runs set question_order = ${sql.json(order)}, position = ${done.length},
        finished_at = ${finished ? run.finished_at || new Date() : null}
      where user_id = ${userId} and scope = ${scope}`;
  }
  return { order, position: done.length, finished };
}

function runView(run, scope) {
  if (!run) return null;
  const current = run.finished ? null : publicQuestion(bank().byId.get(run.order[run.position]));
  return { scope, position: run.position, total: run.order.length, finished: run.finished, current };
}

// Custom round: random questions from the chosen lectures, up to `count` (or all of them when
// count is null). With unmastered set, questions whose latest answer was right are left out.
// The pensum switch applies as everywhere else. Asking for more than exist just gives what exists.
async function customOrder(sql, user, body) {
  const topics = Array.isArray(body.topics) ? new Set(body.topics.map(String)) : new Set();
  if (!topics.size) throw new HttpError(400, 'no_topics', 'Pick at least one lecture.');
  const count = body.count == null ? null : Number(body.count);
  if (count !== null && !(Number.isInteger(count) && count > 0 && count <= 1000)) {
    throw new HttpError(400, 'bad_count', 'Invalid number of questions.');
  }
  const states = body.unmastered ? await questionStates(sql, user.id) : null;
  const pool = bank().list.filter(
    (q) => topics.has(q.topic) && (user.include_pensum || !q.pensum) && !(states && states.get(q.id)?.last),
  );
  const order = shuffle(pool.map((q) => q.id));
  return count === null ? order : order.slice(0, count);
}

function cleanNickname(raw) {
  const nickname = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N} _.-]{2,20}$/u.test(nickname)) {
    throw new HttpError(400, 'bad_nickname', 'Nickname: 2-20 letters, numbers, spaces, dots, dashes or underscores.');
  }
  return { nickname, key: nickname.toLocaleLowerCase('nb') };
}

function cleanPin(raw) {
  const pin = String(raw || '');
  if (!/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'bad_pin', 'PIN: 4-8 digits.');
  return pin;
}

// ---------- flags ----------
// Players can flag any question as bad (one flag per player per question, editable and withdrawable).
// Flags are private: other players never see them. Admins see them anonymously; the table keeps
// user_id so the flagger can be told when their question is fixed or reviewed.
const FLAG_REASONS = {
  wrong_answer: 'Wrong answer',
  ambiguous: 'Ambiguous / more than one right',
  unclear: 'Unclear wording',
  source: 'Wrong source or page',
  other: 'Other',
};
const NOTE_MAX = 500;

// Admins: player ids in ADMIN_USER_IDS (comma-separated; no admins when unset). Scripts and agents
// can instead send an admin key in the x-admin-key header; only its SHA-256 is configured, in
// ADMIN_KEY_SHA256. Without it, key access is off.
const ADMIN_USER_IDS = new Set(String(process.env.ADMIN_USER_IDS || '').split(',').map((s) => Number(s.trim())).filter(Boolean));
const ADMIN_KEY_SHA256 = /^[0-9a-f]{64}$/i.test(process.env.ADMIN_KEY_SHA256 || '') ? process.env.ADMIN_KEY_SHA256 : null;
const isAdmin = (user) => Boolean(user && ADMIN_USER_IDS.has(user.id));

function adminKeyOk(request) {
  const key = request.headers.get('x-admin-key');
  if (!key || !ADMIN_KEY_SHA256) return false;
  const a = crypto.createHash('sha256').update(key).digest();
  const b = Buffer.from(ADMIN_KEY_SHA256, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function requireAdmin(request) {
  if (adminKeyOk(request)) return null;
  const user = await requireUser(request);
  if (!isAdmin(user)) throw new HttpError(403, 'not_admin', 'Only admins can see flags.');
  return user;
}

function cleanFlag(body) {
  const reason = String(body.reason || '');
  if (!FLAG_REASONS[reason]) throw new HttpError(400, 'bad_reason', 'Pick a reason.');
  const note = String(body.note ?? '').trim().slice(0, NOTE_MAX) || null;
  return { reason, note };
}

async function openFlagCount(sql) {
  const [{ n }] = await sql`select count(distinct question_id)::int as n from flags where status = 'open'`;
  return n;
}

// ---------- shared course list ----------
// Course sites can opt in to a shared list (a JSON file, usually courses.json in the base repo on
// GitHub). Each site fetches it, keeps it for 10 minutes and shows it in its course switcher.
// course.json "directory": { enabled, url, hide: [site urls], only: [site urls], extra: [entries] }.
const DIRECTORY_TTL_MS = 10 * 60 * 1000;
let directoryCache = { at: 0, list: [] };

function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');
  let url;
  try {
    url = new URL(e.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return null;
  const entry = { code: text(e.code, 20), name: text(e.name, 80), university: text(e.university, 80), url: url.origin + url.pathname.replace(/\/$/, '') };
  return entry.name ? entry : null;
}

const sameSite = (a, b) => {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
};

async function fetchDirectory(url) {
  if (Date.now() - directoryCache.at < DIRECTORY_TTL_MS) return directoryCache.list;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = (Array.isArray(data) ? data : data.courses || []).map(cleanEntry).filter(Boolean).slice(0, 500);
    directoryCache = { at: Date.now(), list };
  } catch (e) {
    console.warn(`Course list unavailable (${e.message}); using the last copy.`);
    directoryCache.at = Date.now() - DIRECTORY_TTL_MS + 60 * 1000; // retry in a minute
  }
  return directoryCache.list;
}

async function directory(host) {
  const d = COURSE.directory || {};
  if (!d.enabled || !d.url) return [];
  const shared = await fetchDirectory(d.url);
  const extra = (d.extra || []).map(cleanEntry).filter(Boolean);
  const hide = d.hide || [];
  const only = Array.isArray(d.only) && d.only.length ? d.only : null;
  const seen = new Set();
  return [...shared, ...extra]
    .filter((e) => !hide.some((h) => sameSite(h, e.url)))
    .filter((e) => !only || only.some((o) => sameSite(o, e.url)))
    .filter((e) => !seen.has(e.url) && seen.add(e.url))
    .map((e) => ({ ...e, current: new URL(e.url).host === host }))
    .sort((a, b) => Number(b.current) - Number(a.current) || a.university.localeCompare(b.university) || a.code.localeCompare(b.code));
}

// Flags on the player's questions that were resolved since they last looked.
async function flagNotices(sql, userId) {
  const { byId } = bank();
  const rows = await sql`
    select question_id, status, reply from flags
    where user_id = ${userId} and status <> 'open' and not notified order by resolved_at`;
  return rows.map((r) => ({
    questionId: r.question_id,
    question: byId.get(r.question_id)?.question || null,
    status: r.status,
    reply: r.reply,
  }));
}

const routes = {
  'GET config': async () => json({ joinCodeRequired: Boolean(process.env.JOIN_CODE), course: publicCourse() }),

  // The shared course list (see courses.json in the base repo), filtered by this site's settings.
  'GET directory': async (request) => json({ courses: await directory(new URL(request.url).host) }),

  'GET me': async (request) => {
    const sql = db();
    const user = await sessionUser(sql, request);
    if (!user) return json({ user: null });
    const admin = isAdmin(user);
    const [stats, run, customRun, myFlags, notices, openFlags] = await Promise.all([
      userStats(sql, user),
      loadRun(sql, user),
      loadRun(sql, user, 'custom'),
      sql`select question_id from flags where user_id = ${user.id} and status = 'open'`,
      flagNotices(sql, user.id),
      admin ? openFlagCount(sql) : null,
    ]);
    return json({
      user: { nickname: user.nickname, includePensum: user.include_pensum, admin },
      stats,
      run: run && { position: run.position, total: run.order.length, finished: run.finished },
      customRun: customRun && { position: customRun.position, total: customRun.order.length, finished: customRun.finished },
      flagged: myFlags.map((r) => r.question_id),
      notices,
      openFlags,
    });
  },

  'POST register': async (request) => {
    const body = await readBody(request);
    const { nickname, key } = cleanNickname(body.nickname);
    const pin = cleanPin(body.pin);
    const joinCode = process.env.JOIN_CODE;
    if (joinCode && String(body.joinCode || '').trim() !== joinCode) {
      throw new HttpError(403, 'bad_join_code', 'That join code is not right. Ask whoever shared the link.');
    }
    const sql = db();
    const [user] = await sql`
      insert into users (nickname, nickname_key, pin_hash) values (${nickname}, ${key}, ${await hashPin(pin)})
      on conflict (nickname_key) do nothing returning id`;
    if (!user) throw new HttpError(409, 'nickname_taken', 'That nickname is taken.');
    const token = await createSession(sql, user.id);
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, token) });
  },

  'POST login': async (request) => {
    const body = await readBody(request);
    const { key } = cleanNickname(body.nickname);
    const pin = cleanPin(body.pin);
    const sql = db();
    const [user] = await sql`select id, pin_hash, failed_logins, locked_until from users where nickname_key = ${key}`;
    if (!user) throw new HttpError(404, 'no_player', 'No player with that nickname yet.');
    if (user.locked_until && user.locked_until > new Date()) {
      throw new HttpError(429, 'locked', 'Too many wrong PINs. Try again in 15 minutes.');
    }
    if (!(await verifyPin(pin, user.pin_hash))) {
      const fails = user.failed_logins + 1;
      const lock = fails >= 5;
      await sql`
        update users set failed_logins = ${lock ? 0 : fails},
          locked_until = ${lock ? new Date(Date.now() + 15 * 60 * 1000) : null}
        where id = ${user.id}`;
      throw new HttpError(401, 'wrong_pin', lock ? 'Wrong PIN. Locked for 15 minutes.' : 'Wrong PIN.');
    }
    await sql`update users set failed_logins = 0, locked_until = null where id = ${user.id}`;
    const token = await createSession(sql, user.id);
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, token) });
  },

  'POST logout': async (request) => {
    await deleteSession(db(), request);
    return json({ ok: true }, 200, { 'set-cookie': clearedCookie(request) });
  },

  'GET test': async (request) => {
    const user = await requireUser(request);
    const scope = cleanScope(new URL(request.url).searchParams.get('scope'));
    return json({ run: runView(await loadRun(db(), user, scope), scope) });
  },

  'POST test/start': async (request) => {
    const user = await requireUser(request);
    const body = await readBody(request);
    const scope = cleanScope(body.scope);
    const sql = db();
    const order = scope === 'custom'
      ? await customOrder(sql, user, body)
      : shuffle(scopeQuestions(scope, user.include_pensum).map((q) => q.id));
    if (!order.length) {
      throw new HttpError(409, 'no_questions', scope === 'custom' ? 'No questions match those choices.' : 'There are no questions here yet.');
    }
    await sql`
      insert into test_runs (user_id, scope, question_order, position) values (${user.id}, ${scope}, ${sql.json(order)}, 0)
      on conflict (user_id, scope) do update set question_order = excluded.question_order, position = 0,
        started_at = now(), finished_at = null`;
    return json({ run: runView(await loadRun(sql, user, scope), scope) });
  },

  'POST settings': async (request) => {
    const user = await requireUser(request);
    const { includePensum } = await readBody(request);
    if (typeof includePensum !== 'boolean') throw new HttpError(400, 'bad_setting', 'Invalid setting.');
    await db()`update users set include_pensum = ${includePensum} where id = ${user.id}`;
    return json({ includePensum });
  },

  // Skips the current pensum-only question in a round: no points, no attempt, not a mistake.
  'POST skip': async (request) => {
    const user = await requireUser(request);
    const body = await readBody(request);
    const scope = cleanScope(body.scope);
    const q = bank().byId.get(body.questionId);
    if (!q) throw new HttpError(404, 'unknown_question', 'That question no longer exists.');
    if (!q.pensum) throw new HttpError(400, 'not_skippable', 'Only pensum-only questions can be skipped.');
    const sql = db();
    const [moved] = await sql`
      update test_runs set position = position + 1,
        finished_at = case when position + 1 >= jsonb_array_length(question_order) then now() else null end
      where user_id = ${user.id} and scope = ${scope} and finished_at is null
        and question_order ->> position = ${q.id}
      returning position`;
    if (!moved) throw new HttpError(409, 'out_of_sync', 'That question was already answered.');
    return json({ ok: true });
  },

  // One row per lecture/topic with the player's progress, in natural order (Lecture 2 before Lecture 10).
  'GET topics': async (request) => {
    const user = await requireUser(request);
    const sql = db();
    const [states, runs] = await Promise.all([
      questionStates(sql, user.id),
      sql`
        select scope, position, jsonb_array_length(question_order)::int as total, finished_at
        from test_runs where user_id = ${user.id} and scope like 't:%'`,
    ]);
    const runByScope = new Map(runs.map((r) => [r.scope, r]));
    const groups = new Map();
    // Every course lecture is listed, including ones without questions yet. ready = has questions
    // of its own, not only samples.
    const blank = (topic) => ({ topic, scope: `t:${topic}`, total: 0, mastered: 0, mistakes: 0, playable: 0, unmastered: 0, ready: false });
    for (const topic of LECTURES) groups.set(topic, blank(topic));
    for (const q of bank().list) {
      // playable / unmastered: what a custom round can draw from, with the pensum switch applied.
      const g = groups.get(q.topic) || blank(q.topic);
      g.total++;
      if (q.file !== SAMPLES_FILE) g.ready = true;
      const s = states.get(q.id);
      if (s?.last) g.mastered++;
      else if (s && (user.include_pensum || !q.pensum)) g.mistakes++;
      if (user.include_pensum || !q.pensum) {
        g.playable++;
        if (!s?.last) g.unmastered++;
      }
      groups.set(q.topic, g);
    }
    const topics = [...groups.values()]
      .sort((a, b) => (!a.topic) - !b.topic || byTopicName(a.topic, b.topic))
      .map((g) => {
        const r = runByScope.get(g.scope);
        return { ...g, run: r ? { position: r.position, total: r.total, finished: Boolean(r.finished_at) } : null };
      });
    return json({ topics });
  },

  'GET mistakes': async (request) => {
    const user = await requireUser(request);
    const scope = cleanScope(new URL(request.url).searchParams.get('scope'));
    const allowed = new Set(scopeQuestions(scope, user.include_pensum).map((q) => q.id));
    const { byId } = bank();
    const states = await questionStates(db(), user.id);
    const ids = [...states.values()].filter((s) => !s.last && allowed.has(s.question_id)).map((s) => s.question_id);
    return json({ questions: shuffle(ids).map((id) => publicQuestion(byId.get(id))) });
  },

  // Hard for everyone, within the scope and the player's pensum setting. Questions the player
  // has not mastered come first, then hardest first.
  'GET hard': async (request) => {
    const user = await requireUser(request);
    const scope = cleanScope(new URL(request.url).searchParams.get('scope'));
    const allowed = new Set(scopeQuestions(scope, user.include_pensum).map((q) => q.id));
    const { byId } = bank();
    const sql = db();
    const [hard, states] = await Promise.all([hardQuestions(sql), questionStates(sql, user.id)]);
    const status = (id) => {
      const s = states.get(id);
      return !s ? 'new' : s.last ? 'mastered' : 'mistake';
    };
    const rank = { mistake: 0, new: 1, mastered: 2 };
    const questions = hard
      .filter((x) => allowed.has(x.id))
      .map((x) => ({ ...publicQuestion(byId.get(x.id)), players: x.players, missRate: x.missRate, status: status(x.id) }))
      .sort((a, b) => rank[a.status] - rank[b.status] || b.missRate - a.missRate);
    return json({ questions, minPlayers: HARD_MIN_PLAYERS });
  },

  'GET correct': async (request) => {
    const user = await requireUser(request);
    const states = await questionStates(db(), user.id);
    const questions = bank()
      .list.filter((q) => states.get(q.id)?.last)
      .map(({ file, ...q }) => ({ ...q, attempts: states.get(q.id).n }));
    return json({ questions });
  },

  // The player's own flag on one question (or null).
  'GET flag': async (request) => {
    const user = await requireUser(request);
    const questionId = new URL(request.url).searchParams.get('questionId');
    const [flag] = await db()`
      select reason, note, status from flags where user_id = ${user.id} and question_id = ${questionId}`;
    return json({ flag: flag && flag.status === 'open' ? { reason: flag.reason, note: flag.note } : null, reasons: FLAG_REASONS });
  },

  // Creates or updates the player's flag. Re-flagging a resolved question opens it again.
  'POST flag': async (request) => {
    const user = await requireUser(request);
    const body = await readBody(request);
    if (!bank().byId.has(body.questionId)) throw new HttpError(404, 'unknown_question', 'That question no longer exists.');
    const { reason, note } = cleanFlag(body);
    await db()`
      insert into flags (user_id, question_id, reason, note) values (${user.id}, ${body.questionId}, ${reason}, ${note})
      on conflict (user_id, question_id) do update set reason = excluded.reason, note = excluded.note,
        status = 'open', reply = null, resolved_at = null, notified = false, updated_at = now()`;
    return json({ ok: true });
  },

  'POST flag/withdraw': async (request) => {
    const user = await requireUser(request);
    const { questionId } = await readBody(request);
    await db()`delete from flags where user_id = ${user.id} and question_id = ${String(questionId)} and status = 'open'`;
    return json({ ok: true });
  },

  // Marks the player's resolved-flag notices as seen.
  'POST notices/seen': async (request) => {
    const user = await requireUser(request);
    await db()`update flags set notified = true where user_id = ${user.id} and status <> 'open' and not notified`;
    return json({ ok: true });
  },

  // Admin: flagged questions, grouped, anonymous. ?status=open (default) or all.
  'GET admin/flags': async (request) => {
    await requireAdmin(request);
    const all = new URL(request.url).searchParams.get('status') === 'all';
    const sql = db();
    const rows = all
      ? await sql`select question_id, reason, note, status, reply, created_at, updated_at, resolved_at from flags order by updated_at desc`
      : await sql`select question_id, reason, note, status, reply, created_at, updated_at, resolved_at from flags where status = 'open' order by updated_at desc`;
    const { byId } = bank();
    const groups = new Map();
    for (const r of rows) {
      const q = byId.get(r.question_id);
      const g = groups.get(r.question_id) || {
        questionId: r.question_id,
        inBank: Boolean(q),
        topic: q?.topic ?? null,
        question: q?.question ?? null,
        code: q?.code,
        options: q?.options ?? [],
        answer: q?.answer ?? null,
        explanation: q?.explanation ?? null,
        source: q?.source ?? null,
        open: 0,
        flags: [],
      };
      if (r.status === 'open') g.open++;
      g.flags.push({
        reason: r.reason, reasonLabel: FLAG_REASONS[r.reason] || r.reason, note: r.note, status: r.status, reply: r.reply,
        at: r.updated_at, resolvedAt: r.resolved_at,
      });
      groups.set(r.question_id, g);
    }
    const questions = [...groups.values()].sort((a, b) => b.open - a.open || b.flags.length - a.flags.length);
    return json({ questions, reasons: FLAG_REASONS });
  },

  // Admin: resolves every open flag on a question as 'fixed' or 'kept', with an optional reply
  // that the flaggers see in their notice.
  'POST admin/resolve': async (request) => {
    await requireAdmin(request);
    const body = await readBody(request);
    const status = String(body.status || '');
    if (!['fixed', 'kept'].includes(status)) throw new HttpError(400, 'bad_status', 'Status must be fixed or kept.');
    const reply = String(body.reply ?? '').trim().slice(0, NOTE_MAX) || null;
    const rows = await db()`
      update flags set status = ${status}, reply = ${reply}, resolved_at = now(), notified = false
      where question_id = ${String(body.questionId)} and status = 'open' returning id`;
    return json({ resolved: rows.length });
  },

  'POST answer': async (request) => {
    const user = await requireUser(request);
    const body = await readBody(request);
    const { questionId, chosen, mode } = body;
    const scope = cleanScope(body.scope);
    const q = bank().byId.get(questionId);
    if (!q) throw new HttpError(404, 'unknown_question', 'That question no longer exists.');
    if (!Number.isInteger(chosen) || chosen < 0 || chosen >= q.options.length) {
      throw new HttpError(400, 'bad_choice', 'Invalid choice.');
    }
    if (!['test', 'mistakes', 'hard'].includes(mode)) throw new HttpError(400, 'bad_mode', 'Invalid mode.');
    const sql = db();
    const result = await sql.begin(async (tx) => {
      // Locking the player row serialises a player's answers, so double clicks cannot double count.
      const [u] = await tx`select streak, best_streak from users where id = ${user.id} for update`;
      if (mode === 'test') {
        const [run] = await tx`
          select question_order, position, finished_at from test_runs where user_id = ${user.id} and scope = ${scope}`;
        if (!run || run.finished_at || run.question_order[run.position] !== questionId) {
          throw new HttpError(409, 'out_of_sync', 'That question was already answered.');
        }
      }
      const [prev] = await tx`
        select count(*)::int as n, coalesce(bool_or(correct), false) as ever,
               (array_agg(correct order by id desc))[1] as last
        from attempts where user_id = ${user.id} and question_id = ${questionId}`;
      if (mode === 'mistakes' && !(prev.n > 0 && prev.last === false)) {
        throw new HttpError(409, 'not_a_mistake', 'That question is no longer in your mistakes.');
      }
      const correct = chosen === q.answer;
      const points = pointsFor({ correct, previousAttempts: prev.n, everCorrect: prev.ever });
      const streak = correct ? u.streak + 1 : 0;
      const bestStreak = Math.max(u.best_streak, streak);
      await tx`
        insert into attempts (user_id, question_id, chosen, correct, points, mode)
        values (${user.id}, ${questionId}, ${chosen}, ${correct}, ${points}, ${mode})`;
      await tx`update users set streak = ${streak}, best_streak = ${bestStreak} where id = ${user.id}`;
      if (mode === 'test') {
        await tx`
          update test_runs set position = position + 1,
            finished_at = case when position + 1 >= jsonb_array_length(question_order) then now() else null end
          where user_id = ${user.id} and scope = ${scope}`;
      }
      return { correct, points, streak, bestStreak };
    });
    return json({ ...result, answer: q.answer, explanation: q.explanation, source: q.source });
  },

  'GET leaderboard': async (request) => {
    const user = await requireUser(request);
    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit')) || 100, 1), 500);
    const sql = db();
    const { list, byId } = bank();
    const [players, latest] = await Promise.all([
      sql`
        select u.id, u.nickname, u.best_streak, coalesce(sum(a.points), 0)::int as points, count(a.id)::int as answered
        from users u left join attempts a on a.user_id = u.id group by u.id`,
      sql`
        select distinct on (user_id, question_id) user_id, question_id, correct
        from attempts order by user_id, question_id, id desc`,
    ]);
    const mastered = new Map();
    for (const row of latest) {
      if (row.correct && byId.has(row.question_id)) mastered.set(row.user_id, (mastered.get(row.user_id) || 0) + 1);
    }
    const ranked = players
      .map((p) => ({
        nickname: p.nickname,
        points: p.points,
        mastered: mastered.get(p.id) || 0,
        answered: p.answered,
        bestStreak: p.best_streak,
        me: p.id === user.id,
      }))
      .sort((a, b) => b.points - a.points || b.mastered - a.mastered || a.nickname.localeCompare(b.nickname))
      .map((p, i) => ({ rank: i + 1, ...p }));
    const top = ranked.slice(0, limit);
    const mine = ranked.find((p) => p.me);
    return json({ total: list.length, players: top, me: mine && !top.includes(mine) ? mine : null });
  },
};

export async function handle(request) {
  try {
    const route = routes[`${request.method} ${routeOf(request)}`];
    if (!route) return json({ error: 'not_found' }, 404);
    // Only JSON POSTs are accepted; plain cross-site form posts cannot send this content type.
    if (request.method === 'POST' && !(request.headers.get('content-type') || '').includes('application/json')) {
      throw new HttpError(415, 'json_required', 'Requests must be JSON.');
    }
    await ensureSchema();
    return await route(request);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
    console.error(e);
    return json({ error: 'server_error', message: 'Something went wrong on the server. Try again.' }, 500);
  }
}

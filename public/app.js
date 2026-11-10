// Front end: plain DOM, hash routes (#/, #/play, #/play/<lecture>, #/mistakes, #/mistakes/<lecture>,
// #/hard, #/hard/<lecture>, #/lectures, #/custom, #/custom/play, #/correct, #/leaderboard, #/rules,
// #/flags (admins only)).
// Course name, lectures and source info come from course.json through GET /api/config.
import { ICONS } from '/icons.js';

const app = document.getElementById('app');
const LETTERS = 'ABCDEFGH';
let COURSE = { appName: 'Quiz Arena', code: '', name: '', tagline: '', sourceInfo: {}, directory: false };

// Light mode = "paper", dark mode = "cluster". index.html sets the starting theme before paint.
const isLight = () => document.documentElement.dataset.theme === 'paper';
function setMode(light) {
  document.documentElement.dataset.theme = light ? 'paper' : 'cluster';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f5f1ea' : '#0b1220');
  try {
    localStorage.setItem('qa-mode', light ? 'light' : 'dark');
  } catch {}
  document.querySelectorAll('.mode-toggle').forEach(paintToggle);
}
function paintToggle(btn) {
  const light = isLight();
  btn.replaceChildren(icon(light ? 'moon' : 'sun'));
  btn.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
  btn.title = light ? 'Dark mode' : 'Light mode';
}
function modeToggle() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mode-toggle';
  btn.addEventListener('click', () => setMode(!isLight()));
  paintToggle(btn);
  return btn;
}
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isLight() ? '#f5f1ea' : '#0b1220');

// Site title from course.json "appName": the first word plain, the rest in the second style.
function appTitle() {
  const [first, ...rest] = COURSE.appName.split(' ');
  return h('h1', { class: 'title' }, h('span', { class: 't1' }, first), rest.length ? h('span', { class: 't2' }, rest.join(' ')) : null);
}

// Course code and name. With the shared course list on, it opens a switcher listing other
// course sites (each run by its own maker, with its own players and login).
function courseBadge() {
  const label = [h('span', { class: 'code' }, COURSE.code), h('span', { class: 'cname' }, COURSE.name)];
  if (!COURSE.directory) return h('div', { class: 'course' }, ...label);
  const panel = h('div', { class: 'switcher', id: 'course-switcher', hidden: true });
  const btn = h('button', {
    class: 'course course-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'course-switcher',
    title: 'Switch course',
  }, ...label, icon('chevron-down'));
  const wrap = h('div', { class: 'course-wrap' }, btn, panel);
  const outside = (ev) => {
    if (!wrap.contains(ev.target)) close();
  };
  const close = () => {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', outside);
  };
  btn.addEventListener('click', async () => {
    if (!panel.hidden) return close();
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', outside);
    panel.replaceChildren(h('p', { class: 'switcher-note' }, 'Loading courses…'));
    let courses = [];
    try {
      ({ courses } = await api('directory'));
    } catch {
      panel.replaceChildren(h('p', { class: 'switcher-note' }, 'The course list could not be loaded. Try again later.'));
      return;
    }
    const others = courses.filter((c) => !c.current);
    panel.replaceChildren(...[
      h('p', { class: 'switcher-title' }, 'Courses'),
      h('ul', { class: 'switcher-list' },
        h('li', {}, h('span', { class: 'sw-item current', 'aria-current': 'page' },
          h('span', { class: 'sw-code' }, COURSE.code), h('span', { class: 'sw-name' }, COURSE.name), h('span', { class: 'sw-here' }, 'You are here'))),
        ...others.map((c) => h('li', {}, h('a', { class: 'sw-item', href: c.url, rel: 'noopener' },
          h('span', { class: 'sw-code' }, c.code), h('span', { class: 'sw-name' }, c.name),
          c.university ? h('span', { class: 'sw-uni' }, c.university) : null))),
      ),
      others.length ? null : h('p', { class: 'switcher-note' }, 'No other courses listed yet.'),
      h('p', { class: 'switcher-note' }, 'Each course site is run by its own maker and has its own players, so you sign up separately on each.'),
    ].filter(Boolean));
  });
  return wrap;
}

function icon(name, cls = 'ico') {
  const span = document.createElement('span');
  span.className = cls;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}
let me = null; // { user, stats, run } from /api/me
let config = { joinCodeRequired: false };
let keyHandler = null;
let viewToken = 0; // bumps on every navigation so stale quiz loops stop

// ---------- helpers ----------
async function api(path, { method = 'GET', body } = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body || {});
  }
  const res = await fetch(`/api/${path}`, init);
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error(data.message || 'Something went wrong. Try again.');
    err.code = data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

function show(...nodes) {
  app.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
  window.scrollTo(0, 0);
}

function go(route) {
  const hash = `#/${route}`;
  if (location.hash === hash || (!route && (location.hash === '' || location.hash === '#/'))) router();
  else location.hash = hash;
}

let toastTimer;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Scope of a round: 'all' or 't:<topic>'. In the URL, a lecture is #/play/<topic>.
const scopeOf = (topic) => (topic == null ? 'all' : `t:${topic}`);
const topicLabel = (topic) => topic || 'Other';
const withTopic = (route, topic) => (topic == null ? route : `${route}/${encodeURIComponent(topic)}`);

document.addEventListener('keydown', (ev) => {
  const typing = ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement;
  if (keyHandler && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !typing) keyHandler(ev);
});

// ---------- router ----------
const views = {
  '': home,
  play,
  mistakes: mistakesView,
  hard: hardView,
  lectures: lecturesView,
  correct: correctView,
  leaderboard: leaderboardView,
  rules: rulesView,
  flags: flagsView,
  custom: customView,
};

async function router() {
  const token = ++viewToken;
  keyHandler = null;
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  let topic = null;
  try {
    topic = rest.length ? decodeURIComponent(rest.join('/')) : null;
  } catch {}
  try {
    if (!me || !me.user) me = await api('me');
    if (token !== viewToken) return;
    if (!me.user) return loginView();
    await (views[name] || home)(token, topic);
  } catch (e) {
    if (token !== viewToken) return;
    if (e.code === 'signed_out') {
      me = null;
      return loginView();
    }
    show(
      h('section', { class: 'card summary' },
        h('h2', {}, 'Hmm, that did not work'),
        h('p', {}, e.message),
        h('button', { class: 'btn primary', onclick: () => router() }, 'Try again'),
      ),
    );
  }
}

// ---------- shared pieces ----------
function hud(stats) {
  const level = Math.floor(stats.points / 100) + 1;
  const into = stats.points % 100;
  return h('section', { class: 'hud', 'aria-label': 'Your progress' },
    h('div', { class: 'stat stat-points' },
      h('span', { class: 'stat-label' }, 'Points'),
      h('span', { class: 'stat-value num' }, stats.points),
    ),
    h('div', { class: 'stat stat-level' },
      h('span', { class: 'stat-label' }, 'Level'),
      h('span', { class: 'stat-value num' }, level),
      h('span', { class: 'xp', role: 'progressbar', 'aria-label': 'Progress to next level', 'aria-valuenow': into, 'aria-valuemin': 0, 'aria-valuemax': 100 },
        h('span', { class: 'xp-fill', style: `width:${into}%` })),
    ),
    h('div', { class: 'stat stat-mastered' },
      h('span', { class: 'stat-label' }, 'Mastered'),
      h('span', { class: 'stat-value num' }, `${stats.mastered}`, h('span', { class: 'of' }, `/${stats.total}`)),
      h('span', { class: 'xp', 'aria-hidden': 'true' }, h('span', { class: 'xp-fill', style: `width:${pct(stats.mastered, stats.total)}%` })),
    ),
    h('div', { class: 'stat stat-streak' },
      h('span', { class: 'stat-label' }, 'Streak'),
      h('span', { class: 'stat-value num' }, icon('flame', 'ico flame'), stats.streak),
    ),
  );
}

function menuItem({ ico, label, sub, onclick, primary, disabled, key, cls }) {
  return h('button', { class: `item${primary ? ' primary' : ''}${cls ? ` ${cls}` : ''}`, onclick, disabled },
    icon(ico),
    h('span', { class: 'txt' }, h('span', { class: 'label' }, label), h('span', { class: 'sub' }, sub)),
    key ? h('kbd', { class: 'key' }, key) : null,
    icon('chevron-right', 'ico go'),
  );
}

function boardRow(p, total) {
  return h('li', { class: `row${p.me ? ' me' : ''}${p.rank <= 3 ? ` top${p.rank}` : ''}` },
    h('span', { class: 'rank num' }, p.rank === 1 ? icon('crown', 'ico crown') : p.rank),
    h('span', { class: 'who' },
      h('span', { class: 'name' }, p.nickname, p.me ? h('span', { class: 'you' }, 'you') : null),
      h('span', { class: 'meta' }, `${pct(p.mastered, total)}% mastered · best streak ${p.bestStreak}`),
    ),
    h('span', { class: 'pts num' }, p.points, h('span', { class: 'pts-unit' }, ' pts')),
  );
}

function homeBoard(lb) {
  return h('section', { class: 'board-card' },
    h('div', { class: 'board-head' },
      h('h2', { class: 'section-title' }, icon('trophy'), 'Leaderboard'),
      h('span', { class: 'board-hint' }, 'Top 5'),
    ),
    lb.players.length
      ? h('ol', { class: 'board' },
          lb.players.map((p) => boardRow(p, lb.total)),
          lb.me ? [h('li', { class: 'gap', 'aria-hidden': 'true' }, '···'), boardRow(lb.me, lb.total)] : null,
        )
      : h('p', { class: 'empty' }, 'No players yet.'),
    h('button', { class: 'board-all', onclick: () => go('leaderboard') }, 'Full leaderboard', icon('chevron-right', 'ico go')),
  );
}

function backBar(title, route = '') {
  return h('div', { class: 'playbar' },
    h('button', { class: 'link back', onclick: () => go(route) }, icon('arrow-left'), route ? 'Back' : 'Home'),
    h('span', { class: 'ptext' }, title),
  );
}

// ---------- views ----------
async function home(token) {
  const [fresh, lb] = await Promise.all([api('me'), api('leaderboard?limit=5')]);
  if (token !== viewToken) return;
  me = fresh;
  if (!me.user) return loginView();
  const { stats, run } = me;
  const studyCount = me.user.includePensum ? stats.total : stats.total - stats.pensum;
  let primary;
  if (run && !run.finished) primary = { ico: 'step-forward', label: 'Resume test', sub: `${run.position} of ${run.total} answered` };
  else if (run) primary = { ico: 'play', label: 'New round', sub: `All ${studyCount} questions, shuffled` };
  else primary = { ico: 'play', label: 'Start test', sub: `All ${studyCount} questions, shuffled` };
  show(
    h('header', { class: 'top' },
      h('div', { class: 'top-row' },
        courseBadge(),
        modeToggle(),
      ),
      appTitle(),
      h('p', { class: 'tagline' }, COURSE.tagline),
    ),
    me.notices?.length ? noticeCard(me.notices) : null,
    hud(stats),
    stats.pensum ? pensumSwitch(stats) : null,
    h('nav', { class: 'menu', 'aria-label': 'Main menu' },
      menuItem({ ...primary, key: '1', primary: true, onclick: () => go('play'), disabled: !stats.total }),
      menuItem({
        ico: 'layers',
        key: '2',
        label: 'Study a lecture',
        sub: `Focus on one of ${plural(stats.topics, 'lecture')}`,
        onclick: () => go('lectures'),
        disabled: !stats.total,
      }),
      menuItem({
        ico: 'target',
        key: '3',
        label: 'Study mistakes',
        sub: [
          stats.mistakes
            ? stats.hard ? `${stats.mistakes} to fix` : `${plural(stats.mistakes, 'question')} to fix`
            : stats.hard ? null : 'Nothing to fix right now',
          stats.hard ? `${stats.hard} hard for everyone` : null,
        ].filter(Boolean).join(' · '),
        onclick: () => go('mistakes'),
        disabled: !stats.mistakes && !stats.hard,
      }),
      menuItem({
        ico: 'circle-check',
        key: '4',
        label: 'See correct',
        sub: stats.mastered ? `${stats.mastered} questions mastered` : 'Answer some questions first',
        onclick: () => go('correct'),
        disabled: !stats.mastered,
      }),
      menuItem({
        ico: 'sliders',
        key: '5',
        cls: 'item-custom',
        label: 'Custom study',
        sub: me.customRun && !me.customRun.finished
          ? `Resume: ${me.customRun.position} of ${me.customRun.total} answered`
          : 'Pick lectures and length',
        onclick: () => go('custom'),
        disabled: !stats.total,
      }),
    ),
    homeBoard(lb),
    h('footer', {},
      h('span', {}, `Playing as ${me.user.nickname}`),
      me.user.admin && me.openFlags ? h('button', { class: 'link', onclick: () => go('flags') }, `Flagged (${me.openFlags})`) : null,
      h('button', { class: 'link', onclick: () => go('rules') }, 'How points work'),
      h('button', { class: 'link', onclick: logout }, 'Log out'),
    ),
  );
  const go1 = ['play', 'lectures', 'mistakes', 'correct', 'custom'];
  keyHandler = (ev) => {
    const i = Number(ev.key) - 1;
    const btn = app.querySelectorAll('.menu .item')[i];
    if (go1[i] && btn && !btn.disabled) go(go1[i]);
  };
}

// Front-page switch: include or leave out pensum-only questions (saved on the player's account).
function pensumSwitch(stats) {
  const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch-input', id: 'pensum-switch' });
  input.checked = me.user.includePensum;
  input.addEventListener('change', async () => {
    input.disabled = true;
    try {
      await api('settings', { method: 'POST', body: { includePensum: input.checked } });
      me = null;
      router();
    } catch (e) {
      input.checked = !input.checked;
      input.disabled = false;
      toast(e.message);
    }
  });
  return h('label', { class: 'pensum-row', for: 'pensum-switch' },
    h('span', { class: 'pensum-txt' },
      h('span', { class: 'pensum-label' }, 'Include pensum-only questions'),
      h('span', { class: 'pensum-sub' }, `${plural(stats.pensum, 'question')} from the reading list that are not on the slides`),
    ),
    input,
    h('span', { class: 'switch', 'aria-hidden': 'true' }),
  );
}

function pensumTag() {
  return h('span', { class: 'tag-pensum', title: 'From the reading list, not on the slides' }, icon('book-open'), 'Pensum only');
}

// ---------- flagging ----------
// A small flag button for the question header, and the panel it opens. Any player can flag any
// question at any time; only admins see flags, and anonymously.
const FLAG_REASONS = {
  wrong_answer: 'Wrong answer',
  ambiguous: 'Ambiguous / more than one right',
  unclear: 'Unclear wording',
  source: 'Wrong source or page',
  other: 'Other',
};
const isFlagged = (id) => Boolean(me?.flagged?.includes(id));
function setFlagged(id, on) {
  if (!me) return;
  me.flagged = (me.flagged || []).filter((x) => x !== id);
  if (on) me.flagged.push(id);
}

function flagControl(q) {
  const panel = h('div', { class: 'flag-panel', hidden: true });
  const btn = h('button', {
    class: 'flag-btn', type: 'button', 'aria-expanded': 'false',
    onclick: (ev) => {
      ev.stopPropagation();
      if (panel.hidden) open();
      else close();
    },
  }, icon('flag'));
  const paint = () => {
    const on = isFlagged(q.id);
    btn.classList.toggle('on', on);
    btn.title = on ? 'You flagged this question' : 'Flag as a bad question';
    btn.setAttribute('aria-label', btn.title);
  };
  const close = () => {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  async function open() {
    btn.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    panel.replaceChildren(h('p', { class: 'flag-help' }, 'Loading…'));
    let flag = null;
    try {
      ({ flag } = await api(`flag?questionId=${encodeURIComponent(q.id)}`));
    } catch (e) {
      panel.replaceChildren(h('p', { class: 'flag-help' }, e.message));
      return;
    }
    const name = `reason-${q.id}`;
    const radios = Object.entries(FLAG_REASONS).map(([value, label]) => {
      const input = h('input', { type: 'radio', name, value });
      input.checked = flag?.reason === value;
      return h('label', { class: 'chip' }, input, h('span', {}, label));
    });
    const note = h('textarea', { class: 'flag-note', id: `note-${q.id}`, rows: 3, maxlength: 500, placeholder: 'What is wrong? Anything that helps us fix it.' });
    note.value = flag?.note || '';
    const msg = h('p', { class: 'flag-msg', 'aria-live': 'polite' });
    const send = h('button', { class: 'btn primary', type: 'button' }, flag ? 'Update flag' : 'Send flag');
    const cancel = h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Cancel');
    const withdraw = flag ? h('button', { class: 'link', type: 'button' }, 'Withdraw flag') : null;
    send.addEventListener('click', async () => {
      const reason = panel.querySelector(`input[name="${name}"]:checked`)?.value;
      if (!reason) return (msg.textContent = 'Pick a reason.');
      send.disabled = true;
      try {
        await api('flag', { method: 'POST', body: { questionId: q.id, reason, note: note.value } });
        setFlagged(q.id, true);
        paint();
        close();
        toast('Thanks! Flag sent. Only the site admins can see it.');
      } catch (e) {
        msg.textContent = e.message;
      } finally {
        send.disabled = false;
      }
    });
    withdraw?.addEventListener('click', async () => {
      try {
        await api('flag/withdraw', { method: 'POST', body: { questionId: q.id } });
        setFlagged(q.id, false);
        paint();
        close();
        toast('Flag withdrawn.');
      } catch (e) {
        msg.textContent = e.message;
      }
    });
    panel.replaceChildren(
      h('p', { class: 'flag-title' }, icon('flag'), flag ? 'You flagged this question' : 'Flag this question'),
      h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Reason' }, radios),
      h('label', { class: 'flag-label', for: note.id }, 'Notes (optional)'),
      note,
      msg,
      h('div', { class: 'flag-actions' }, send, cancel, withdraw),
      h('p', { class: 'flag-help' }, 'Flags are private: other players never see them, and the admins see them without your name.'),
    );
  }
  paint();
  return { btn, panel };
}

// Front-page notice when a question you flagged has been fixed or reviewed.
function noticeCard(notices) {
  const card = h('section', { class: 'notice', 'aria-live': 'polite' },
    h('div', { class: 'notice-head' },
      h('span', { class: 'notice-title' }, icon('bell'),
        notices.length === 1 ? 'Update on a question you flagged' : `Updates on ${notices.length} questions you flagged`),
      h('button', {
        class: 'link', type: 'button',
        onclick: async () => {
          card.remove();
          me.notices = [];
          try {
            await api('notices/seen', { method: 'POST' });
          } catch {}
        },
      }, 'Dismiss'),
    ),
    h('ul', {},
      notices.map((n) =>
        h('li', {},
          h('b', {}, n.status === 'fixed' ? 'Fixed. ' : 'Reviewed, kept as is. '),
          n.question ? h('span', { class: 'notice-q' }, `“${n.question}”`) : 'A question that has since been removed.',
          n.reply ? h('span', { class: 'notice-reply' }, n.reply) : null,
        ),
      ),
    ),
    h('p', { class: 'notice-thanks' }, 'Thanks for helping make the questions better.'),
  );
  return card;
}

// Source info from course.json "sourceInfo":
//   pages / pagesNoLecture: what a plain "p. N" refers to ({lecture} = the lecture's number);
//   books: [{ match, also?, unless?, text }] editions named when a source part matches;
//   documents: [{ match, name, doc }] documents with their own page numbers ($1 = first group).
// Patterns are case-insensitive regular expressions.
const rx = (s) => (s ? new RegExp(s, 'i') : null);
const fill = (s, m) => String(s || '').replace(/\$(\d)/g, (_, i) => m[i] ?? '');
function books() {
  return (COURSE.sourceInfo.books || []).map((b) => {
    const [match, also, unless] = [rx(b.match), rx(b.also), rx(b.unless)];
    return { text: b.text, test: (parts) => parts.some((p) => match?.test(p) && (!also || also.test(p)) && !(unless && unless.test(p))) };
  });
}
function otherDocs() {
  return (COURSE.sourceInfo.documents || []).filter((d) => d.match).map((d) => ({ re: rx(d.match), name: (m) => fill(d.name, m), doc: (m) => fill(d.doc, m) }));
}

// "Source: …" line. When it cites pages, an info button explains that "p." means the page in the
// course's own reading (sourceInfo.pages) and "book p." the printed book page, and names the
// editions. Pages in parts citing one of sourceInfo.documents are pages of that document.
let tipSeq = 0;
function sourceLine(source, topic) {
  const line = h('p', { class: 'source' }, `Source: ${source}`);
  if (!/\bpp?\.\s*\d/.test(source)) return line;
  const lecture = /lecture\s*(\d+)/i.exec(topic || '')?.[1];
  const info = COURSE.sourceInfo;
  const pdf = lecture
    ? String(info.pages || 'the reading for Lecture {lecture}').replaceAll('{lecture}', lecture)
    : info.pagesNoLecture || 'the reading for this lecture';
  const OTHER_DOCS = otherDocs();
  // First "p. N" / "pp. N–M" that is not a "book p." reference, and the first "book p." one.
  const PAGES = String.raw`(pp?)\.\s*(\d+(?:\s*[–-]\s*\d+)?(?:,\s*\d+(?:\s*[–-]\s*\d+)?)*)`;
  const word = (m) => (m[1] === 'pp' || /[–,-]/.test(m[2]) ? 'pages' : 'page');
  const allParts = source.split(';');
  const parts = [];
  const others = [];
  for (const part of allParts) {
    const d = OTHER_DOCS.find((o) => o.re.test(part));
    if (!d) {
      parts.push(part);
      continue;
    }
    const dm = d.re.exec(part);
    const pm = new RegExp(PAGES, 'i').exec(part);
    if (pm) others.push({ label: `${d.name(dm)} ${pm[1]}. ${pm[2]}`, pm, doc: d.doc(dm) });
  }
  const bookText = parts.join(';');
  const pdfM = new RegExp(String.raw`(?<!book )\b${PAGES}`, 'i').exec(bookText);
  const bookM = new RegExp(String.raw`book ${PAGES}`, 'i').exec(bookText);
  if (!pdfM && !bookM && !others.length) return line;
  const editions = books().filter((b) => b.test(parts)).map((b) => b.text);
  const id = `tip-${++tipSeq}`;
  const tip = h('span', { class: 'tip', id },
    h('b', { class: 'tip-title' }, 'Page numbers'),
    pdfM ? h('span', {}, h('b', {}, `${pdfM[1]}. ${pdfM[2]}`), ` ${word(pdfM) === 'pages' ? 'are pages' : 'is page'} ${pdfM[2]} of ${pdf}.`) : null,
    bookM ? h('span', {}, h('b', {}, `book ${bookM[1]}. ${bookM[2]}`), word(bookM) === 'pages' ? ' are the page numbers printed in the book itself.' : ' is the page number printed in the book itself.') : null,
    others.map((o) => h('span', {}, h('b', {}, o.label), ` ${word(o.pm) === 'pages' ? 'are pages' : 'is page'} ${o.pm[2]} of ${o.doc}.`)),
    editions.length ? h('span', { class: 'tip-books' }, editions.length === 1 ? 'Edition: ' : 'Editions: ', editions.join('; ').replace(/\.?$/, '.')) : null,
  );
  const btn = h('button', {
    class: 'info', type: 'button', 'aria-label': 'About these page numbers', 'aria-controls': id, 'aria-expanded': 'false',
    onclick: (ev) => {
      ev.stopPropagation();
      const open = !line.classList.contains('open');
      line.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    },
  }, icon('info'));
  line.classList.add('has-tip');
  line.append(' ', btn, tip);
  return line;
}
// Shows one question and resolves when the player presses Next. Resolves { resync: true } if the
// server says the question was already handled (e.g. answered in another tab).
// Pensum-only questions can be skipped; that resolves { skipped: true }.
function askQuestion(q, mode, { progressText, progress, footer, scope = 'all', back = '' }) {
  return new Promise((resolve) => {
    let answered = false;
    let finished = false;
    let result = null;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      resolve(value);
    };
    const streakEl = h('span', { class: 'streak', title: 'Current streak' }, icon('flame', 'ico flame'), h('span', { class: 'streak-n' }, me.stats.streak));
    const skipBtn = q.pensum
      ? h('button', { class: 'btn ghost skip', type: 'button', onclick: () => skip() }, 'Skip', h('kbd', {}, 'S'))
      : null;

    async function skip() {
      if (answered) return;
      answered = true;
      skipBtn.disabled = true;
      if (mode === 'test') {
        try {
          await api('skip', { method: 'POST', body: { questionId: q.id, scope } });
        } catch (e) {
          if (e.code !== 'out_of_sync') {
            answered = false;
            skipBtn.disabled = false;
            return toast(e.message);
          }
        }
      }
      finish({ skipped: true });
    }
    const feedback = h('div', { class: 'feedback', hidden: true, 'aria-live': 'polite' });
    const flag = flagControl(q);
    const nextBtn = h('button', { class: 'btn primary wide', hidden: true, onclick: () => finish(result) }, 'Next →');
    const opts = q.options.map((o, idx) =>
      h('button', { class: 'option', type: 'button', onclick: () => choose(idx) },
        h('span', { class: 'key', 'aria-hidden': 'true' }, LETTERS[idx]),
        h('span', {}, o.text),
      ),
    );

    async function choose(idx) {
      if (answered) return;
      answered = true;
      opts.forEach((b) => (b.disabled = true));
      opts[idx].classList.add('picked');
      try {
        result = await api('answer', { method: 'POST', body: { questionId: q.id, chosen: q.options[idx].i, mode, scope } });
      } catch (e) {
        if (e.code === 'out_of_sync' || e.code === 'not_a_mistake' || e.code === 'unknown_question') {
          toast('That question was already answered elsewhere. Moving on.');
          return finish({ resync: true });
        }
        answered = false;
        opts.forEach((b) => (b.disabled = false));
        opts[idx].classList.remove('picked');
        return toast(e.message);
      }
      const right = q.options.findIndex((o) => o.i === result.answer);
      if (skipBtn) skipBtn.hidden = true;
      opts[right].classList.add('right');
      if (!result.correct) opts[idx].classList.add('wrong');
      if (result.points) opts[idx].append(h('span', { class: 'float-pts', 'aria-hidden': 'true' }, `+${result.points}`));
      me.stats.streak = result.streak;
      me.stats.bestStreak = result.bestStreak;
      streakEl.querySelector('.streak-n').textContent = result.streak;
      feedback.replaceChildren(
        h('div', { class: `verdict ${result.correct ? 'ok' : 'bad'}` },
          result.correct
            ? `Correct! ${result.points ? `+${result.points} ${result.points === 1 ? 'point' : 'points'}` : ''}`
            : `Not quite. The answer is ${LETTERS[right]}.`,
        ),
        result.explanation ? h('p', { class: 'explain' }, result.explanation) : null,
        result.source ? sourceLine(result.source, q.topic) : null,
      );
      feedback.hidden = false;
      nextBtn.hidden = false;
      nextBtn.focus({ preventScroll: true });
      nextBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    keyHandler = (ev) => {
      if (!answered) {
        if (skipBtn && ev.key.toLowerCase() === 's') return skip();
        const n = /^[1-8]$/.test(ev.key) ? Number(ev.key) - 1 : LETTERS.indexOf(ev.key.toUpperCase());
        if (ev.key.length === 1 && n >= 0 && n < opts.length) choose(n);
      } else if (!nextBtn.hidden && (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'ArrowRight')) {
        ev.preventDefault();
        finish(result);
      }
    };

    show(
      h('div', { class: 'playbar' },
        h('button', { class: 'link back', onclick: () => go(back) }, icon('arrow-left'), back ? 'Back' : 'Home'),
        h('span', { class: 'ptext' }, progressText),
        streakEl,
      ),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': Math.round(progress), 'aria-valuemin': 0, 'aria-valuemax': 100 },
        h('div', { class: 'fill', style: `width:${progress}%` }),
      ),
      h('section', { class: 'card' },
        h('div', { class: 'q-head' },
          q.topic ? h('div', { class: 'topic' }, q.topic) : h('span'),
          h('div', { class: 'q-tags' }, q.pensum ? pensumTag() : null, flag.btn),
        ),
        flag.panel,
        h('h2', { class: 'qtext' }, q.question),
        q.code ? h('pre', { class: 'qcode' }, q.code) : null,
        h('div', { class: 'options' }, opts),
        feedback,
        nextBtn,
        skipBtn,
      ),
      h('p', { class: 'hint' }, 'Keys: 1-4 or A-D to answer, Enter for next. Progress saves after every answer.'),
      footer || null,
    );
  });
}

function summaryView({ title, number, caption, lines, actions }) {
  show(
    h('section', { class: 'card summary' },
      h('h2', {}, title),
      h('div', { class: 'big-number' }, number),
      h('p', {}, caption),
      lines.filter(Boolean).map((l) => h('p', {}, l)),
      h('div', { class: 'btn-row' }, actions),
    ),
  );
}

// Plays a full round (#/play), a lecture round (#/play/<lecture>) or the custom round (#/custom/play).
async function play(token, topic, custom = false) {
  const scope = custom ? 'custom' : scopeOf(topic);
  const back = custom ? 'custom' : topic == null ? '' : 'lectures';
  const qs = `scope=${encodeURIComponent(scope)}`;
  let { run } = await api(`test?${qs}`);
  if (token !== viewToken) return;
  // A custom round is started from the Custom study page; with none in progress, go there.
  if (custom && (!run || run.finished)) return go('custom');
  if (!run || run.finished) ({ run } = await api('test/start', { method: 'POST', body: { scope } }));
  if (token !== viewToken) return;
  const sitting = { answered: 0, correct: 0, points: 0 };
  const restart = custom
    ? h('p', { class: 'hint' }, h('button', { class: 'link', onclick: () => go('custom') }, 'New custom round'))
    : h('p', { class: 'hint' },
        h('button', {
          class: 'link',
          onclick: async () => {
            if (!confirm('Start a new round from question 1? Your points and history are kept.')) return;
            await api('test/start', { method: 'POST', body: { scope } });
            router();
          },
        }, 'Restart round'),
      );
  while (run && !run.finished) {
    const r = await askQuestion(run.current, 'test', {
      progressText: `${custom ? 'Custom' : topic == null ? 'Question' : topicLabel(topic)} · ${run.position + 1} / ${run.total}`,
      progress: (run.position / run.total) * 100,
      footer: restart,
      scope,
      back,
    });
    if (token !== viewToken) return;
    if (r.skipped) sitting.skipped = (sitting.skipped || 0) + 1;
    if (!r.resync && !r.skipped) {
      sitting.answered++;
      if (r.correct) sitting.correct++;
      sitting.points += r.points;
    }
    ({ run } = await api(`test?${qs}`));
    if (token !== viewToken) return;
  }
  me = await api('me');
  if (token !== viewToken) return;
  const { questions: left } = topic == null || custom ? { questions: null } : await api(`mistakes?${qs}`);
  if (token !== viewToken) return;
  const mistakesLeft = left ? left.length : me.stats.mistakes;
  summaryView({
    title: custom ? 'Custom round complete' : topic == null ? 'Round complete' : `${topicLabel(topic)} complete`,
    number: `+${sitting.points}`,
    caption: 'points this sitting',
    lines: [
      `${sitting.correct} of ${sitting.answered} right this sitting.`,
      sitting.skipped ? `${sitting.skipped} pensum-only ${sitting.skipped === 1 ? 'question' : 'questions'} skipped.` : null,
      `Mastered ${me.stats.mastered} of ${me.stats.total} questions overall.`,
    ],
    actions: [
      mistakesLeft
        ? h('button', { class: 'btn primary', onclick: () => go(withTopic('mistakes', topic)) }, `Study mistakes (${mistakesLeft})`)
        : null,
      custom ? h('button', { class: 'btn', onclick: () => go('custom') }, 'New custom round') : null,
      topic == null || custom ? null : h('button', { class: 'btn', onclick: () => go('lectures') }, 'All lectures'),
      h('button', { class: 'btn', onclick: () => go('') }, 'Home'),
    ],
  });
}

// Study mistakes. Once enough players have answered, it becomes a small hub with two tabs:
// "Your mistakes" and "Hard for everyone". Until then it starts the mistakes round directly, as before.
function mistakesView(token, topic) {
  return practiceHub(token, topic, 'mistakes');
}
function hardView(token, topic) {
  return practiceHub(token, topic, 'hard');
}

async function practiceHub(token, topic, tab) {
  const qs = `scope=${encodeURIComponent(scopeOf(topic))}`;
  const [{ questions: mistakes }, { questions: hard }] = await Promise.all([api(`mistakes?${qs}`), api(`hard?${qs}`)]);
  if (token !== viewToken) return;
  if (!hard.length) {
    if (tab === 'hard') return go(withTopic('mistakes', topic));
    return runMistakes(token, topic, mistakes, topic == null ? '' : 'lectures');
  }
  const here = withTopic(tab, topic);
  const where = topic == null ? '' : ` in ${topicLabel(topic)}`;
  const tabBtn = (id, ico, label, n) =>
    h('button', {
      class: `tab${tab === id ? ' on' : ''}`, role: 'tab', 'aria-selected': String(tab === id),
      onclick: () => tab !== id && go(withTopic(id, topic)),
    }, icon(ico), h('span', { class: 'tab-l' }, label), h('span', { class: 'tab-n num' }, n));
  const start = (label, run) => h('button', { class: 'btn primary wide', onclick: run }, icon('play'), label);
  let body;
  if (tab === 'mistakes') {
    body = mistakes.length
      ? [
          h('p', { class: 'lead' }, `Questions${where} where your latest answer was wrong.`),
          start(`Fix ${plural(mistakes.length, 'mistake')}`, () => runMistakes(token, topic, mistakes, here)),
          questionList(mistakes, topic, false),
        ]
      : [h('p', { class: 'empty' }, `Nothing to fix${where}. Everything you have answered is currently right.`)];
  } else {
    body = [
      h('p', { class: 'lead' }, `Questions${where} that most players get wrong on their first try.`),
      start(`Practise ${plural(hard.length, 'hard question')}`, () => runHard(token, topic, hard, here)),
      questionList(hard, topic, true),
    ];
  }
  show(
    backBar(topic == null ? 'Study mistakes' : topicLabel(topic), topic == null ? '' : 'lectures'),
    h('div', { class: 'tabs', role: 'tablist' },
      tabBtn('mistakes', 'target', 'Your mistakes', mistakes.length),
      tabBtn('hard', 'mountain', 'Hard for everyone', hard.length),
    ),
    h('section', { class: 'card hub' }, body),
  );
  keyHandler = (ev) => {
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') go(withTopic(tab === 'hard' ? 'mistakes' : 'hard', topic));
  };
}

const STATUS = { mistake: ['x', 'To fix'], new: ['circle-help', 'New to you'], mastered: ['check', 'You got it'] };

function questionList(items, topic, withStats) {
  return h('ol', { class: 'qlist' },
    items.map((q) =>
      h('li', {},
        h('div', { class: 'ql-main' },
          h('p', { class: 'ql-q' }, q.question),
          topic == null || q.pensum
            ? h('p', { class: 'ql-meta' }, [topic == null ? q.topic : null, q.pensum ? 'Pensum only' : null].filter(Boolean).join(' · '))
            : null,
        ),
        withStats
          ? h('div', { class: 'ql-side' },
              h('span', { class: 'miss num', title: `${q.players} players have answered this` }, `${Math.round(q.missRate * 100)}%`),
              h('span', { class: 'miss-l' }, 'miss it'),
              h('span', { class: `status s-${q.status}` }, icon(STATUS[q.status][0]), STATUS[q.status][1]),
            )
          : null,
      ),
    ),
  );
}

async function runHard(token, topic, questions, back) {
  let right = 0;
  let points = 0;
  let done = 0;
  let skipped = 0;
  for (let i = 0; i < questions.length; i++) {
    const r = await askQuestion(questions[i], 'hard', {
      progressText: `Hard question ${i + 1} / ${questions.length}`,
      progress: (i / questions.length) * 100,
      back,
    });
    if (token !== viewToken) return;
    if (r.skipped) skipped++;
    if (r.resync || r.skipped) continue;
    done++;
    if (r.correct) right++;
    points += r.points;
  }
  summaryView({
    title: 'Hard round done',
    number: `${right}/${done}`,
    caption: 'right',
    lines: [
      `+${points} points.`,
      skipped ? `${skipped} pensum-only ${skipped === 1 ? 'question' : 'questions'} skipped.` : null,
      right === done && done ? 'Not so hard after all.' : null,
    ],
    actions: [
      h('button', { class: 'btn primary', onclick: () => go(back) }, 'Back to the list'),
      h('button', { class: 'btn', onclick: () => go('') }, 'Home'),
    ],
  });
}

async function runMistakes(token, topic, questions, back) {
  if (!questions.length) {
    return summaryView({
      title: 'No mistakes to fix',
      number: '0',
      caption: topic == null ? 'Everything you have answered is currently right.' : `Nothing to fix in ${topicLabel(topic)}.`,
      lines: [],
      actions: [h('button', { class: 'btn primary', onclick: () => go(back) }, back === 'lectures' ? 'All lectures' : back ? 'Back' : 'Home')],
    });
  }
  let fixed = 0;
  let points = 0;
  let done = 0;
  for (let i = 0; i < questions.length; i++) {
    const r = await askQuestion(questions[i], 'mistakes', {
      progressText: `${topic == null ? 'Mistake' : `${topicLabel(topic)} mistake`} ${i + 1} / ${questions.length}`,
      progress: (i / questions.length) * 100,
      back,
    });
    if (token !== viewToken) return;
    if (r.resync || r.skipped) continue;
    done++;
    if (r.correct) fixed++;
    points += r.points;
  }
  const left = done - fixed;
  summaryView({
    title: 'Mistakes round done',
    number: `${fixed}/${done}`,
    caption: 'fixed',
    lines: [`+${points} points.`, left ? `${plural(left, 'question')} still to fix.` : 'All fixed. Nice.'],
    actions: [
      left ? h('button', { class: 'btn primary', onclick: () => router() }, 'Go again') : null,
      topic == null ? null : h('button', { class: 'btn', onclick: () => go('lectures') }, 'All lectures'),
      h('button', { class: 'btn', onclick: () => go('') }, 'Home'),
    ],
  });
}

// "a sample question" / "3 sample questions", or with course.json "samplesOwner" (e.g. "the
// lecturer's"): "the lecturer's sample question" / "the lecturer's 3 sample questions".
function samplesText(n) {
  const what = n === 1 ? 'sample question' : `${n} sample questions`;
  if (COURSE.samplesOwner) return `${COURSE.samplesOwner} ${what}`;
  return n === 1 ? `a ${what}` : what;
}

async function lecturesView(token) {
  const { topics } = await api('topics');
  if (token !== viewToken) return;
  show(
    backBar(`${plural(topics.length, 'lecture')}`),
    topics.map((t) => {
      // Lectures without their own question set yet: "Coming soon", playable only if the
      // sample questions cover them.
      if (!t.ready) {
        return h('section', { class: 'card lecture soon' },
          h('div', { class: 'lecture-head' },
            h('h2', {}, topicLabel(t.topic)),
            h('span', { class: 'tag-soon' }, 'Coming soon'),
          ),
          h('p', { class: 'lecture-meta' },
            t.total
              ? `Only ${samplesText(t.total)} so far. ${t.mastered}/${t.total} mastered.`
              : 'No questions yet.'),
          t.total
            ? h('div', { class: 'lecture-actions' },
                h('button', { class: 'btn', onclick: () => go(withTopic('play', t.topic)) }, icon(t.run && !t.run.finished ? 'step-forward' : 'play'),
                  t.run && !t.run.finished ? `Resume ${t.run.position}/${t.run.total}` : t.run ? 'Play again' : 'Start'),
                t.mistakes
                  ? h('button', { class: 'btn', onclick: () => go(withTopic('mistakes', t.topic)) }, icon('target'), `Fix ${t.mistakes}`)
                  : null,
              )
            : null,
        );
      }
      const run = t.run;
      let playLabel = 'Start';
      if (run && !run.finished) playLabel = `Resume ${run.position}/${run.total}`;
      else if (run) playLabel = 'Play again';
      return h('section', { class: 'card lecture' },
        h('div', { class: 'lecture-head' },
          h('h2', {}, topicLabel(t.topic)),
          h('span', { class: 'lecture-pct' }, `${pct(t.mastered, t.total)}%`),
        ),
        h('div', { class: 'progress', 'aria-hidden': 'true' }, h('div', { class: 'fill', style: `width:${pct(t.mastered, t.total)}%` })),
        h('p', { class: 'lecture-meta' },
          `${t.mastered}/${t.total} mastered`, t.mistakes ? ` · ${plural(t.mistakes, 'mistake')}` : ''),
        h('div', { class: 'lecture-actions' },
          h('button', { class: 'btn primary', onclick: () => go(withTopic('play', t.topic)) }, icon(run && !run.finished ? 'step-forward' : 'play'), playLabel),
          t.mistakes
            ? h('button', { class: 'btn', onclick: () => go(withTopic('mistakes', t.topic)) }, icon('target'), `Fix ${t.mistakes}`)
            : null,
        ),
      );
    }),
    h('p', { class: 'hint' }, 'Each lecture has its own round that you can pause and resume. Points count the same everywhere.'),
  );
}

// Custom study: pick a length and lectures; the round draws randomly from them. #/custom/play plays it.
// The last choices are remembered on this device.
const CUSTOM_COUNTS = [10, 20, 30, 50, null];
async function customView(token, sub) {
  if (sub === 'play') return play(token, null, true);
  const [fresh, { topics }] = await Promise.all([api('me'), api('topics')]);
  if (token !== viewToken) return;
  me = fresh;
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('qa-custom') || '{}');
  } catch {}
  // Lectures without any questions yet are listed but can't be ticked.
  const known = new Set(topics.filter((t) => t.total).map((t) => t.topic));
  const state = {
    count: CUSTOM_COUNTS.includes(saved.count) ? saved.count : 20,
    topics: new Set((saved.topics || [...known]).filter((t) => known.has(t))),
    unmastered: saved.unmastered ?? true,
  };
  const save = () => {
    try {
      localStorage.setItem('qa-custom', JSON.stringify({ count: state.count, topics: [...state.topics], unmastered: state.unmastered }));
    } catch {}
  };

  const segBtns = CUSTOM_COUNTS.map((n) =>
    h('button', { type: 'button', role: 'radio', onclick: () => ((state.count = n), update()) }, n == null ? 'All' : String(n)),
  );
  const boxes = topics.map((t) => {
    const empty = !t.total;
    const input = h('input', { type: 'checkbox', class: 'cs-check', disabled: empty });
    input.checked = state.topics.has(t.topic);
    input.addEventListener('change', () => {
      if (input.checked) state.topics.add(t.topic);
      else state.topics.delete(t.topic);
      update();
    });
    const m = pct(t.mastered, t.total);
    return {
      t,
      input,
      empty,
      row: h('label', { class: `cs-row${empty ? ' soon' : ''}` },
        input,
        h('span', { class: 'cs-box', 'aria-hidden': 'true' }, icon('check')),
        h('span', { class: 'cs-name' },
          h('span', {}, topicLabel(t.topic)),
          h('span', { class: 'cs-sub' },
            empty ? 'Coming soon' : t.ready ? plural(t.playable, 'question') : `${plural(t.playable, 'sample question')} · more coming`),
        ),
        empty
          ? null
          : h('span', { class: 'cs-mini', title: `${m}% mastered` }, h('small', {}, `${m}%`), h('span', { class: 'cs-bar' }, h('span', { style: `width:${m}%` }))),
      ),
    };
  });
  const setAll = (on) => {
    boxes.forEach((b) => {
      if (b.empty) return;
      b.input.checked = on;
      if (on) state.topics.add(b.t.topic);
      else state.topics.delete(b.t.topic);
    });
    update();
  };
  const unm = h('input', { type: 'checkbox', role: 'switch', class: 'switch-input', id: 'cs-unmastered' });
  unm.checked = state.unmastered;
  unm.addEventListener('change', () => ((state.unmastered = unm.checked), update()));
  const unmSub = h('span', { class: 'pensum-sub' });
  const startBtn = h('button', { class: 'btn primary wide cs-start', type: 'button' });
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    try {
      await api('test/start', {
        method: 'POST',
        body: { scope: 'custom', topics: [...state.topics], count: state.count, unmastered: state.unmastered },
      });
      go('custom/play');
    } catch (e) {
      toast(e.message);
      update();
    }
  });

  function update() {
    save();
    segBtns.forEach((b, i) => {
      const on = CUSTOM_COUNTS[i] === state.count;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    const chosen = topics.filter((t) => state.topics.has(t.topic));
    const available = chosen.reduce((s, t) => s + (state.unmastered ? t.unmastered : t.playable), 0);
    const mastered = chosen.reduce((s, t) => s + (t.playable - t.unmastered), 0);
    unmSub.textContent = mastered
      ? `Skips the ${plural(mastered, 'question')} you already got right in these lectures`
      : 'Skips questions you already got right';
    const n = state.count == null ? available : Math.min(state.count, available);
    startBtn.disabled = n === 0;
    startBtn.replaceChildren(
      ...(n === 0
        ? [chosen.length ? 'No questions match' : 'Pick at least one lecture']
        : [icon('play'), `Start ${plural(n, 'question')} from ${plural(chosen.length, 'lecture')}`]),
    );
  }

  const cr = me.customRun;
  show(
    backBar('Custom study'),
    cr && !cr.finished
      ? h('section', { class: 'card cs-resume' },
          h('span', { class: 'cs-name' }, h('b', {}, 'Unfinished custom round'), h('span', { class: 'cs-sub' }, `${cr.position} of ${cr.total} answered`)),
          h('button', { class: 'btn', type: 'button', onclick: () => go('custom/play') }, icon('step-forward'), 'Resume'),
        )
      : null,
    h('section', { class: 'card' },
      h('p', { class: 'cs-label' }, 'How many questions?'),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'How many questions' }, segBtns),
    ),
    h('section', { class: 'card' },
      h('p', { class: 'cs-label' }, 'Lectures',
        h('span', {},
          h('button', { class: 'link', type: 'button', onclick: () => setAll(true) }, 'All'),
          h('button', { class: 'link', type: 'button', onclick: () => setAll(false) }, 'None'),
        ),
      ),
      h('div', { class: 'cs-list' }, boxes.map((b) => b.row)),
    ),
    h('label', { class: 'pensum-row cs-unm', for: 'cs-unmastered' },
      h('span', { class: 'pensum-txt' }, h('span', { class: 'pensum-label' }, "Only questions I haven't mastered"), unmSub),
      unm,
      h('span', { class: 'switch', 'aria-hidden': 'true' }),
    ),
    startBtn,
    h('p', { class: 'hint' },
      cr && !cr.finished ? 'Starting a new round replaces the unfinished one. ' : '',
      me.user.includePensum ? '' : 'Pensum-only questions are left out (switch on the front page). ',
      'Progress saves after every answer.'),
  );
  update();
}

async function correctView(token) {
  const { questions } = await api('correct');
  if (token !== viewToken) return;
  const list = h('div', {});
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Search questions and answers…', 'aria-label': 'Search' });
  const render = () => {
    const term = search.value.trim().toLowerCase();
    const shown = questions.filter(
      (q) => !term || [q.question, q.options[q.answer], q.explanation, q.topic].join(' ').toLowerCase().includes(term),
    );
    list.replaceChildren(
      ...(shown.length
        ? shown.map((q) => {
            const flag = flagControl(q);
            return h('article', { class: 'card qa' },
              h('div', { class: 'q-head' },
                q.topic ? h('div', { class: 'topic' }, q.topic) : h('span'),
                h('div', { class: 'q-tags' }, q.pensum ? pensumTag() : null, flag.btn),
              ),
              flag.panel,
              h('p', { class: 'q' }, q.question),
              q.code ? h('pre', { class: 'qcode' }, q.code) : null,
              h('p', { class: 'a' }, '✓ ', q.options[q.answer]),
              q.explanation ? h('p', { class: 'explain' }, q.explanation) : null,
              q.source ? sourceLine(q.source, q.topic) : null,
              h('details', {},
                h('summary', {}, 'All options'),
                h('ol', { type: 'A' }, q.options.map((o, i) => h('li', { class: i === q.answer ? 'is-answer' : '' }, o))),
              ),
            );
          })
        : [h('p', { class: 'empty' }, 'Nothing matches.')]),
    );
  };
  search.addEventListener('input', render);
  render();
  show(backBar(`${questions.length} correct`), search, list);
}

async function leaderboardView(token) {
  const lb = await api('leaderboard?limit=500');
  if (token !== viewToken) return;
  show(
    backBar('Leaderboard'),
    h('section', { class: 'card' },
      h('h2', { class: 'section-title' }, `${plural(lb.players.length, 'player')} · ${lb.total} questions`),
      h('div', { class: 'table-wrap' },
        h('table', { class: 'full' },
          h('thead', {}, h('tr', {}, ['#', 'Player', 'Points', 'Mastered', 'Answered', 'Best streak'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {},
            lb.players.map((p) =>
              h('tr', { class: p.me ? 'me' : '' },
                h('td', {}, p.rank),
                h('td', {}, p.nickname, p.me ? ' (you)' : ''),
                h('td', {}, h('b', {}, p.points)),
                h('td', {}, `${pct(p.mastered, lb.total)}%`),
                h('td', {}, p.answered),
                h('td', {}, p.bestStreak),
              ),
            ),
          ),
        ),
      ),
    ),
    h('p', { class: 'hint' }, 'Ranked by points, then by questions mastered.'),
  );
}

// Admins only: flagged questions, grouped, without the flaggers' names.
async function flagsView(token, filter) {
  if (!me.user.admin) return go('');
  const all = filter === 'all';
  const { questions } = await api(`admin/flags${all ? '?status=all' : ''}`);
  if (token !== viewToken) return;
  const date = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const card = (q) => {
    const reply = h('input', { class: 'search reply', type: 'text', maxlength: 500, placeholder: 'Reply to the flaggers (optional)', 'aria-label': 'Reply to the flaggers' });
    const resolve = async (status, btn) => {
      btn.disabled = true;
      try {
        await api('admin/resolve', { method: 'POST', body: { questionId: q.questionId, status, reply: reply.value } });
        toast(status === 'fixed' ? 'Marked as fixed. The flaggers will be told.' : 'Kept as is. The flaggers will be told.');
        me = null;
        router();
      } catch (e) {
        btn.disabled = false;
        toast(e.message);
      }
    };
    const reasons = {};
    for (const f of q.flags) if (f.status === 'open') reasons[f.reasonLabel] = (reasons[f.reasonLabel] || 0) + 1;
    return h('article', { class: 'card qa flagged' },
      h('div', { class: 'q-head' },
        h('div', { class: 'topic' }, q.topic || 'Removed question'),
        h('span', { class: 'flag-count' }, icon('flag'), q.open ? plural(q.open, 'open flag') : 'resolved'),
      ),
      h('p', { class: 'q' }, q.question || `(${q.questionId} is no longer in the question bank)`),
      q.code ? h('pre', { class: 'qcode' }, q.code) : null,
      q.inBank
        ? h('ol', { type: 'A', class: 'flag-opts' }, q.options.map((o, i) => h('li', { class: i === q.answer ? 'is-answer' : '' }, o, i === q.answer ? ' ✓' : '')))
        : null,
      q.explanation ? h('p', { class: 'explain' }, q.explanation) : null,
      q.source ? sourceLine(q.source, q.topic) : null,
      Object.keys(reasons).length
        ? h('p', { class: 'flag-reasons' }, Object.entries(reasons).map(([r, n]) => `${r}${n > 1 ? ` ×${n}` : ''}`).join(' · '))
        : null,
      h('ul', { class: 'flag-notes' },
        q.flags.map((f) =>
          h('li', { class: f.status === 'open' ? '' : 'done' },
            h('span', { class: 'flag-meta' }, `${f.reasonLabel} · ${date(f.at)}${f.status === 'open' ? '' : ` · ${f.status}`}`),
            f.note ? h('span', { class: 'flag-text' }, f.note) : h('span', { class: 'flag-text muted' }, 'No notes'),
            f.reply ? h('span', { class: 'flag-text muted' }, `Reply: ${f.reply}`) : null,
          ),
        ),
      ),
      q.open
        ? h('div', { class: 'flag-resolve' },
            reply,
            h('div', { class: 'flag-actions' },
              h('button', { class: 'btn primary', type: 'button', onclick: (ev) => resolve('fixed', ev.currentTarget) }, icon('check'), 'Fixed'),
              h('button', { class: 'btn', type: 'button', onclick: (ev) => resolve('kept', ev.currentTarget) }, 'Keep as is'),
            ),
          )
        : null,
    );
  };
  show(
    backBar(all ? 'All flags' : 'Flagged questions'),
    h('div', { class: 'tabs' },
      h('button', { class: `tab ${all ? '' : 'on'}`, onclick: () => go('flags') }, 'Open'),
      h('button', { class: `tab ${all ? 'on' : ''}`, onclick: () => go('flags/all') }, 'All, incl. resolved'),
    ),
    questions.length ? questions.map(card) : h('p', { class: 'empty' }, all ? 'No flags yet.' : 'No open flags. Nice.'),
    h('p', { class: 'hint' }, 'Only admins see this page. Flags are shown without names. Fix the question in the repo first, then mark it fixed.'),
  );
}

function rulesView() {
  show(
    backBar('How points work'),
    h('section', { class: 'card rules' },
      h('h2', {}, 'Points'),
      h('ul', {},
        h('li', {}, h('b', {}, '+10'), ' for a correct answer the very first time you see a question.'),
        h('li', {}, h('b', {}, '+5'), ' the first time you get right a question you missed before.'),
        h('li', {}, h('b', {}, '+1'), ' for getting a question right again after that.'),
        h('li', {}, h('b', {}, '0'), ' for a wrong answer. No minus points.'),
      ),
      h('p', {}, 'Missing on purpose never pays: it turns a +10 into a +5. The flame is your streak of correct answers in a row, just for bragging rights.'),
      h('h2', {}, 'Mastered'),
      h('p', {}, 'A question counts as mastered while your latest answer to it is right. Get it wrong again and it moves back to your mistakes.'),
      h('p', {}, 'Mastered is always counted out of every question, pensum-only ones included, so 100% means the whole syllabus. Leaving pensum out is fine for quick practice, but you cannot reach 100% without it.'),
      h('h2', {}, 'Pensum-only questions'),
      h('p', {}, 'Questions marked "Pensum only" come from the reading list and are not on the slides. Turn them off on the front page, or press Skip on a single one. Skipping gives no points and does not count as a mistake; the question comes back in your next round.'),
      h('h2', {}, 'Hard for everyone'),
      h('p', {}, 'Under Study mistakes, a second tab lists the questions most players miss on their first try. It appears once enough players have answered. Points work the same there, and answers given from that list do not change how hard a question counts as.'),
      h('h2', {}, 'Flagging a question'),
      h('p', {}, 'Think a question is wrong, ambiguous or badly worded? Press the small flag in its top-right corner, pick a reason and add a note if you like. You can do it at any time, before or after answering, and change or withdraw it later. Flags are private: other players never see them, and the admins see them without your name. When the question has been looked at, you get a short note on the front page.'),
    ),
  );
}

function loginView() {
  keyHandler = null;
  let creating = false;
  const nick = h('input', { id: 'nick', name: 'username', autocomplete: 'username', maxlength: 20, required: true });
  const pin = h('input', {
    id: 'pin', name: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'current-password',
    pattern: '[0-9]{4,8}', minlength: 4, maxlength: 8, required: true,
  });
  const join = h('input', { id: 'join', name: 'join', autocomplete: 'off' });
  const joinBlock = h('div', { hidden: true }, h('label', { for: 'join' }, 'Join code'), join, h('p', { class: 'help' }, 'Ask whoever shared the link.'));
  const pinHelp = h('p', { class: 'help' }, '4-8 digits. Do not reuse a real password or bank PIN.');
  const msg = h('p', { class: 'msg', role: 'alert' });
  const submit = h('button', { class: 'btn primary wide', type: 'submit' }, 'Play');
  const back = h('button', {
    class: 'link', type: 'button', hidden: true,
    onclick: () => {
      creating = false;
      joinBlock.hidden = true;
      back.hidden = true;
      submit.textContent = 'Play';
      msg.textContent = '';
    },
  }, 'Back to log in');

  const form = h('form', { class: 'form' },
    h('label', { for: 'nick' }, 'Nickname'), nick,
    h('label', { for: 'pin' }, 'PIN'), pin, pinHelp,
    joinBlock,
    msg,
    h('div', { class: 'btn-row' }, submit, back),
  );
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    msg.textContent = '';
    submit.disabled = true;
    try {
      const body = { nickname: nick.value, pin: pin.value, joinCode: join.value };
      await api(creating ? 'register' : 'login', { method: 'POST', body });
      me = null;
      go('');
    } catch (e) {
      if (e.code === 'no_player' && !creating) {
        creating = true;
        joinBlock.hidden = !config.joinCodeRequired;
        back.hidden = false;
        submit.textContent = 'Create player';
        msg.textContent = `No player called "${nick.value.trim()}" yet. Create it with this PIN? Remember the PIN; there is no reset.`;
      } else {
        msg.textContent = e.message;
      }
    } finally {
      submit.disabled = false;
    }
  });
  show(
    h('header', { class: 'top' },
      h('div', { class: 'top-row' },
        courseBadge(),
        modeToggle(),
      ),
      appTitle(),
      h('p', { class: 'tagline' }, 'Pick a nickname and a PIN to join.'),
    ),
    h('section', { class: 'card' }, form),
  );
  nick.focus();
}

async function logout() {
  await api('logout', { method: 'POST' }).catch(() => {});
  me = null;
  go('');
}

// ---------- start ----------
window.addEventListener('hashchange', router);
api('config')
  .then((c) => {
    config = c;
    if (c.course) COURSE = { ...COURSE, ...c.course, sourceInfo: c.course.sourceInfo || {} };
    document.title = COURSE.code ? `${COURSE.appName} · ${COURSE.code}` : COURSE.appName;
  })
  .catch(() => {})
  .finally(router);

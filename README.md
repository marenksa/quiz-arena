# Quiz Arena

A small, game-style multiple-choice practice site for exam revision. Each course runs its own
copy: fork this repo, add your course's questions, deploy it for free on Vercel, and share the link
with your classmates.

## What it does

- **Rounds you can pause:** the whole bank, one lecture at a time, or a custom round (pick
  lectures and a length). Progress is saved after every answer.
- **Study mistakes** and **See correct**, plus **Hard for everyone**: the questions most players
  miss on their first try.
- **Points and a leaderboard**, with no minus points (see below).
- **Pensum-only questions** that players can switch off or skip.
- **Flagging:** any player can flag a bad question privately; admins get an anonymous list.
- **Course switcher** linking to other course sites that have joined the shared course list.
- Light and dark mode, works on phones, nickname + PIN login (no email collected).

Plain HTML, CSS and JavaScript in `public/` (no build step), one Vercel function (`api/index.js`,
routes in `lib/routes.js`) and Postgres. Tables are created automatically on first use.

## Make your own course site

You need a GitHub account and a free Vercel account (sign in with GitHub).

1. **Fork this repo** (or use it as a template) into your own GitHub account.
2. **Edit `course.json`:** your course code, name, lecture list and source info (see
   [Course config](#course-config)).
3. **Replace the demo questions** in `questions/` with your own (see
   [Questions](#questions)). Run `npm run check` to validate them.
4. **Deploy on Vercel:** *Add New… → Project*, import your repo, and deploy. No build settings are
   needed; `vercel.json` has them.
5. **Add a database:** in the Vercel project, *Storage → Create Database → Neon* (free plan). It
   sets `DATABASE_URL` for you. Redeploy once afterwards.
6. **Make yourself admin:** open the site, create your player, then set `ADMIN_USER_IDS` to your
   player id (the first player is usually `1`; check the `users` table in the Neon console) and
   redeploy.
7. **Optional:** set `JOIN_CODE` if only people with a code should be able to sign up, and join
   the [shared course list](#shared-course-list).

From then on, every push to `main` deploys automatically. A broken question file stops the
deploy, and the previous version stays live.

Your site, its database and its players are yours alone. Nobody else's site can see or change
them, and you are responsible for your own.

### Environment variables

| Variable | Needed | What it does |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string. Set by the Vercel Neon integration. |
| `ADMIN_USER_IDS` | No | Comma-separated player ids that are admins (see flags). No admins when unset. |
| `ADMIN_KEY_SHA256` | No | SHA-256 (hex) of an admin key for scripts and agents (`x-admin-key` header). Key access is off when unset. |
| `JOIN_CODE` | No | Players must enter this code to create a player. |
| `HARD_MIN_PLAYERS` | No | Players needed before a question can count as "hard" (default 3). |
| `HARD_MIN_MISS` | No | Share of first answers that must be wrong (default 0.5). |

To make an admin key, generate a long random string, store it in your password manager, and set
`ADMIN_KEY_SHA256` to its hash, for example `printf %s "$KEY" | shasum -a 256`. Never commit the
key itself.

### Keep course material out of the repo

Your repo is public if you forked it from here. Don't commit slides, book chapters, compendia or
other course material; they're usually copyrighted. Write your own questions and cite the material
by slide and page number instead.

## Course config

Everything course-specific is in `course.json`:

```json
{
  "appName": "Quiz Arena",
  "code": "DEMO101",
  "name": "Demo course",
  "tagline": "Multiple-choice practice for the exam",
  "lectures": ["Lecture 1: How the web works", "Lecture 2: Version control with Git"],
  "samplesFile": "90-samples.json",
  "sourceInfo": {
    "pages": "the lecture notes for Lecture {lecture}",
    "pagesNoLecture": "the lecture notes for this lecture",
    "books": [{ "match": "pro git", "text": "Chacon & Straub: Pro Git, 2nd ed." }],
    "documents": [{ "match": "assignment\\s*(\\d+)", "name": "Assignment $1", "doc": "the Assignment $1 description" }]
  },
  "directory": { "enabled": true, "url": "https://raw.githubusercontent.com/marenksa/quiz-arena/main/courses.json", "hide": [] }
}
```

- `appName`: the site title. The first word and the rest are styled differently.
- `lectures`: in order. Every lecture is shown, even before it has questions; a lecture without
  questions of its own is marked "Coming soon". Question `topic`s must match these names exactly.
- `samplesFile` (optional): a question file of sample questions (for example from the lecturer's
  sample exam). They are playable, but don't make a lecture "ready" on their own.
- `samplesOwner` (optional): who the samples are from, shown on the lecture list, for example
  `"the lecturer's"` gives "Only the lecturer's sample question so far".
- `sourceInfo` (optional) drives the info box next to a question's source when it cites pages:
  - `pages` / `pagesNoLecture`: what a plain "p. N" means. `{lecture}` is the lecture's number.
  - `books`: editions named in the info box when a source part matches `match`, a
    case-insensitive regular expression. Optional `also` (must also match) and `unless` (must not
    match) tell editions of the same book apart, for example `"match": "tanenbaum", "unless": "3rd"`.
    "book p. M" always means the page printed in the book.
  - `documents`: documents with their own page numbers, such as papers or assignments. Pages in a
    source part that matches are explained as pages of that document. `$1` is the first group in
    `match`.
- `directory`: the [shared course list](#shared-course-list) settings.

## Questions

Question files are JSON lists in `questions/`, loaded in name order. Name them by lecture, for
example `questions/07-lecture.json`.

```json
[
  {
    "id": "l03-q07",
    "question": "Which …?",
    "options": ["First option", "Second option", "Third option", "Fourth option"],
    "answer": 2,
    "explanation": "Why the answer is right (and why the tempting wrong one is wrong).",
    "source": "Lecture 3, slide 14; p. 22 (book p. 140)",
    "topic": "Lecture 3: Memory",
    "coverage": "slides"
  }
]
```

- `id` (required): unique and stable; letters, digits, `.`, `-`, `_`. Progress is stored against
  it, so never reuse or rename an id. If you change what a question asks or its answer, give it a
  new id.
- `question`, `options` (2–8 texts) and `answer` (0-based: 0 is the first option) are required.
- `topic`: one of the lecture names in `course.json`, written identically.
- `explanation`, `source`: optional but strongly recommended.
- `coverage`: `"slides"` (default) if it was taught, `"pensum"` if it's only in the reading list.
  Pensum-only questions get a tag, can be skipped, and can be switched off on the front page.
  See the coverage rule below.
- `code` (optional): code or a table, shown in a monospace block. Use `\n` for new lines.
- Inline code: wrap names from code in backticks, such as `` `accept` ``, in the question, options
  or explanation, and they are shown in a code font.
- `shuffle: false` (optional) keeps the options in order, for "All of the above" or ranges.

New questions join anyone's unfinished round; deleted questions drop out of rounds, mistakes and
mastered counts (points already earned stay).

### Coverage rule

The lecturer says more than the slides show, so "taught" is wider than "written on a slide".
Wrongly marking something pensum-only is worse than the opposite, because players with pensum
switched off would never see it. A question counts as taught (`"slides"`) if:

1. the slides name the concept and the question tests a natural elaboration a lecturer would add
   in a sentence or three: the definition, the purpose or "why", the obvious contrast with a
   neighbouring concept, or the standard textbook example;
2. it applies a mechanism or algorithm the slides show to new input; or
3. it comes from a group session exercise or a mandatory assignment.

It is pensum-only (`"pensum"`) if the concept isn't in the slides, group sessions or assignments at
all; if it needs a formula, calculation or figure that isn't shown there; or if it needs a
detailed procedure or product/API detail well beyond the slide. A term that is only named in a
one-word list on a slide doesn't make its book details taught. **When in doubt, it counts as
taught.**

### Prompt for question-writing agents

An AI agent can draft questions from your slides and reading list. Review every question yourself
before adding it. Fill in your lecture names and source style:

> Write multiple-choice questions from the attached slides and reading list as a JSON list in this
> format: `id`, `question`, `options` (4), `answer` (0-based index), `explanation`, `source`,
> `topic`, `coverage`. `topic` is exactly one of: [your lecture names from course.json]. `source`
> cites the lecture and slide, and for book material the page, written like
> "Lecture 7, slide 3; p. 2 (book p. 818)". Cite group sessions as "Group session N, QK (slide X)"
> and assignments as "Assignment N p. X". `coverage` is "slides" if it was taught and "pensum" if
> it is only in the reading list, following this rule: [paste the coverage rule]. Use ids like
> `l03-q01`. One clearly correct answer per question with plausible distractors; no "all/none of
> the above" unless you set `"shuffle": false`. Explanations say why the answer is right and why
> the most tempting distractor is wrong. Don't let the correct option give itself away: keep all
> options about the same length and detail, make the correct answer the longest option in no more
> than about a quarter of the questions, and avoid wording in it that echoes the question. Mix in
> question types beyond "what is X": reading code or a table (put it in the `code` field), working
> something out from given data, and "Is it true that …?" with reasons in the options.

## Points

| Situation | Points |
| --- | --- |
| Correct on your very first try at a question | +10 |
| Correct after having missed it before (once per question) | +5 |
| Correct again on a question you have already got right | +1 |
| Wrong | 0 |

The rule is in `lib/points.js`. A question is *mastered* while your latest answer to it is right,
and a *mistake* while it's wrong. Mastered % always counts every question. The streak is cosmetic.

## Flagging bad questions

Every question card has a flag in its top-right corner. Any player can flag any question at any
time with a reason and optional notes, and update or withdraw their flag. Other players never see
flags; admins see them without names (the `flags` table keeps `user_id` so the flagger can be
notified).

- **Admins** (`ADMIN_USER_IDS`) get a "Flagged (n)" link in the front-page footer, leading to
  `#/flags`, with "Fixed" and "Keep as is" buttons and an optional reply.
- **Scripts and agents** send the admin key in an `x-admin-key` header:
  - `GET /api/admin/flags` lists open flags by question (`?status=all` includes resolved ones).
  - `POST /api/admin/resolve` with `{"questionId", "status": "fixed" | "kept", "reply"?}`.
- **Flaggers** see a small note on the front page once their question is resolved.

Workflow: fix the question and push, then mark it fixed. If the fix changes the correct answer,
give the question a new id instead.

## Shared course list

`courses.json` in this repo lists course sites that have chosen to be linked together. Every site
with the list switched on shows them in a course switcher (click the course name at the top), so
students can move between courses. Each site stays independent: its own maker, database, players
and login, so players sign up separately on each.

**To join:** deploy your site, then open a pull request that adds an entry to `courses.json`:

```json
{ "code": "IN1000", "name": "Introduction to Programming", "university": "University of Oslo", "url": "https://your-site.vercel.app" }
```

Only `https` addresses are accepted. Pull requests are reviewed before they're merged, and sites
that are gone or misused can be removed. A new entry shows up on every site within about ten
minutes, without redeploying.

**Your site's settings** (`directory` in `course.json`):

- `enabled`: `false` hides the switcher completely.
- `url`: where the list is read from. Point it at your own list to run a separate group of sites.
- `hide`: site addresses to leave out of your switcher.
- `only`: if set, show only these site addresses.
- `extra`: extra entries in the same format, shown only on your site.

## Local development

```sh
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/quiz npm run dev   # http://localhost:3000
```

Without a local Postgres, an in-memory one works for testing. Install
`@electric-sql/pglite-socket` somewhere outside the project, run
`npx pglite-server --port 5433 --db memory://`, then start the site with
`DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres npm run dev`.

## Licence

MIT © 2026 Maren Sandhaug. See `LICENSE`.

Bundled fonts (Fraunces, Inter, IBM Plex Mono) are under the SIL Open Font License; their licence
texts are in `public/fonts/`. Icons are from Lucide (ISC licence).

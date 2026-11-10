// Postgres connection and schema. Works with Neon (pooled URL) and any plain Postgres.
import postgres from 'postgres';

let sql;
let ready;

export function db() {
  if (!sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    sql = postgres(url, { prepare: false, max: 1, idle_timeout: 20, onnotice: () => {} });
  }
  return sql;
}

const SCHEMA = `
create table if not exists users (
  id serial primary key,
  nickname text not null,
  nickname_key text not null unique,
  pin_hash text not null,
  streak int not null default 0,
  best_streak int not null default 0,
  failed_logins int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  token_hash text primary key,
  user_id int not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create table if not exists attempts (
  id bigserial primary key,
  user_id int not null references users(id) on delete cascade,
  question_id text not null,
  chosen int not null,
  correct boolean not null,
  points int not null,
  mode text not null,
  created_at timestamptz not null default now()
);
create index if not exists attempts_user_question on attempts (user_id, question_id, id);
alter table users add column if not exists include_pensum boolean not null default true;
create table if not exists test_runs (
  user_id int not null references users(id) on delete cascade,
  scope text not null default 'all',
  question_order jsonb not null,
  position int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (user_id, scope)
);
create table if not exists flags (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  question_id text not null,
  reason text not null,
  note text,
  status text not null default 'open',
  reply text,
  resolved_at timestamptz,
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, question_id)
);
create index if not exists flags_status on flags (status, question_id);
`;

// Creates the tables on first use; the advisory lock stops parallel cold starts from racing.
export function ensureSchema() {
  if (!ready) {
    ready = db()
      .begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(727274)`;
        await tx.unsafe(SCHEMA);
      })
      .catch((e) => {
        ready = null;
        throw e;
      });
  }
  return ready;
}

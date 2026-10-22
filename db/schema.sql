-- CasaSigma media store.
--
-- Images live in Postgres as bytea so a fresh clone can be brought up with
-- `npm run setup` and no object storage account. Keep rows small (brand marks,
-- thumbnails); move large listing photography to object storage and store the
-- URL here instead.

create table if not exists media (
  slug text primary key,
  mime text not null,
  bytes bytea not null,
  updated_at timestamptz not null default now(),
  constraint media_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  constraint media_mime_image check (
    mime in ('image/png', 'image/jpeg', 'image/webp', 'image/avif')
  ),
  constraint media_bytes_size check (octet_length(bytes) between 1 and 8388608)
);

comment on table media is 'Images served by GET /api/media/:slug; source files live in public/brand.';

-- Accounts and sessions.
--
-- Sessions store only a SHA-256 of the cookie token, so a database dump does
-- not hand out usable sessions. Role is fixed per account for now: buyers
-- browse and enquire, sellers will own listings.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null check (char_length(name) between 2 and 80),
  phone text,
  role text not null check (role in ('buyer', 'seller')),
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_email_unique on users (lower(email));

-- Roles and selling/buying permissions.
--
-- `role` is how an account signed up; access is decided by the two permission
-- flags so an admin can grant or revoke selling without changing the role.
-- Accounts created before permissions existed keep what their role implied.
create table if not exists schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

alter table users drop constraint if exists users_role_check;
alter table users
  add constraint users_role_check check (role in ('buyer', 'seller', 'admin'));

alter table users add column if not exists can_buy boolean not null default true;
alter table users add column if not exists can_sell boolean not null default false;

-- Suspension replaces revoking permissions: a suspended account cannot sign in
-- and its live sessions stop resolving. Null means the account is active.
alter table users add column if not exists suspended_at timestamptz;

create index if not exists users_suspended_idx on users (suspended_at)
  where suspended_at is not null;

-- Admin sign-in by name.
--
-- Buyers and sellers sign in with their email; the admin account also gets a
-- username so it can be recognised as `Admin`. The unique index is partial, so
-- ordinary accounts simply have no username and never collide.
alter table users add column if not exists username text;

create unique index if not exists users_username_unique on users (lower(username))
  where username is not null;

alter table users drop constraint if exists users_username_format;
alter table users
  add constraint users_username_format
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{1,31}$');

-- A password hash is always written by signup or the seed, but it is nullable
-- so an unfinished admin row can never be signed into by accident.
alter table users alter column password_hash drop not null;

-- The seeded admin signs in with a public starter password and must replace it
-- before the dashboard opens; this flag tracks that first-run step.
alter table users
  add column if not exists must_set_password boolean not null default false;

-- Setup codes were replaced by the starter-password flow; drop the leftovers.
drop table if exists admin_setup;

do $$
begin
  if not exists (select 1 from schema_migrations where id = 'users-permissions-v1') then
    update users set can_buy = true, can_sell = (role = 'seller');
    insert into schema_migrations (id) values ('users-permissions-v1');
  end if;
end
$$;

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text
);

create index if not exists sessions_user_idx on sessions (user_id, expires_at desc);

comment on table users is 'Accounts; passwords are scrypt hashes, username names the admin, must_set_password forces the first-run credential change, suspended_at blocks sign-in, can_buy/can_sell gate what they may do.';
comment on table sessions is 'Opaque sign-in sessions; the cookie token is only stored hashed.';

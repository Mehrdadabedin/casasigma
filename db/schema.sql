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

-- Towns, filled from the listings people publish.
--
-- The city filter on /homes reads this table instead of a hardcoded list, so a
-- seller who lists in a new town makes it selectable for everyone.
create table if not exists cities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  created_at timestamptz not null default now()
);

create unique index if not exists cities_name_unique on cities (lower(name));

insert into cities (name)
values ('Casares'), ('Estepona'), ('Marbella'), ('Mijas'), ('Málaga'), ('Nerja')
on conflict (lower(name)) do nothing;

comment on table cities is 'Towns selectable in the city filter; a new listing upserts its town here.';

-- Listings published by sellers from the studio.
--
-- The demo catalogue in src/data stays the showcase; these are the listings
-- real accounts add, and they name the town that lands in `cities`.
create table if not exists listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references users(id) on delete set null,
  title text not null check (char_length(title) between 4 and 120),
  kind text not null check (kind in ('Apartment', 'House', 'Loft', 'Villa', 'Restaurant')),
  city text not null check (char_length(city) between 2 and 80),
  price integer not null check (price between 0 and 100000000),
  description text not null default '' check (char_length(description) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists listings_city_idx on listings (lower(city));
create index if not exists listings_seller_idx on listings (seller_id, created_at desc);

comment on table listings is 'Listings added by sellers; inserting one also upserts its city.';

-- Photos for the listings sellers publish.
--
-- Twenty fixed slots per listing (a seller holds 20 photos in total), each pointing at a row in `media` (slug
-- listing-*). Slot 1 is the cover; replacing a slot swaps the slug and the old
-- file is removed, so no orphaned bytes stay behind.
create table if not exists listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  media_slug text not null references media(slug) on delete cascade,
  position smallint not null check (position between 1 and 20),
  created_at timestamptz not null default now(),
  unique (listing_id, position)
);

create index if not exists listing_photos_listing_idx on listing_photos (listing_id, position);

-- Databases created with four slots keep the old check until this runs once.
do $$
begin
  if not exists (select 1 from schema_migrations where id = 'listing-photos-five-slots-v1') then
    alter table listing_photos drop constraint if exists listing_photos_position_check;
    alter table listing_photos
      add constraint listing_photos_position_check check (position between 1 and 5);
    insert into schema_migrations (id) values ('listing-photos-five-slots-v1');
  end if;
end
$$;

-- A seller may put all 20 photos on one listing. This must stay after the
-- five-slot block above, which sets the check back to 1-5 on a new database.
do $$
begin
  if not exists (select 1 from schema_migrations where id = 'listing-photos-twenty-slots-v1') then
    alter table listing_photos drop constraint if exists listing_photos_position_check;
    alter table listing_photos
      add constraint listing_photos_position_check check (position between 1 and 20);
    insert into schema_migrations (id) values ('listing-photos-twenty-slots-v1');
  end if;
end
$$;

comment on table listing_photos is 'Up to twenty photos per listing; position 1 is the cover and each slug points into media.';

-- Viewing requests sent from the Book page.
--
-- Guests may send one too (user_id stays null); signed-in requests are listed
-- back on /book and can be cancelled by their owner.
create table if not exists viewing_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  listing_id text not null,
  listing_title text not null,
  name text not null check (char_length(name) between 2 and 80),
  email text not null,
  description text not null default '' check (char_length(description) <= 2000),
  visit_date date not null,
  visit_time text not null,
  status text not null default 'Requested'
    check (status in ('Requested', 'Confirmed', 'Cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists viewing_requests_user_idx
  on viewing_requests (user_id, visit_date, visit_time);

-- The seller who receives the request, set by the server from the listing.
-- Requests for the demo catalogue keep it null.
alter table viewing_requests
  add column if not exists seller_id uuid references users(id) on delete set null;

create index if not exists viewing_requests_seller_idx
  on viewing_requests (seller_id, visit_date, visit_time);

-- Requests sent before the column existed: link the ones for seller listings.
do $$
begin
  if not exists (select 1 from schema_migrations where id = 'viewing-seller-id-v1') then
    update viewing_requests v set seller_id = l.seller_id
      from listings l
     where v.seller_id is null
       and v.listing_id = 'listing:' || l.id::text;
    insert into schema_migrations (id) values ('viewing-seller-id-v1');
  end if;
end $$;

comment on table viewing_requests is 'Viewing requests from /book, one row per request.';

-- Buyer and seller profiles, with a photo the admin approves.
--
-- The photo lives in `media` under a profile-* slug; photo_status gates whether
-- the public people strip may render it. `kind` follows the account role.
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  kind text not null check (kind in ('buyer', 'seller')),
  display_name text not null check (char_length(display_name) between 2 and 80),
  phone text,
  company text,
  looking_for text,
  bio text check (bio is null or char_length(bio) <= 600),
  photo_slug text,
  photo_status text not null default 'none'
    check (photo_status in ('none', 'pending', 'approved', 'rejected')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists profiles_photo_status_idx on profiles (photo_status, submitted_at desc);

comment on table profiles is 'Buyer/seller profiles; photo_slug points at media and stays hidden until photo_status is approved.';

-- Password resets.
--
-- A forgotten password mails a single-use link; only the SHA-256 of that token
-- is stored, so a database dump cannot be replayed as a reset. Rows expire
-- after an hour, and using one deletes every session for the account.
create table if not exists password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists password_resets_user_idx
  on password_resets (user_id, expires_at desc);

comment on table password_resets is 'Single-use password-reset tokens; the mailed token is only stored hashed.';

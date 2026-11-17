-- KhayaPiya v1 schema (Neon Postgres)
create extension if not exists citext;
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email citext unique,
  display_name text not null check (char_length(display_name) between 1 and 40),
  password_hash text,
  default_vpa text,
  created_at timestamptz not null default now()
);
create table if not exists passkeys (
  credential_id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  public_key bytea not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists magic_tokens (
  token_hash bytea primary key,
  email citext not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
create table if not exists sessions (
  id_hash bytea primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table if not exists devices (
  id_hash bytea primary key,
  user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  kind text not null check (kind in ('flat','lunch','trip','other')),
  invite_code text unique,
  created_at timestamptz not null default now()
);
create table if not exists group_memberships (
  group_id uuid references groups(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  role text not null check (role in ('owner','editor')),
  primary key (group_id, user_id)
);
create table if not exists group_people (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  user_id uuid references users(id) on delete set null,
  vpa text,
  seat smallint not null,
  unique (group_id, seat)
);

create table if not exists rooms (
  code char(7) primary key,
  version bigint not null default 1,
  status text not null check (status in ('open','locked','final','closed')) default 'open',
  restaurant text check (char_length(restaurant) <= 60),
  vpa text,
  payee_name text,
  host_token_hash bytea not null,
  host_member_id uuid,
  printed_total_paise bigint,
  group_id uuid references groups(id) on delete set null,
  owner_user_id uuid references users(id) on delete set null,
  is_demo boolean not null default false,
  snapshot jsonb not null,
  created_ip_hash bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists rooms_expires_idx on rooms (expires_at);
create index if not exists rooms_owner_idx on rooms (owner_user_id) where owner_user_id is not null;

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  room_code char(7) not null references rooms(code) on delete cascade,
  seat smallint not null check (seat between 1 and 20),
  name text not null check (char_length(name) between 1 and 24),
  device_hash bytea,
  user_id uuid references users(id) on delete set null,
  group_person_id uuid references group_people(id) on delete set null,
  joined_at timestamptz not null default now(),
  unique (room_code, seat),
  unique (room_code, device_hash)
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  room_code char(7) not null references rooms(code) on delete cascade,
  pos smallint not null,
  name text not null check (char_length(name) between 1 and 60),
  qty smallint not null default 1 check (qty between 1 and 99),
  amount_paise bigint not null check (amount_paise >= 0),
  kind text not null check (kind in ('food','drink','other')) default 'food',
  deleted boolean not null default false
);
create index if not exists items_room_idx on items (room_code);

create table if not exists claims (
  item_id uuid references items(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  weight smallint not null default 1 check (weight between 1 and 12),
  primary key (item_id, member_id)
);

create table if not exists charges (
  id uuid primary key default gen_random_uuid(),
  room_code char(7) not null references rooms(code) on delete cascade,
  pos smallint not null,
  kind text not null check (kind in ('cgst','sgst','utgst','igst','vat','service','packing','delivery','tip','discount','roundoff','other')),
  label text not null check (char_length(label) <= 30),
  mode text not null check (mode in ('amount','percent')),
  value bigint not null,
  scope_item_ids uuid[],
  split text not null check (split in ('proportional','equal')) default 'proportional',
  included_in_prices boolean not null default false,
  removed boolean not null default false
);

create table if not exists payments (
  member_id uuid primary key references members(id) on delete cascade,
  room_code char(7) not null references rooms(code) on delete cascade,
  state text not null check (state in ('unpaid','sent','received','cash')) default 'unpaid',
  amount_paise bigint,
  sent_at timestamptz,
  confirmed_at timestamptz
);

create table if not exists ops (
  room_code char(7) not null references rooms(code) on delete cascade,
  version bigint not null,
  op_id uuid not null unique,
  member_id uuid,
  is_host boolean not null,
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (room_code, version)
);

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  room_code char(7),
  kind text not null check (kind in ('bill','settlement','expense')),
  payer_person_id uuid not null references group_people(id),
  description text check (char_length(description) <= 80),
  total_paise bigint not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create table if not exists ledger_shares (
  entry_id uuid references ledger_entries(id) on delete cascade,
  person_id uuid references group_people(id),
  owed_paise bigint not null,
  primary key (entry_id, person_id)
);
create index if not exists ledger_group_idx on ledger_entries (group_id, created_at desc);

create table if not exists rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, window_start)
);

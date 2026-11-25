-- Khata: passkey challenges, ledger links back to rooms, dish names kept after a room expires.
create table if not exists auth_challenges (
  id_hash bytea primary key,
  challenge text not null,
  kind text not null check (kind in ('reg', 'auth')),
  user_id uuid references users(id) on delete cascade,
  display_name text,
  expires_at timestamptz not null
);

alter table ledger_entries add column if not exists room_member_id uuid;
alter table ledger_entries add column if not exists dishes text check (char_length(dishes) <= 600);
create index if not exists ledger_room_member_idx on ledger_entries (room_code, room_member_id) where room_code is not null;
create index if not exists ledger_shares_person_idx on ledger_shares (person_id);
create index if not exists members_device_idx on members (device_hash) where device_hash is not null;
create index if not exists devices_user_idx on devices (user_id) where user_id is not null;
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists group_memberships_user_idx on group_memberships (user_id);

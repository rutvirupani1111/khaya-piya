-- Handing the galla to another phone: a one-time key, kept only as a hash, good for 10 minutes.
alter table rooms add column if not exists host_key_hash bytea;
alter table rooms add column if not exists host_key_expires timestamptz;

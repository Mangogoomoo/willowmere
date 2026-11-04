-- Willowmere database schema (PostgreSQL / Neon). Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS accounts (
  id          BIGSERIAL PRIMARY KEY,
  username    TEXT        NOT NULL,
  pass_hash   TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_lower ON accounts (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT        PRIMARY KEY,           -- sha256 of the token; the token itself is never stored
  account_id  BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id);

CREATE TABLE IF NOT EXISTS characters (
  id          BIGSERIAL PRIMARY KEY,
  account_id  BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slot        SMALLINT    NOT NULL CHECK (slot BETWEEN 0 AND 14),
  name        TEXT        NOT NULL,
  job         TEXT        NOT NULL DEFAULT 'novice',
  base_level  INT         NOT NULL DEFAULT 1,
  job_level   INT         NOT NULL DEFAULT 1,
  base_exp    BIGINT      NOT NULL DEFAULT 0,
  job_exp     BIGINT      NOT NULL DEFAULT 0,
  zeny        BIGINT      NOT NULL DEFAULT 500,
  hp          INT,
  sp          INT,
  stats       JSONB       NOT NULL DEFAULT '{}',
  stat_points INT         NOT NULL DEFAULT 0,
  appearance  JSONB       NOT NULL DEFAULT '{}',
  map         TEXT        NOT NULL DEFAULT 'meadow',
  x           REAL,
  z           REAL,
  facing      REAL,
  save_point  JSONB,
  skills      JSONB       NOT NULL DEFAULT '{}',
  hotbar      JSONB       NOT NULL DEFAULT '[]',
  extra       JSONB       NOT NULL DEFAULT '{}',   -- quests, job history, memos, prefs...
  is_new      BOOLEAN     NOT NULL DEFAULT true,  -- created but never played yet
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, slot)
);
CREATE UNIQUE INDEX IF NOT EXISTS characters_name_lower ON characters (lower(name));

-- Items a character carries: in the bag, equipped, or in the merchant cart.
CREATE TABLE IF NOT EXISTS character_items (
  id           BIGSERIAL PRIMARY KEY,
  character_id BIGINT   NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  location     TEXT     NOT NULL CHECK (location IN ('bag', 'equip', 'cart')),
  equip_slot   TEXT,
  item_id      TEXT     NOT NULL,
  qty          INT      NOT NULL CHECK (qty > 0),
  refine       SMALLINT NOT NULL DEFAULT 0,
  cards        TEXT[]   NOT NULL DEFAULT '{}',
  forged_by    TEXT,
  element      TEXT,
  sort         INT      NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS character_items_char ON character_items (character_id);

-- Storage is shared by every character on the account, like the classics.
CREATE TABLE IF NOT EXISTS storage_items (
  id          BIGSERIAL PRIMARY KEY,
  account_id  BIGINT   NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id     TEXT     NOT NULL,
  qty         INT      NOT NULL CHECK (qty > 0),
  refine      SMALLINT NOT NULL DEFAULT 0,
  cards       TEXT[]   NOT NULL DEFAULT '{}',
  forged_by   TEXT,
  element     TEXT,
  sort        INT      NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS storage_items_account ON storage_items (account_id);

-- Reference data, filled from the game's data files when the server starts.
CREATE TABLE IF NOT EXISTS item_defs (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  type  TEXT NOT NULL,
  data  JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS monster_defs (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  level    INT  NOT NULL,
  hp       INT  NOT NULL,
  element  TEXT,
  data     JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS monster_spawns (
  map         TEXT NOT NULL,
  monster_id  TEXT NOT NULL,
  x REAL NOT NULL, z REAL NOT NULL, r REAL NOT NULL,
  count INT NOT NULL,
  PRIMARY KEY (map, monster_id, x, z)
);

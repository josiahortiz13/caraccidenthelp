-- CrashHelp TX response engine schema (Postgres). Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS leads (
  lead_id                 TEXT PRIMARY KEY,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  source                  TEXT,
  campaign                TEXT,
  ad_id                   TEXT,
  keyword                 TEXT,
  utm_source              TEXT,
  utm_medium              TEXT,
  utm_campaign            TEXT,
  utm_content             TEXT,
  utm_term                TEXT,
  gclid                   TEXT,
  fbclid                  TEXT,
  landing_page            TEXT,
  referrer                TEXT,
  first_name              TEXT,
  last_name               TEXT,
  phone                   TEXT,
  email                   TEXT,
  crash_date              DATE,
  crash_city              TEXT,
  crash_county            TEXT,
  person_type             TEXT,
  injury_status           TEXT,
  medical_status          TEXT,
  vehicle_damage          TEXT,
  other_vehicle           TEXT,
  insurance_available     TEXT,
  description             TEXT,
  preferred_contact       TEXT,
  contact_consent         BOOLEAN NOT NULL DEFAULT false,
  marketing_consent       BOOLEAN NOT NULL DEFAULT false,
  consent_text            TEXT,
  lead_priority           TEXT NOT NULL DEFAULT 'NORMAL PRIORITY',
  lead_status             TEXT NOT NULL DEFAULT 'NEW',
  assigned_to             TEXT,
  duplicate_of            TEXT,
  crm_contact_id          TEXT,
  crm_opportunity_id      TEXT,
  sms_opt_out             BOOLEAN NOT NULL DEFAULT false,
  sms_opt_out_at          TIMESTAMPTZ,
  first_alert_at          TIMESTAMPTZ,
  first_response_at       TIMESTAMPTZ,   -- first contact attempt by a human
  first_contact_at        TIMESTAMPTZ,   -- marked CONTACTED / call connected
  last_contact_at         TIMESTAMPTZ,
  appointment_at          TIMESTAMPTZ,
  appointment_status      TEXT,
  referral_status         TEXT,
  escalation_level        INT NOT NULL DEFAULT 0,
  backup_call_due_at      TIMESTAMPTZ,
  notes                   TEXT
);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS callback_requested BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_note TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS callback_window TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_callback_task_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_callback_task_done BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_followup_task_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_followup_task_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_dnd_synced BOOLEAN NOT NULL DEFAULT false;
-- TCPA consent proof, captured server-side when the consent box is checked.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_ip TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_page_url TEXT;
CREATE INDEX IF NOT EXISTS leads_phone_idx   ON leads (phone);
CREATE INDEX IF NOT EXISTS leads_email_idx   ON leads (lower(email));
CREATE INDEX IF NOT EXISTS leads_status_idx  ON leads (lead_status);
CREATE INDEX IF NOT EXISTS leads_created_idx ON leads (created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id        BIGSERIAL PRIMARY KEY,
  lead_id   TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  type      TEXT NOT NULL,
  actor     TEXT NOT NULL DEFAULT 'system',
  detail    JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS events_lead_idx ON events (lead_id, at);

CREATE TABLE IF NOT EXISTS messages (
  id          BIGSERIAL PRIMARY KEY,
  sid         TEXT UNIQUE,
  lead_id     TEXT,
  direction   TEXT NOT NULL,          -- outbound | inbound
  kind        TEXT,                   -- consumer | internal
  purpose     TEXT,
  to_number   TEXT,
  from_number TEXT,
  body        TEXT,
  status      TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calls (
  id          BIGSERIAL PRIMARY KEY,
  sid         TEXT UNIQUE,
  lead_id     TEXT,
  direction   TEXT NOT NULL,
  purpose     TEXT,                   -- owner_alert | backup_alert | staff_bridge | inbound | escalation
  to_number   TEXT,
  from_number TEXT,
  status      TEXT,
  answered_by TEXT,
  duration    INT,
  connected   BOOLEAN NOT NULL DEFAULT false,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opt_outs (
  phone        TEXT PRIMARY KEY,
  keyword      TEXT,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sms_sessions (
  phone      TEXT PRIMARY KEY,
  step       TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS crm_queue (
  id         BIGSERIAL PRIMARY KEY,
  lead_id    TEXT NOT NULL,
  reason     TEXT,
  attempts   INT NOT NULL DEFAULT 0,
  next_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  done       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit (
  id      BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  lead_id TEXT,
  detail  JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  count        INT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_status (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Owner-entered monthly figures for reporting: ad spend, verified revenue, expenses, and
-- traffic totals copied from Google Analytics / Meta Ads. Nothing here is estimated by the app.
CREATE TABLE IF NOT EXISTS ledger (
  id          BIGSERIAL PRIMARY KEY,
  month       DATE NOT NULL,              -- first day of the month
  kind        TEXT NOT NULL,              -- ad_spend | revenue | expense | visitors | ad_clicks
  channel     TEXT NOT NULL DEFAULT 'other', -- meta | google | other
  amount      NUMERIC(12,2) NOT NULL,
  note        TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Accident report uploads ("Your Crash Report, Explained"). Personal data lives here only until
-- delete_after (30 days, or 180 days once the person asks for an attorney review); then files are
-- removed from storage and the row keeps only ids and timestamps.
CREATE TABLE IF NOT EXISTS report_cases (
  case_id             TEXT PRIMARY KEY,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  token_hash          TEXT NOT NULL,             -- sha256 of the visitor's private link token
  lang                TEXT NOT NULL DEFAULT 'en',
  status              TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | ANALYZING | READY | FAILED | DELETED
  consent_text        TEXT NOT NULL,
  consent_at          TIMESTAMPTZ NOT NULL,
  ip_hash             TEXT,
  description         TEXT,
  analysis            JSONB,
  analysis_model      TEXT,
  analysis_at         TIMESTAMPTZ,
  analysis_error      TEXT,
  review_requested_at TIMESTAMPTZ,
  review_consent_text TEXT,
  lead_id             TEXT,
  delete_after        TIMESTAMPTZ NOT NULL,
  deleted_at          TIMESTAMPTZ,
  deleted_by          TEXT
);
CREATE INDEX IF NOT EXISTS report_cases_purge_idx ON report_cases (delete_after) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS report_files (
  file_id      TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL REFERENCES report_cases(case_id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  pathname     TEXT NOT NULL,
  name         TEXT,
  content_type TEXT NOT NULL,
  size_bytes   BIGINT NOT NULL,
  kind         TEXT NOT NULL,                     -- document | photo | video
  status       TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING | CLEAN | REJECTED | DELETED
  scan_level   TEXT,
  scan_detail  TEXT,
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS report_files_case_idx ON report_files (case_id);

-- Crash Radar: freeway crashes from the public Houston TranStar feed. No personal data: the feed has
-- road, direction, cross street, lanes and status only. One row per TranStar incident number.
CREATE TABLE IF NOT EXISTS radar_incidents (
  source           TEXT NOT NULL,
  incident_id      TEXT NOT NULL,
  title            TEXT,
  road             TEXT,
  direction        TEXT,
  cross_street     TEXT,
  types            TEXT,
  is_truck         BOOLEAN NOT NULL DEFAULT false,
  severity         TEXT NOT NULL DEFAULT 'UNKNOWN', -- MAJOR | MINOR | UNKNOWN (CrashHelp rule from lanes affected)
  lanes_text       TEXT,
  status           TEXT NOT NULL,                   -- ACTIVE | CLEARED | UNKNOWN
  feed_status      TEXT,                            -- detected | verified | cleared (as the feed says)
  status_text      TEXT,
  source_status_at TIMESTAMPTZ,                     -- the feed's own time for the current status
  first_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT now(),
  gone_at          TIMESTAMPTZ,                     -- dropped off the feed without a Cleared entry
  cleared_at       TIMESTAMPTZ,
  alerted_at       TIMESTAMPTZ,
  baseline         BOOLEAN NOT NULL DEFAULT false,  -- already on the feed at first run: never alerted, not listed
  PRIMARY KEY (source, incident_id)
);
CREATE INDEX IF NOT EXISTS radar_incidents_seen_idx ON radar_incidents (first_seen DESC);

CREATE TABLE IF NOT EXISTS radar_events (
  id               BIGSERIAL PRIMARY KEY,
  source           TEXT NOT NULL,
  incident_id      TEXT NOT NULL,
  at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  status           TEXT NOT NULL,
  text             TEXT,
  source_status_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS radar_events_incident_idx ON radar_events (source, incident_id);

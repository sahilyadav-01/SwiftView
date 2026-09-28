BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug citext NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'locked', 'disabled')),
  mfa_required boolean NOT NULL DEFAULT false,
  token_version integer NOT NULL DEFAULT 1,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (password_hash IS NULL OR length(password_hash) >= 32)
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('super_admin', 'admin', 'it_manager', 'technician', 'viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS device_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  group_id uuid REFERENCES device_groups(id) ON DELETE SET NULL,
  public_id varchar(14) NOT NULL,
  name text NOT NULL,
  hostname text NOT NULL,
  platform text NOT NULL,
  os_version text,
  agent_version text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'online', 'offline', 'disabled', 'revoked')),
  unattended_enabled boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (organization_id, public_id)
);

CREATE TABLE IF NOT EXISTS device_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  algorithm text NOT NULL DEFAULT 'Ed25519' CHECK (algorithm IN ('Ed25519', 'P-256')),
  public_key bytea NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotated', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (device_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  family_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  ip_address inet,
  user_agent text
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  technician_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested', 'approved', 'rejected', 'connecting', 'connected',
    'reconnecting', 'ended', 'expired', 'failed'
  )),
  access_mode text NOT NULL CHECK (access_mode IN ('attended', 'unattended')),
  route text CHECK (route IN ('direct', 'relay')),
  relay_region text,
  request_ip inet,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz NOT NULL,
  end_reason text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid()
);

CREATE TABLE IF NOT EXISTS session_permissions (
  session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  screen boolean NOT NULL DEFAULT true,
  mouse boolean NOT NULL DEFAULT false,
  keyboard boolean NOT NULL DEFAULT false,
  clipboard_read boolean NOT NULL DEFAULT false,
  clipboard_write boolean NOT NULL DEFAULT false,
  file_upload boolean NOT NULL DEFAULT false,
  file_download boolean NOT NULL DEFAULT false,
  remote_restart boolean NOT NULL DEFAULT false,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS file_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('upload_to_device', 'download_from_device')),
  file_name text NOT NULL,
  relative_path text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 char(64) NOT NULL,
  bytes_transferred bigint NOT NULL DEFAULT 0 CHECK (bytes_transferred >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'completed', 'cancelled', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (bytes_transferred <= size_bytes),
  CHECK (relative_path !~ '(^|[\\/])\.\.([\\/]|$)')
);

CREATE TABLE IF NOT EXISTS relay_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region text NOT NULL,
  hostname text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draining', 'offline')),
  weight integer NOT NULL DEFAULT 100 CHECK (weight BETWEEN 0 AND 1000),
  last_health_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'device', 'system')),
  actor_id uuid,
  device_id uuid REFERENCES devices(id) ON DELETE RESTRICT,
  session_id uuid REFERENCES sessions(id) ON DELETE RESTRICT,
  action text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  ip_address inet,
  correlation_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devices_org_status ON devices (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_org_requested ON sessions (organization_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_device_status ON sessions (device_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_technician ON sessions (technician_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_transfers_session ON file_transfers (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_events (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_events (session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id, expires_at);

COMMIT;


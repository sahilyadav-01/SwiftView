-- =============================================================================
-- S'K Remote Support / SwiftView — Supabase Production Schema
-- Designed for Supabase PostgreSQL with Row Level Security (RLS) & Realtime
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- 1. Organizations (Multi-Tenancy)
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug citext NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. User Profiles (Synced with Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email citext NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'locked', 'disabled')),
  mfa_required boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Organization Memberships (RBAC)
CREATE TABLE IF NOT EXISTS public.organization_memberships (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('super_admin', 'admin', 'it_manager', 'technician', 'viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

-- 4. Device Groups
CREATE TABLE IF NOT EXISTS public.device_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

-- 5. Devices (Managed Fleet)
CREATE TABLE IF NOT EXISTS public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.device_groups(id) ON DELETE SET NULL,
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

-- 6. Device Cryptographic Keys
CREATE TABLE IF NOT EXISTS public.device_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  algorithm text NOT NULL DEFAULT 'Ed25519' CHECK (algorithm IN ('Ed25519', 'P-256')),
  public_key bytea NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotated', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (device_id, fingerprint)
);

-- 7. Sessions (Remote Support Connections)
CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
  technician_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
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

-- 8. Session Granular Permissions
CREATE TABLE IF NOT EXISTS public.session_permissions (
  session_id uuid PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
  screen boolean NOT NULL DEFAULT true,
  mouse boolean NOT NULL DEFAULT false,
  keyboard boolean NOT NULL DEFAULT false,
  clipboard_read boolean NOT NULL DEFAULT false,
  clipboard_write boolean NOT NULL DEFAULT false,
  file_upload boolean NOT NULL DEFAULT false,
  file_download boolean NOT NULL DEFAULT false,
  remote_restart boolean NOT NULL DEFAULT false,
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at timestamptz,
  version integer NOT NULL DEFAULT 1
);

-- 9. File Transfers
CREATE TABLE IF NOT EXISTS public.file_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('upload_to_device', 'download_from_device')),
  file_name text NOT NULL,
  relative_path text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 char(64) NOT NULL,
  bytes_transferred bigint NOT NULL DEFAULT 0 CHECK (bytes_transferred >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'completed', 'cancelled', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- 10. Audit Events (Immutable Security Log)
CREATE TABLE IF NOT EXISTS public.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'device', 'system')),
  actor_id uuid,
  device_id uuid REFERENCES public.devices(id) ON DELETE RESTRICT,
  session_id uuid REFERENCES public.sessions(id) ON DELETE RESTRICT,
  action text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  ip_address inet,
  correlation_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for high-performance fleet queries
CREATE INDEX IF NOT EXISTS idx_devices_org_status ON public.devices (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON public.devices (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_org_requested ON public.sessions (organization_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_device_status ON public.sessions (device_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_technician ON public.sessions (technician_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_org_time ON public.audit_events (organization_id, occurred_at DESC);

-- =============================================================================
-- Trigger: Synchronize Supabase auth.users to public.profiles
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      updated_at = now();
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- =============================================================================
-- Row Level Security (RLS) Policies
-- =============================================================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Helper to check user membership in an organization
CREATE OR REPLACE FUNCTION public.is_member_of(_org_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_memberships
    WHERE organization_id = _org_id AND user_id = auth.uid() AND status = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Profiles: users read active profiles, edit own profile
CREATE POLICY "Users can view profiles in their organizations"
  ON public.profiles FOR SELECT
  USING (
    id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.organization_memberships m1
      JOIN public.organization_memberships m2 ON m1.organization_id = m2.organization_id
      WHERE m1.user_id = auth.uid() AND m2.user_id = public.profiles.id
    )
  );

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid());

-- Devices: members can view their organization's devices
CREATE POLICY "Members can view organization devices"
  ON public.devices FOR SELECT
  USING (public.is_member_of(organization_id));

-- Sessions: members can view sessions for their organization
CREATE POLICY "Members can view organization sessions"
  ON public.sessions FOR SELECT
  USING (public.is_member_of(organization_id));

CREATE POLICY "Technicians can create sessions in their organization"
  ON public.sessions FOR INSERT
  WITH CHECK (public.is_member_of(organization_id) AND technician_id = auth.uid());

-- Fides: esquema canónico de la versión local dockerizada.
-- Toda fila pertenece a una Organización, salvo las identidades globales.

CREATE SCHEMA IF NOT EXISTS fides;
SET search_path TO fides, public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Organizaciones y capacidades comerciales
-- ---------------------------------------------------------------------------

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  seat_limit INTEGER NOT NULL DEFAULT 10 CHECK (seat_limit > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Servicio contractual base más las dos únicas capacidades adicionales
-- (`ai_review`, `active_custody`) y las categorías de evidencia habilitadas.
CREATE TABLE commercial_entitlements (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  capability TEXT NOT NULL CHECK (
    capability IN ('ai_review', 'active_custody', 'evidence_video', 'evidence_ine')
  ),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, capability)
);

-- Configuración predeterminada de emisión, versionada por operación.
CREATE TABLE organization_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  operational_version INTEGER NOT NULL DEFAULT 1,
  default_link_days INTEGER NOT NULL DEFAULT 7
    CHECK (default_link_days BETWEEN 1 AND 30),
  default_requires_video BOOLEAN NOT NULL DEFAULT FALSE,
  default_requires_ine BOOLEAN NOT NULL DEFAULT FALSE,
  default_review_policy TEXT NOT NULL DEFAULT 'none'
    CHECK (default_review_policy IN ('none', 'manual', 'ai')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

-- ---------------------------------------------------------------------------
-- Cuentas individuales, membresías, invitaciones y sesiones
-- ---------------------------------------------------------------------------

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_legal_publisher BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret TEXT,
  totp_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  roles TEXT[] NOT NULL CHECK (
    array_length(roles, 1) >= 1
    AND roles <@ ARRAY['administrator', 'emitter', 'reviewer']::TEXT[]
  ),
  is_primary_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, account_id)
);

CREATE UNIQUE INDEX organization_members_one_primary_admin
  ON organization_members (organization_id)
  WHERE is_primary_admin;

CREATE TABLE member_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  roles TEXT[] NOT NULL CHECK (
    array_length(roles, 1) >= 1
    AND roles <@ ARRAY['administrator', 'emitter', 'reviewer']::TEXT[]
  ),
  -- `prepared`, `invited`, `expired`, `revoked`, `active`
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'invited', 'expired', 'revoked', 'active')),
  token_hash TEXT,
  sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un solo registro pendiente por correo dentro de cada Organización.
CREATE UNIQUE INDEX member_invitations_one_pending_per_email
  ON member_invitations (organization_id, lower(email))
  WHERE status IN ('prepared', 'invited', 'expired');

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  active_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  totp_satisfied BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Contenido jurídico publicado por el Publicador de contenido jurídico
-- ---------------------------------------------------------------------------

CREATE TABLE contract_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  base_model TEXT,
  acceptance_legend TEXT NOT NULL,
  video_statement_template TEXT NOT NULL DEFAULT '',
  default_link_days INTEGER NOT NULL DEFAULT 7
    CHECK (default_link_days BETWEEN 1 AND 30),
  default_requires_video BOOLEAN NOT NULL DEFAULT FALSE,
  default_requires_ine BOOLEAN NOT NULL DEFAULT FALSE,
  default_review_policy TEXT NOT NULL DEFAULT 'none'
    CHECK (default_review_policy IN ('none', 'manual', 'ai')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE TABLE contract_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES contract_templates(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  help_text TEXT NOT NULL DEFAULT '',
  data_type TEXT NOT NULL
    CHECK (data_type IN ('text', 'longtext', 'number', 'money', 'date', 'select')),
  required BOOLEAN NOT NULL DEFAULT TRUE,
  options JSONB NOT NULL DEFAULT '[]'::JSONB,
  searchable BOOLEAN NOT NULL DEFAULT FALSE,
  highlighted BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (template_id, key)
);

CREATE TABLE contract_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES contract_templates(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  markdown TEXT NOT NULL,
  markdown_hash TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by UUID REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX contract_template_versions_one_current
  ON contract_template_versions (template_id)
  WHERE is_current;

CREATE TABLE privacy_notice_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  simplified_markdown TEXT NOT NULL,
  full_markdown TEXT NOT NULL,
  notice_hash TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by UUID REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX privacy_notice_versions_one_current
  ON privacy_notice_versions (organization_id)
  WHERE is_current;

-- ---------------------------------------------------------------------------
-- Directorio de contrapartes y carpetas operativas
-- ---------------------------------------------------------------------------

CREATE TABLE counterparties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_kind TEXT NOT NULL CHECK (person_kind IN ('fisica', 'moral')),
  name TEXT NOT NULL,
  rfc TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  position TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX counterparties_organization_idx
  ON counterparties (organization_id, active, lower(name));

CREATE TABLE contract_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

-- ---------------------------------------------------------------------------
-- Borradores y Contratos emitidos
-- ---------------------------------------------------------------------------

CREATE TABLE contract_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES contract_templates(id) ON DELETE CASCADE,
  created_by UUID REFERENCES accounts(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  holder_counterparty_id UUID REFERENCES counterparties(id) ON DELETE SET NULL,
  signer_counterparty_id UUID REFERENCES counterparties(id) ON DELETE SET NULL,
  field_values JSONB NOT NULL DEFAULT '{}'::JSONB,
  folder_id UUID REFERENCES contract_folders(id) ON DELETE SET NULL,
  link_days INTEGER NOT NULL DEFAULT 7 CHECK (link_days BETWEEN 1 AND 30),
  requires_video BOOLEAN NOT NULL DEFAULT FALSE,
  requires_ine BOOLEAN NOT NULL DEFAULT FALSE,
  review_policy TEXT NOT NULL DEFAULT 'none'
    CHECK (review_policy IN ('none', 'manual', 'ai')),
  defaults_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  customized BOOLEAN NOT NULL DEFAULT FALSE,
  origin_contract_id UUID,
  classification TEXT NOT NULL DEFAULT 'active'
    CHECK (classification IN ('active', 'deleted')),
  issued_contract_id UUID,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  template_id UUID NOT NULL REFERENCES contract_templates(id) ON DELETE RESTRICT,
  template_version_id UUID NOT NULL
    REFERENCES contract_template_versions(id) ON DELETE RESTRICT,
  template_name TEXT NOT NULL,
  template_label TEXT NOT NULL,
  privacy_notice_version_id UUID NOT NULL
    REFERENCES privacy_notice_versions(id) ON DELETE RESTRICT,
  -- `draft` no vive aquí: un Contrato existe sólo después de `Generar enlace`.
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'in_review', 'accepted', 'expired', 'cancelled')),
  contract_markdown TEXT NOT NULL,
  field_values JSONB NOT NULL DEFAULT '{}'::JSONB,
  document_hash TEXT NOT NULL,
  acceptance_legend TEXT NOT NULL,
  video_statement TEXT NOT NULL DEFAULT '',
  link_days INTEGER NOT NULL CHECK (link_days BETWEEN 1 AND 30),
  requires_video BOOLEAN NOT NULL DEFAULT FALSE,
  requires_ine BOOLEAN NOT NULL DEFAULT FALSE,
  review_policy TEXT NOT NULL CHECK (review_policy IN ('none', 'manual', 'ai')),
  defaults_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  customized BOOLEAN NOT NULL DEFAULT FALSE,
  folder_id UUID REFERENCES contract_folders(id) ON DELETE SET NULL,
  classification TEXT NOT NULL DEFAULT 'active'
    CHECK (classification IN ('active', 'archived', 'deleted')),
  created_by UUID REFERENCES accounts(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  -- Relación técnica de origen, visible sólo para el Administrador de plataforma.
  origin_contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL,
  origin_reason TEXT CHECK (origin_reason IN ('duplicate', 'successor')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  closed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  search_text TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, reference)
);

CREATE INDEX contracts_org_classification_idx
  ON contracts (organization_id, classification, issued_at DESC);
CREATE INDEX contracts_org_status_idx ON contracts (organization_id, status);

CREATE TABLE contract_reference_sequences (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, day)
);

CREATE TABLE contract_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  party_role TEXT NOT NULL CHECK (party_role IN ('holder', 'signer')),
  source_counterparty_id UUID REFERENCES counterparties(id) ON DELETE SET NULL,
  person_kind TEXT NOT NULL CHECK (person_kind IN ('fisica', 'moral')),
  name TEXT NOT NULL,
  rfc TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  position TEXT,
  snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, party_role)
);

-- ---------------------------------------------------------------------------
-- Intentos de aceptación, enlaces, eventos y evidencia
-- ---------------------------------------------------------------------------

CREATE TABLE acceptance_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_review', 'accepted', 'repeated', 'expired', 'cancelled')),
  walked_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  replaces_attempt_id UUID REFERENCES acceptance_attempts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, sequence)
);

CREATE TABLE contract_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL REFERENCES acceptance_attempts(id) ON DELETE CASCADE,
  -- El token vive en servidor para que la Organización pueda `Copiar enlace`.
  -- Nunca aparece en el PDF, la Referencia contractual o una exportación.
  token TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  first_opened_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE contract_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  attempt_id UUID REFERENCES acceptance_attempts(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  actor_kind TEXT NOT NULL
    CHECK (actor_kind IN ('member', 'signer', 'platform', 'system')),
  actor_id UUID,
  actor_name TEXT NOT NULL DEFAULT '',
  sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX contract_events_contract_idx
  ON contract_events (contract_id, created_at);

CREATE TABLE evidence_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES acceptance_attempts(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('acceptance', 'ine_front', 'ine_back', 'video')),
  object_key TEXT,
  content_type TEXT NOT NULL DEFAULT 'application/json',
  byte_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attempt_id, kind)
);

CREATE TABLE ai_review_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES acceptance_attempts(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  configuration_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  transcript TEXT NOT NULL DEFAULT '',
  expected_statement TEXT NOT NULL DEFAULT '',
  findings JSONB NOT NULL DEFAULT '[]'::JSONB,
  confidence NUMERIC(4, 3),
  limitations TEXT NOT NULL DEFAULT '',
  recommendation TEXT
    CHECK (recommendation IN ('accept', 'repeat', 'inconclusive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Bandeja de revisión y decisiones
-- ---------------------------------------------------------------------------

CREATE TABLE review_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL UNIQUE REFERENCES acceptance_attempts(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'closed_without_decision')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE review_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES review_tasks(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL REFERENCES acceptance_attempts(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reviewer_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  reviewer_name TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('conclude', 'skip', 'repeat')),
  reason_code TEXT,
  reason_text TEXT,
  followed_ai_recommendation BOOLEAN,
  successor_attempt_id UUID REFERENCES acceptance_attempts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Registro de contacto externo posterior a `Repetir proceso`.
CREATE TABLE external_contact_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  attempt_id UUID REFERENCES acceptance_attempts(id) ON DELETE SET NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  note TEXT,
  recorded_by UUID REFERENCES accounts(id) ON DELETE SET NULL,
  recorded_by_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Objetos, custodia y trabajos
-- ---------------------------------------------------------------------------

CREATE TABLE contract_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('accepted_pdf', 'evidence', 'cold_package', 'temporary_copy')),
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'immediate'
    CHECK (tier IN ('immediate', 'cold', 'temporary')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX contract_objects_contract_idx ON contract_objects (contract_id, kind);

CREATE TABLE cold_contract_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  manifest JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- `immediate` mientras la Custodia activa lo conserve accesible; `cold` en Archivo Muerto.
  tier TEXT NOT NULL DEFAULT 'cold' CHECK (tier IN ('immediate', 'cold')),
  closed_at TIMESTAMPTZ NOT NULL,
  moved_to_cold_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE recovery_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES accounts(id) ON DELETE SET NULL,
  requested_by_name TEXT NOT NULL,
  -- `standard` con Custodia activa, `bulk` sin ella (solicitud externa).
  retrieval_tier TEXT NOT NULL CHECK (retrieval_tier IN ('standard', 'bulk')),
  origin TEXT NOT NULL CHECK (origin IN ('portal', 'external')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'available', 'failed', 'expired')),
  object_key TEXT,
  available_until TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES accounts(id) ON DELETE SET NULL,
  requested_by_name TEXT NOT NULL,
  contract_ids UUID[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'available', 'failed', 'expired')),
  object_key TEXT,
  available_until TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Operación: auditoría, outbox y trabajos de fondo
-- ---------------------------------------------------------------------------

CREATE TABLE audit_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  actor_kind TEXT NOT NULL DEFAULT 'member'
    CHECK (actor_kind IN ('member', 'platform', 'signer', 'system')),
  capability TEXT,
  action TEXT NOT NULL,
  subject_type TEXT NOT NULL DEFAULT '',
  subject_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_entries_org_idx ON audit_entries (organization_id, created_at DESC);

-- Outbox: la aplicación nunca contacta a un proveedor externo de forma directa.
CREATE TABLE notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  recipient TEXT NOT NULL,
  template TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  dedupe_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX notification_outbox_pending_idx
  ON notification_outbox (status, available_at);

CREATE TABLE background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  dedupe_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX background_jobs_pending_idx ON background_jobs (status, run_after);

CREATE TABLE legal_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_by UUID REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ
);

CREATE TABLE retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  retention_months INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, category)
);

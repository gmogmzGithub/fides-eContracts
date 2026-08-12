SET search_path TO fides, public;

-- Preferencias simples de entrega para la actividad contractual. Los destinos
-- pertenecen a la Organizacion; el worker sigue siendo el unico que contacta
-- al proveedor de correo o WhatsApp.
ALTER TABLE organization_settings
  ADD COLUMN alert_email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN alert_email_recipient TEXT,
  ADD COLUMN alert_whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN alert_whatsapp_recipient TEXT;

ALTER TABLE organization_settings
  ADD CONSTRAINT organization_settings_alert_email_recipient_check
    CHECK (NOT alert_email_enabled OR NULLIF(BTRIM(alert_email_recipient), '') IS NOT NULL),
  ADD CONSTRAINT organization_settings_alert_whatsapp_recipient_check
    CHECK (NOT alert_whatsapp_enabled OR NULLIF(BTRIM(alert_whatsapp_recipient), '') IS NOT NULL);

-- Favoritos personales: un Miembro no cambia la vista de sus companeros.
CREATE TABLE contract_favorites (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contract_id, account_id)
);

CREATE INDEX contract_favorites_account_idx
  ON contract_favorites (organization_id, account_id, created_at DESC);

CREATE INDEX contract_events_organization_recent_idx
  ON contract_events (organization_id, created_at DESC);

-- `reuse` identifica un Borrador creado desde Recientes. La relacion sigue
-- siendo tecnica y nunca presenta un Contrato como version de otro.
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_origin_reason_check;
ALTER TABLE contracts
  ADD CONSTRAINT contracts_origin_reason_check
    CHECK (origin_reason IN ('duplicate', 'successor', 'reuse'));

-- INE y video forman parte del Servicio contractual base para todas las
-- Organizaciones. Se conservan las filas históricas por compatibilidad, pero
-- dejan de representar capacidades comerciales opcionales.
SET search_path TO fides, public;

INSERT INTO commercial_entitlements (organization_id, capability, enabled)
SELECT organization.id, capability.name, TRUE
FROM organizations organization
CROSS JOIN (VALUES ('evidence_video'), ('evidence_ine')) capability(name)
ON CONFLICT (organization_id, capability)
DO UPDATE SET enabled = TRUE, updated_at = NOW();

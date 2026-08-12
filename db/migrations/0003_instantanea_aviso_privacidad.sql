-- Cada Contrato conserva el Aviso exacto presentado al emitirlo. La referencia
-- a la publicación sigue siendo útil para trazabilidad, pero el expediente no
-- depende de que esa fila continúe disponible o permanezca sin cambios.
SET search_path TO fides, public;

ALTER TABLE contracts
  ADD COLUMN privacy_notice_label TEXT,
  ADD COLUMN privacy_notice_simplified_markdown TEXT,
  ADD COLUMN privacy_notice_full_markdown TEXT,
  ADD COLUMN privacy_notice_hash TEXT,
  ADD COLUMN privacy_notice_published_at TIMESTAMPTZ;

UPDATE contracts c
SET privacy_notice_label = p.label,
    privacy_notice_simplified_markdown = p.simplified_markdown,
    privacy_notice_full_markdown = p.full_markdown,
    privacy_notice_hash = p.notice_hash,
    privacy_notice_published_at = p.published_at
FROM privacy_notice_versions p
WHERE p.id = c.privacy_notice_version_id;

ALTER TABLE contracts
  ALTER COLUMN privacy_notice_label SET NOT NULL,
  ALTER COLUMN privacy_notice_simplified_markdown SET NOT NULL,
  ALTER COLUMN privacy_notice_full_markdown SET NOT NULL,
  ALTER COLUMN privacy_notice_hash SET NOT NULL,
  ALTER COLUMN privacy_notice_published_at SET NOT NULL;

ALTER TABLE contracts
  ADD CONSTRAINT contracts_privacy_notice_snapshot_complete
  CHECK (
    btrim(privacy_notice_label) <> ''
    AND btrim(privacy_notice_simplified_markdown) <> ''
    AND btrim(privacy_notice_full_markdown) <> ''
    AND privacy_notice_hash ~ '^[0-9a-f]{64}$'
  );

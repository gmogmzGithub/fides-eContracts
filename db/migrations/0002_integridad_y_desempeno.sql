-- Fides · migración 0002: integridad y desempeño.
--
-- Es estrictamente aditiva. No reescribe `0001_fides.sql` ni cambia el
-- comportamiento de la aplicación: sólo lleva a la base invariantes que hoy
-- viven únicamente en el código, y crea los índices que faltan para los
-- caminos de acceso reales (buscador, bandeja de revisión, outbox, cola de
-- trabajos, enlaces por hash, auditoría y Archivo Muerto).
--
-- Cada `CHECK` es una implicación en un solo sentido, satisfecha por todas las
-- rutas de escritura existentes, para que un Contrato archivado y después
-- eliminado siga siendo válido.

SET search_path TO fides, public;

-- `search_text` y `reference` se consultan con `ILIKE '%…%'`: sin trigramas
-- ningún índice puede usarse y el buscador degenera en recorrido secuencial.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. Identidad, acceso e invitaciones
-- ---------------------------------------------------------------------------

-- Toda búsqueda de Cuenta usa `lower(email)`; sin este índice el correo era
-- único distinguiendo mayúsculas y cada inicio de sesión recorría la tabla.
CREATE UNIQUE INDEX accounts_email_lower_key ON accounts (lower(email));

-- El enlace de Invitación de Miembro se resuelve por hash; el `token_hash` se
-- vacía al activar o revocar, así que el índice es parcial.
CREATE UNIQUE INDEX member_invitations_token_hash_key
  ON member_invitations (token_hash)
  WHERE token_hash IS NOT NULL;

CREATE INDEX member_invitations_organization_idx
  ON member_invitations (organization_id, created_at DESC);

CREATE INDEX organization_members_account_idx
  ON organization_members (account_id);

-- `'reviewer' = ANY(roles)` al alertar por recomendación AI.
CREATE INDEX organization_members_roles_idx
  ON organization_members USING GIN (roles);

CREATE INDEX sessions_account_idx ON sessions (account_id);
CREATE INDEX password_resets_account_idx ON password_resets (account_id);

-- ---------------------------------------------------------------------------
-- 2. Llaves compuestas: una fila nunca puede cruzar de Organización
-- ---------------------------------------------------------------------------

ALTER TABLE contracts
  ADD CONSTRAINT contracts_id_organization_key UNIQUE (id, organization_id);
ALTER TABLE contract_folders
  ADD CONSTRAINT contract_folders_id_organization_key UNIQUE (id, organization_id);
ALTER TABLE contract_templates
  ADD CONSTRAINT contract_templates_id_organization_key UNIQUE (id, organization_id);
ALTER TABLE counterparties
  ADD CONSTRAINT counterparties_id_organization_key UNIQUE (id, organization_id);
ALTER TABLE acceptance_attempts
  ADD CONSTRAINT acceptance_attempts_id_contract_key UNIQUE (id, contract_id);

-- El Contrato apunta a plantilla y carpeta de su propia Organización.
ALTER TABLE contracts
  ADD CONSTRAINT contracts_template_organization_fk
    FOREIGN KEY (template_id, organization_id)
    REFERENCES contract_templates (id, organization_id) ON DELETE RESTRICT,
  ADD CONSTRAINT contracts_folder_organization_fk
    FOREIGN KEY (folder_id, organization_id)
    REFERENCES contract_folders (id, organization_id)
    ON DELETE SET NULL (folder_id);

ALTER TABLE contract_drafts
  ADD CONSTRAINT contract_drafts_template_organization_fk
    FOREIGN KEY (template_id, organization_id)
    REFERENCES contract_templates (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT contract_drafts_folder_organization_fk
    FOREIGN KEY (folder_id, organization_id)
    REFERENCES contract_folders (id, organization_id)
    ON DELETE SET NULL (folder_id),
  ADD CONSTRAINT contract_drafts_holder_organization_fk
    FOREIGN KEY (holder_counterparty_id, organization_id)
    REFERENCES counterparties (id, organization_id)
    ON DELETE SET NULL (holder_counterparty_id),
  ADD CONSTRAINT contract_drafts_signer_organization_fk
    FOREIGN KEY (signer_counterparty_id, organization_id)
    REFERENCES counterparties (id, organization_id)
    ON DELETE SET NULL (signer_counterparty_id);

-- Toda fila hija del expediente hereda la Organización del Contrato.
ALTER TABLE acceptance_attempts
  ADD CONSTRAINT acceptance_attempts_contract_organization_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES contracts (id, organization_id) ON DELETE CASCADE;
ALTER TABLE contract_events
  ADD CONSTRAINT contract_events_contract_organization_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES contracts (id, organization_id) ON DELETE CASCADE;
ALTER TABLE evidence_items
  ADD CONSTRAINT evidence_items_contract_organization_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES contracts (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT evidence_items_attempt_contract_fk
    FOREIGN KEY (attempt_id, contract_id)
    REFERENCES acceptance_attempts (id, contract_id) ON DELETE CASCADE;
ALTER TABLE ai_review_reports
  ADD CONSTRAINT ai_review_reports_contract_organization_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES contracts (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT ai_review_reports_attempt_contract_fk
    FOREIGN KEY (attempt_id, contract_id)
    REFERENCES acceptance_attempts (id, contract_id) ON DELETE CASCADE;
ALTER TABLE review_tasks
  ADD CONSTRAINT review_tasks_contract_organization_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES contracts (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT review_tasks_attempt_contract_fk
    FOREIGN KEY (attempt_id, contract_id)
    REFERENCES acceptance_attempts (id, contract_id) ON DELETE CASCADE;
ALTER TABLE review_decisions
  ADD CONSTRAINT review_decisions_contract_organization_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES contracts (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT review_decisions_attempt_contract_fk
    FOREIGN KEY (attempt_id, contract_id)
    REFERENCES acceptance_attempts (id, contract_id) ON DELETE CASCADE;
ALTER TABLE contract_objects
  ADD CONSTRAINT contract_objects_contract_organization_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES contracts (id, organization_id) ON DELETE CASCADE;
ALTER TABLE cold_contract_packages
  ADD CONSTRAINT cold_contract_packages_contract_organization_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES contracts (id, organization_id) ON DELETE CASCADE;
ALTER TABLE external_contact_records
  ADD CONSTRAINT external_contact_records_contract_organization_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES contracts (id, organization_id) ON DELETE CASCADE;
ALTER TABLE recovery_jobs
  ADD CONSTRAINT recovery_jobs_contract_organization_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES contracts (id, organization_id) ON DELETE CASCADE;
ALTER TABLE legal_holds
  ADD CONSTRAINT legal_holds_contract_organization_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES contracts (id, organization_id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Invariantes contractuales
-- ---------------------------------------------------------------------------

-- Un Contrato tiene a lo sumo un Intento concluyente: dos resultados finales
-- contradictorios para el mismo expediente dejan de ser representables.
CREATE UNIQUE INDEX acceptance_attempts_one_accepted
  ON acceptance_attempts (contract_id)
  WHERE status = 'accepted';

-- Una Tarea de revisión se resuelve una sola vez.
CREATE UNIQUE INDEX review_decisions_one_per_task
  ON review_decisions (task_id);

-- El nombre de la Carpeta operativa se compara sin distinguir mayúsculas.
CREATE UNIQUE INDEX contract_folders_name_lower_key
  ON contract_folders (organization_id, lower(name));

ALTER TABLE acceptance_attempts
  ADD CONSTRAINT acceptance_attempts_sequence_positive CHECK (sequence >= 1);

-- La Aceptación se conserva en la propia fila; el resto de la evidencia vive
-- como objeto privado y siempre tiene localizador.
ALTER TABLE evidence_items
  ADD CONSTRAINT evidence_items_object_key_by_kind CHECK (
    (kind = 'acceptance' AND object_key IS NULL)
    OR (kind <> 'acceptance' AND object_key IS NOT NULL)
  );

ALTER TABLE contracts
  ADD CONSTRAINT contracts_accepted_needs_timestamp
    CHECK (status <> 'accepted' OR accepted_at IS NOT NULL),
  ADD CONSTRAINT contracts_expired_needs_timestamp
    CHECK (status <> 'expired' OR expired_at IS NOT NULL),
  ADD CONSTRAINT contracts_cancelled_needs_timestamp
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  ADD CONSTRAINT contracts_closed_when_final
    CHECK (status IN ('pending', 'in_review') OR closed_at IS NOT NULL),
  ADD CONSTRAINT contracts_deleted_needs_timestamp
    CHECK (classification <> 'deleted' OR deleted_at IS NOT NULL);

ALTER TABLE contract_drafts
  ADD CONSTRAINT contract_drafts_deleted_needs_timestamp
    CHECK (classification <> 'deleted' OR deleted_at IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 4. Buscador contractual
-- ---------------------------------------------------------------------------

-- El listado ordena por `GREATEST(updated_at, issued_at)`: sin esta expresión
-- indexada cada página de 20 obliga a ordenar el conjunto filtrado completo.
CREATE INDEX contracts_org_recency_idx
  ON contracts (organization_id, classification, GREATEST(updated_at, issued_at) DESC);

CREATE INDEX contracts_org_emitter_idx
  ON contracts (organization_id, created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX contracts_org_template_idx ON contracts (organization_id, template_id);
CREATE INDEX contracts_folder_idx ON contracts (folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX contracts_origin_idx
  ON contracts (origin_contract_id)
  WHERE origin_contract_id IS NOT NULL;

CREATE INDEX contracts_search_text_trgm_idx
  ON contracts USING GIN (search_text gin_trgm_ops);
CREATE INDEX contracts_reference_trgm_idx
  ON contracts USING GIN (reference gin_trgm_ops);
CREATE INDEX contract_parties_name_trgm_idx
  ON contract_parties USING GIN (name gin_trgm_ops);

CREATE INDEX contract_drafts_organization_idx
  ON contract_drafts (organization_id, classification, updated_at DESC);
CREATE INDEX contract_drafts_creator_idx ON contract_drafts (created_by);
CREATE INDEX contract_drafts_template_idx ON contract_drafts (template_id);

-- ---------------------------------------------------------------------------
-- 5. Enlaces, Intentos y vencimiento
-- ---------------------------------------------------------------------------

CREATE INDEX contract_links_attempt_idx ON contract_links (attempt_id);
CREATE INDEX contract_links_contract_idx ON contract_links (contract_id, created_at DESC);
-- Barrido de vencimiento: sólo interesan los enlaces vivos.
CREATE INDEX contract_links_due_idx
  ON contract_links (expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX acceptance_attempts_organization_idx
  ON acceptance_attempts (organization_id);
CREATE INDEX acceptance_attempts_open_idx
  ON acceptance_attempts (contract_id)
  WHERE status = 'open';
CREATE INDEX acceptance_attempts_replaces_idx
  ON acceptance_attempts (replaces_attempt_id)
  WHERE replaces_attempt_id IS NOT NULL;

CREATE INDEX evidence_items_contract_idx ON evidence_items (contract_id);
CREATE INDEX evidence_items_organization_idx ON evidence_items (organization_id);

CREATE INDEX contract_events_organization_idx
  ON contract_events (organization_id, created_at DESC);
CREATE INDEX contract_events_attempt_idx
  ON contract_events (attempt_id)
  WHERE attempt_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Bandeja de revisión
-- ---------------------------------------------------------------------------

CREATE INDEX review_tasks_inbox_idx
  ON review_tasks (organization_id, created_at)
  WHERE status = 'open';
CREATE INDEX review_tasks_contract_idx ON review_tasks (contract_id);

CREATE INDEX review_decisions_contract_idx
  ON review_decisions (contract_id, created_at);
CREATE INDEX review_decisions_attempt_idx ON review_decisions (attempt_id);

CREATE INDEX ai_review_reports_attempt_idx
  ON ai_review_reports (attempt_id, created_at DESC);
CREATE INDEX ai_review_reports_contract_idx
  ON ai_review_reports (contract_id, created_at);

CREATE INDEX external_contact_records_contract_idx
  ON external_contact_records (contract_id, created_at);
CREATE INDEX external_contact_records_organization_idx
  ON external_contact_records (organization_id);
CREATE INDEX external_contact_records_attempt_idx
  ON external_contact_records (attempt_id)
  WHERE attempt_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. Custodia y Archivo Muerto
-- ---------------------------------------------------------------------------

CREATE INDEX contract_objects_organization_idx
  ON contract_objects (organization_id, kind);

CREATE INDEX cold_contract_packages_organization_idx
  ON cold_contract_packages (organization_id, closed_at DESC);
-- Traslado anual al Archivo Muerto.
CREATE INDEX cold_contract_packages_due_idx
  ON cold_contract_packages (closed_at)
  WHERE tier = 'immediate';

CREATE INDEX recovery_jobs_contract_idx ON recovery_jobs (contract_id, created_at DESC);
CREATE INDEX recovery_jobs_organization_idx
  ON recovery_jobs (organization_id, created_at DESC);
CREATE INDEX export_jobs_organization_idx
  ON export_jobs (organization_id, created_at DESC);

CREATE INDEX legal_holds_organization_idx ON legal_holds (organization_id);
CREATE INDEX legal_holds_contract_idx
  ON legal_holds (contract_id)
  WHERE contract_id IS NOT NULL;

CREATE INDEX privacy_notice_versions_history_idx
  ON privacy_notice_versions (organization_id, published_at DESC);
CREATE INDEX contract_template_versions_history_idx
  ON contract_template_versions (template_id, published_at DESC);

-- ---------------------------------------------------------------------------
-- 8. Operación: auditoría, outbox y cola de trabajos
-- ---------------------------------------------------------------------------

CREATE INDEX audit_entries_subject_idx
  ON audit_entries (organization_id, subject_type, subject_id);
CREATE INDEX audit_entries_account_idx
  ON audit_entries (account_id, created_at DESC)
  WHERE account_id IS NOT NULL;

-- El worker sólo lee pendientes: índices parciales en lugar de los totales.
CREATE INDEX notification_outbox_due_idx
  ON notification_outbox (available_at)
  WHERE status = 'pending';
CREATE INDEX notification_outbox_organization_idx
  ON notification_outbox (organization_id, created_at DESC);

CREATE INDEX background_jobs_due_idx
  ON background_jobs (run_after)
  WHERE status = 'pending';
-- Recuperación de trabajos cuyo arrendamiento venció.
CREATE INDEX background_jobs_running_idx
  ON background_jobs (run_after)
  WHERE status = 'running';

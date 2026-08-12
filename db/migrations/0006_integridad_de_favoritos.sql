SET search_path TO fides, public;

-- Una preferencia personal nunca puede asociar un Contrato con otra
-- Organizacion ni sobrevivir a la revocacion del Acceso que la creo.
ALTER TABLE contract_favorites
  ADD CONSTRAINT contract_favorites_contract_organization_fk
    FOREIGN KEY (contract_id, organization_id)
    REFERENCES contracts (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT contract_favorites_membership_fk
    FOREIGN KEY (organization_id, account_id)
    REFERENCES organization_members (organization_id, account_id)
    ON DELETE CASCADE;

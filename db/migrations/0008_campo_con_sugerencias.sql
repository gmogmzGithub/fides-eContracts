SET search_path TO fides, public;

-- `suggest` es texto libre con sugerencias: la captura ofrece una lista y quien
-- captura puede escribir algo que no esté en ella. `select` sigue cerrando la
-- entrada a sus opciones. Antes se distinguían por coincidencia -- un `text`
-- con `options` no vacías --, así que un campo mal programado era
-- indistinguible de uno con opciones olvidadas.
ALTER TABLE contract_field_definitions
  DROP CONSTRAINT IF EXISTS contract_field_definitions_data_type_check;
ALTER TABLE contract_field_definitions
  ADD CONSTRAINT contract_field_definitions_data_type_check
    CHECK (data_type IN (
      'text', 'longtext', 'number', 'money', 'date', 'select', 'suggest'
    ));

-- Un `text` con opciones ya guardadas era justamente la forma ambigua que este
-- tipo viene a nombrar: se convierte antes de exigir la nueva regla.
UPDATE contract_field_definitions
SET data_type = 'suggest'
WHERE data_type = 'text' AND options <> '[]'::JSONB;

-- Sólo los dos tipos que presentan una lista pueden traer opciones. Cualquier
-- otro tipo con `options` no vacías es un error de programación del contenido,
-- no una variante silenciosa.
ALTER TABLE contract_field_definitions
  ADD CONSTRAINT contract_field_definitions_options_check
    CHECK (data_type IN ('select', 'suggest') OR options = '[]'::JSONB);

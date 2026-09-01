-- Vincula o sentinel do volume ao banco, inclusive quando o catálogo ainda está vazio.
ALTER TABLE file_store_counter ADD COLUMN volume_uuid uuid;
GRANT UPDATE (volume_uuid) ON file_store_counter TO tria_app;

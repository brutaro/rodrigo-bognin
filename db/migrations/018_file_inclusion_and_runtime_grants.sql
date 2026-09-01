-- Inclusão explícita em publicação e UPDATE runtime limitado às transições necessárias.
ALTER TABLE file_document ADD COLUMN include_in_publication boolean NOT NULL DEFAULT false;

REVOKE UPDATE ON file_document, file_version, file_reservation FROM tria_app;
GRANT UPDATE (title, status, updated_at, include_in_publication) ON file_document TO tria_app;
GRANT UPDATE (status) ON file_version TO tria_app;
GRANT UPDATE (status) ON file_reservation TO tria_app;

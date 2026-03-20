-- ================================================
-- AUTONOMICZNE BIURO - Schema v16 (Tasks created_by user FK)
-- ================================================

BEGIN;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS created_by_user UUID REFERENCES users(id) ON DELETE SET NULL;

UPDATE tasks t
SET created_by_user = u.id
FROM users u
WHERE t.created_by IS NOT NULL
  AND u.id::text = t.created_by;

ALTER TABLE tasks
  DROP COLUMN IF EXISTS created_by;

ALTER TABLE tasks
  RENAME COLUMN created_by_user TO created_by;

CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);

COMMIT;

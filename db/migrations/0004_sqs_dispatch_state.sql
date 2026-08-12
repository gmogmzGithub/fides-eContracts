-- Estado de publicación del outbox transaccional hacia la cola SQS-compatible.
-- PostgreSQL continúa siendo canónico; la cola sólo transporta el UUID del
-- trabajo y puede entregarlo más de una vez.

ALTER TABLE fides.background_jobs
  ADD COLUMN dispatched_at TIMESTAMPTZ,
  ADD COLUMN dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN dispatch_last_error TEXT,
  ADD COLUMN queue_message_id TEXT;

CREATE INDEX background_jobs_dispatch_due_idx
  ON fides.background_jobs (run_after, dispatched_at)
  WHERE status = 'pending';

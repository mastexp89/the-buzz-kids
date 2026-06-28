-- 010_payments_idempotency.sql
-- Defends against duplicate Stripe webhook deliveries inserting duplicate
-- payments rows for the same checkout session or invoice.
--
-- The webhook handler does an app-level "is there already a row for this
-- session?" check, but that check is a TOCTOU race if two webhook deliveries
-- arrive concurrently. These unique partial indexes are the database-level
-- belt-and-braces — they make the second insert fail loudly instead of
-- silently creating a duplicate.
--
-- Partial indexes (WHERE … IS NOT NULL) so existing rows that pre-date the
-- Stripe ID columns (or that have null IDs for any other reason) don't break
-- the constraint.

-- ---------------------------------------------------------------------------
-- 1. Clean up any existing duplicates BEFORE adding the unique indexes
--    (otherwise CREATE UNIQUE INDEX will fail).
--
-- For each duplicated stripe_checkout_session_id, keep the EARLIEST row
-- (smallest created_at) and delete the rest. Same for stripe_invoice_id.
-- ---------------------------------------------------------------------------

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY stripe_checkout_session_id
      ORDER BY created_at ASC
    ) AS rn
  FROM payments
  WHERE stripe_checkout_session_id IS NOT NULL
)
DELETE FROM payments
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY stripe_invoice_id
      ORDER BY created_at ASC
    ) AS rn
  FROM payments
  WHERE stripe_invoice_id IS NOT NULL
)
DELETE FROM payments
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ---------------------------------------------------------------------------
-- 2. Unique partial indexes to prevent future duplicates at the DB level.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_checkout_session_id_uniq
  ON payments (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_invoice_id_uniq
  ON payments (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

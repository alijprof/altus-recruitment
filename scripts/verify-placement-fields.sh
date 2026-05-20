#!/usr/bin/env bash
# Plan 03-06 / Task F.1 verification step.
#
# Greps the migrations directory for `fee_pence` and `placed_at` columns on
# `public.applications`. If BOTH are present, this plan's
# `<ts>_phase3_applications_placement_fields.sql` migration is unnecessary
# and the executor should skip it. If EITHER is missing, the migration must
# be added so the source-attribution RPC can aggregate fee revenue +
# time-to-place per D3-22.
#
# Usage:
#   bash scripts/verify-placement-fields.sh
#
# Exit codes:
#   0 — both columns already exist; no migration needed.
#   1 — at least one column missing; add the migration.

set -euo pipefail

MIGRATIONS_DIR="supabase/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "error: $MIGRATIONS_DIR not found (run from repo root)" >&2
  exit 2
fi

HITS=$(grep -n "fee_pence\|placed_at" "$MIGRATIONS_DIR"/*.sql 2>/dev/null || true)

HAS_FEE_PENCE=$(echo "$HITS" | grep -c "fee_pence" || true)
HAS_PLACED_AT=$(echo "$HITS" | grep -c "placed_at" || true)

echo "fee_pence references: $HAS_FEE_PENCE"
echo "placed_at references: $HAS_PLACED_AT"

if [ "$HAS_FEE_PENCE" -gt 0 ] && [ "$HAS_PLACED_AT" -gt 0 ]; then
  echo "OK: both columns present in migrations history. No migration needed."
  exit 0
fi

echo "MISSING: at least one column not yet introduced. The plan's"
echo "        <ts>_phase3_applications_placement_fields.sql migration is REQUIRED."
exit 1

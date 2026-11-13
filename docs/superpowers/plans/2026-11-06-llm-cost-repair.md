# LLM Cost Repair Implementation Plan

**Goal:** Repair the deployed LLM backend and reduce demo operating cost.
**Spec:** ../specs/2026-11-06-llm-cost-repair-design.md
**Architecture:** Existing Workers/Pages, economical task-specific OpenAI models, D1 object storage.

## Tasks

- [x] Add failing D1-only storage tests for binary/text round trips, overwrite, bounds and missing keys.
- [x] Add chunked storage migration and adapter; optional BUCKET, D1-only logging, explicit D1 legacy deployment config.
- [x] Add failing image-parameter and failure-usage tests; enforce one low-quality WebP with bounded dimensions, and record usage even on later failure.
- [x] Run storage/runtime/unit tests, TypeScript and dry-run deployment. Review changes.
- [x] Apply the additive legacy D1 migration, deploy legacy Worker, exercise actual LLM endpoints and restore baseline Brand DNA. Pages already has the required proxies and needed no change.
- [x] Publish model rationale, measured token costs and validation results locally.

## Review focus

Binary reconstruction, batch atomicity, D1 query count, old inaccessible R2 files, image size/quality supplied by callers, accounting on errors, and preserving the active DNA snapshot.

## Rulings

- No Git repository exists: preserve source backups and work in place; do not initialize Git or create worktrees.
- The user delegated model selection and repairs; proceed with the documented design and deployment without additional approval round trips.
- Review findings fixed: reset now frees object capacity; object reads use one database snapshot; derived DNA snapshots preserve source IDs for reuse. Reviewer found no remaining significant findings.
- Verified 43 local tests and 13 real API checks. Baseline snapshot 13 restored; temporary OCR source 48 and its file removed with ownership checks.

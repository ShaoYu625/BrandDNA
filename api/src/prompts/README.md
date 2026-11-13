# BrandDNA Cloudflare Prompt Contracts

The Cloudflare API Worker keeps task-specific prompt contracts close to the API
code so they can be versioned with the demo deployment.

Current implementation:

- Shared safety and output contract: `api/src/adapters/openai.ts`
- Source analysis, Brand DNA, diagnosis, generation, risk check, and simulation
  schemas: `api/src/routes/api.ts`

This directory is intentionally lightweight for the demo edition. If prompt
contracts grow, move each task prompt here without changing the public API paths.

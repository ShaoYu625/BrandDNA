# LLM reliability and cost repair

The user requests replacing failed dependencies and selecting economical models for a classroom restaurant-marketing demo, including deployment. Work directly in the existing non-Git directory; preserve user data and credentials.

## Approach

Use GPT-6 Luna for routine text and vision, GPT-6.1 Terra only for Brand DNA and risk review, and GPT Image 2.5 Flare at low quality, one compressed WebP per request. All are documented current models. GPT Image 1 Mini is cheaper but retires December 1, 2026; using it would require another migration shortly. Flare 2.6 has the same token rates but introduces options unnecessary for this existing integration. These are implementation decisions made under the user's request to choose the best value.

Replace the unavailable R2 dependency with explicit D1 object storage: 128 KiB chunks, 5 MiB per object and 50 MiB total. Keep optional R2 support for installations that already use it. Existing R2-only files cannot be recovered without R2 access; existing D1 source extractions, snapshots and artifacts remain intact. Store logs once in D1 instead of duplicating them into inaccessible R2. Generated artifacts must be served through the existing Pages proxy.

Keep the existing US$3 weekly stop threshold, limit image dimensions/quality, track token-based cost, and reuse unchanged source analyses and Brand DNA. The threshold is checked before calls and is not a strict billing cap under concurrency or for a call crossing the threshold. No automatic high-price fallback. Keep truck demo behavior unchanged.

## Validation

First reproduce missing-R2 uploads in a local Worker test. Test chunk reconstruction, overwrite, missing objects, limits and transaction failure. Test image settings and usage recording even when later artifact storage fails. Run all existing checks and deploy only after they pass. Re-test real text, vision, image generation and artifact delivery; restore the original active Brand DNA after tests. Record actual usage and remaining limitations.

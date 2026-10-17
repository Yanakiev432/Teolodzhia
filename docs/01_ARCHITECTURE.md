# 01. Architecture

## End-to-end path

User -> Custom GPT "Теолоджия" -> OpenAPI Action v2.3.1 -> Cloudflare Worker v1.6 -> Google Apps Script v2.3 production version 12 -> Google Drive index.

## Custom GPT

Responsible for theological role, Action routing, pagination policy, sourceKey discipline, and evidence claims.

It does not implement catalog logic.

## OpenAPI Action

Defines six operations and their request contracts. v2.3.1 defaults list pageSize to 20.

Canonical file: config/custom-gpt/openapi-v2.3.1.yaml

## Cloudflare Worker v1.6

Routes:

- GET /health
- POST /search-works
- POST /search
- POST /read
- POST /works
- POST /list
- GET /privacy

Runtime secret names include APPS_SCRIPT_SECRET and GPT_ACTION_KEY. Values are not stored in GitHub.

## Apps Script v2.3

Production version **12**. It reads the authoritative catalog, validates the workgraph, performs search/list/read operations, and handles gzip workgraph content.

## Google Drive

Canonical folder: _TEOLODZHIYA_INDEX

Important objects:

- catalog.jsonl
- catalog.jsonl.gz
- workgraph.json.gz
- BOOKS

The workgraph is a sidecar, never the source of authority for source records.

## Fail closed

If workgraph freshness validation fails, do not trust work-level operations. Fall back to source-level search/list until workgraph regeneration.

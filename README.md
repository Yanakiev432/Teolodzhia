# Теолоджия — Custom GPT production reference

**Frozen release:** v2.3.1-final  
**Repository role:** canonical technical and operational reference for the production Custom GPT **„Теолоджия“**.  
**GitHub:** https://github.com/Yanakiev432/Teolodzhia

This repository does **not** contain credentials, API keys, Google OAuth tokens, GitHub tokens, private keys, or the corpus itself.

## Какво е „Теолоджия“

„Теолоджия“ е Custom GPT за православно богословско изследване и работа с постоянна библиотечна колекция. Когато въпросът може да бъде проверен в локалната православна библиотека, GPT използва библиотечния Action преди отговор по същество.

Системата поддържа две представяния на каталога:

- **source-level catalog** — авторитетният физически/източников каталог: **2801** активни source records;
- **logical work catalog** — read-only workgraph, който групира manifestations на едно произведение и scan-series: **2687** логически единици;
- **logical reduction:** **114**.

## Production architecture

User -> Custom GPT "Теолоджия" -> OpenAPI Action v2.3.1 -> Cloudflare Worker v1.6 -> Google Apps Script v2.3 production version 12 -> Google Drive _TEOLODZHIYA_INDEX -> catalog / workgraph / BOOKS.

Production proxy: https://teolodzhia-library-proxy.yanakiev-ivan.workers.dev

## Frozen versions

| Component | Frozen production version |
|---|---|
| Custom GPT Action schema | **2.3.1** |
| Custom GPT instructions | **2.3.1 merged** |
| Cloudflare Worker | **1.6** |
| Google Apps Script | **2.3**, production **version 12** |
| Catalog format | **2.5** |
| Custom GPT | **Published / Live** |
| Architecture decision | **Stay on Custom GPT; no plugin/MCP migration in this snapshot** |

## Action operations

The Custom GPT exposes exactly six operations:

1. searchLibraryWorks — normal/default search, repeated titles collapsed.
2. searchLibrary — source-level search for exact files/editions/manifestations.
3. readLibrarySource — reads excerpts from one concrete sourceKey.
4. listLibraryWorks — exhaustive logical catalog.
5. listLibrarySources — exhaustive authoritative source catalog.
6. libraryHealth — proxy/service health.

workId is **not** a readable file ID. readLibrarySource must receive a concrete sourceKey.

## v2.3.1 delta

- ListRequest.pageSize.default changed from **250** to **20**;
- maximum remains **500**;
- Instructions explicitly start listLibraryWorks / listLibrarySources at pageSize=20;
- direct legacy searchLibrary acceptance was added;
- backend, Drive, catalog and workgraph were **not** redeployed or mutated.

## Final acceptance

- Custom GPT v2.3.1 publish: **PASS**
- schema exact gate: **PASS**
- instructions exact gate: **PASS**
- 6/6 operations: **PASS**
- API key authentication preserved: **PASS**
- libraryHealth: **PASS**, Worker version 1.6
- listLibraryWorks: **PASS**, logical total 2687
- listLibrarySources: **PASS**, source total 2801
- searchLibraryWorks -> readLibrarySource: **PASS**
- direct legacy searchLibrary: **PASS**
- default-20 list runtime: **PASS**, no ResponseTooLargeError observed

## Repository map

- docs/00_SYSTEM_OVERVIEW.md — system purpose and invariants
- docs/01_ARCHITECTURE.md — complete architecture
- docs/02_CUSTOM_GPT_CONFIGURATION.md — Custom GPT configuration
- docs/03_ACTIONS_REFERENCE.md — all six Actions
- docs/04_USAGE_GUIDE.md — user/operator usage
- docs/05_DATA_MODEL.md — source/work/manifestation model
- docs/06_OPERATIONS_MAINTENANCE.md — maintenance workflow
- docs/07_DEPLOYMENT_RECOVERY.md — rebuild/recovery procedure
- docs/08_VALIDATION_ACCEPTANCE.md — acceptance evidence
- docs/09_SECURITY_PRIVACY.md — security boundaries
- docs/10_TROUBLESHOOTING.md — known failure modes
- docs/11_RELEASE_FREEZE.md — frozen release contract

Canonical configuration and implementation snapshots live under config/, backend/, runtime/, and release/.

## Important invariants

- The authoritative source catalog remains **2801** active records.
- The logical catalog remains **2687** entries in this frozen snapshot.
- workgraph.json.gz is a **read-only sidecar**; it never replaces source records.
- A source is read only by sourceKey.
- workId, originalId, Knowledge IDs, and guessed IDs must never be passed to readLibrarySource.
- No credential is committed to this repository.
- The corpus/books themselves are not stored here.

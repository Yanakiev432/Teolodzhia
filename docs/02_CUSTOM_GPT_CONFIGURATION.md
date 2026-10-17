# 02. Custom GPT configuration

## Identity

- Name: **Теолоджия**
- Description: **Православна теология - Orthodox Theology**
- GPT ID: g-690da4b9898081918e7c909576890706
- Frozen Action release: **2.3.1**
- State at freeze: **Published / Live**

## Full instructions

The verbatim frozen instructions are stored at:

config/custom-gpt/INSTRUCTIONS_v2.3.1.txt

## Critical behavior

1. Use the library Action before substantive answers when the theological question is library-checkable.
2. Default to searchLibraryWorks.
3. Use searchLibrary only when exact manifestations/files/editions are requested.
4. Use readLibrarySource only with a concrete sourceKey.
5. Never pass workId, originalId, Knowledge IDs, or guessed IDs to readLibrarySource.
6. manifestationCount greater than 1 means multiple manifestations/versions, not automatically binary duplicates.
7. Use listLibraryWorks for logical catalog enumeration.
8. Use listLibrarySources for authoritative source enumeration.
9. Start list operations at pageSize=20; follow nextPage until hasMore=false.
10. Do not infer author from filename/title.
11. Do not claim content beyond returned excerpts.
12. If the Action is unavailable, say so instead of fabricating library evidence.

## Authentication

Mode: **API Key**.

No API key value is stored here.

Privacy endpoint: https://teolodzhia-library-proxy.yanakiev-ivan.workers.dev/privacy

## Architecture decision

v2.3.1 intentionally remains a Custom GPT Action implementation. No plugin/MCP migration is part of this release.

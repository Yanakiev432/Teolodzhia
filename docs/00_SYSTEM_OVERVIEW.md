# 00. System overview

## Mission

„Теолоджия“ combines a scholarly Custom GPT persona with an evidence-first Orthodox library Action. The Action is the preferred source of truth for questions that can be checked against the indexed corpus.

The design avoids two failure modes:

1. answering from model memory when the local library can provide evidence;
2. confusing manifestations with logical works.

## Production invariants

- Source catalog: **2801** active records.
- Logical catalog: **2687** entries.
- Logical reduction: **114**.
- Catalog SHA-256: 3f3ae6d7ff6bb1ca4640f82d910bca2f8c443e15b8e43ed3fc15ec4c02cd0bc2
- Workgraph SHA-256: 81462a8e51576f0dac96fa97d34c0092a25607e060cb7ade20798d5f2d9e9a2b
- Apps Script production: version **12**.
- Worker: **1.6**.
- Custom GPT Action: **2.3.1**.
- Catalog format: **2.5**.

## Routing

- ordinary search -> searchLibraryWorks
- exact files/editions/manifestations -> searchLibrary
- excerpt reading -> readLibrarySource with concrete sourceKey
- full logical catalog -> listLibraryWorks
- full source inventory -> listLibrarySources

## Non-goals

This repository is not the document corpus, a credential store, or a plugin/MCP migration.

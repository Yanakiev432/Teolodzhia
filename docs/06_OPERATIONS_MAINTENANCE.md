# 06. Operations and maintenance

## Steady state

No maintenance action is required while the indexed library is unchanged.

## When source files change

1. update/rebuild authoritative source catalog;
2. validate source catalog;
3. regenerate workgraph;
4. verify fingerprint and catalog SHA;
5. upload workgraph.json.gz;
6. run source-level and work-level acceptance;
7. create a new version/checkpoint only after PASS.

## Do not redo historical dedup plans

The exact-binary dedup phase is complete. Do not rerun stale execution plans against the current catalog.

Frozen dedup summary:

- 839 catalog records removed in total
- 836 exact-binary duplicates
- 1 identical Google Doc title-level duplicate
- 2 high-confidence rendered-page-equivalent PDF duplicates

Physical Drive cleanup remained blocked for non-owned files. This does not affect catalog correctness.

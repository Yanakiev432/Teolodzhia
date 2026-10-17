# 03. Actions reference

Canonical schema: config/custom-gpt/openapi-v2.3.1.yaml

## searchLibraryWorks

Route: POST /search-works

Default normal search. Returns logical works while keeping a concrete readable sourceKey/defaultSourceKey.

Important fields: workId, sourceKey/defaultSourceKey, manifestationCount, manifestationSourceKeys.

workId is not accepted by readLibrarySource.

## searchLibrary

Route: POST /search

Source-level search for exact files, editions, versions, or manifestations. Returned id/sourceKey is readable.

## readLibrarySource

Route: POST /read

Parameters:

- fileId: concrete sourceKey
- query: passage search text
- maxExcerpts: 1..5

## listLibraryWorks

Route: POST /works

Exhaustive logical catalog. v2.3.1 default pageSize is 20.

Frozen totals:

- total = 2687
- sourceTotal = 2801
- logicalReduction = 114

## listLibrarySources

Route: POST /list

Exhaustive authoritative source catalog. Frozen total: 2801.

## libraryHealth

Route: GET /health

Frozen acceptance: ok=true, service=Teolodzhia Library Proxy, version=1.6.

## Pagination

Start at pageSize=20 and continue via nextPage while hasMore=true. Avoid requesting the entire catalog in one Action response.

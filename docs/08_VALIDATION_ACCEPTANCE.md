# 08. Validation and acceptance

## v2.3 end-to-end

PASS:

- libraryHealth
- listLibraryWorks
- listLibrarySources
- searchLibraryWorks
- readLibrarySource

Representative work result:

- query: Служебник
- workId: work_44bef26b61f3cd16b6c1
- manifestationCount: 2
- source keys:
  - e3d3d1a8c3dea4c63543c6b2
  - fb602be146212abd8afbc40b

Representative read:

- fileId: e3d3d1a8c3dea4c63543c6b2
- query: литургия
- excerptCount: 2
- chunkCount: 58
- indexFormatVersion: 2.5
- file: Служебник.pdf

## v2.3.1 publish gate

- instructions exact: PASS
- schema exact: PASS
- 6/6 operations: PASS
- parse errors: 0
- API Key mode: PASS
- privacy URL: PASS
- Published signal: PASS

## Pagination polish

Published schema:

- info.version = 2.3.1
- ListRequest.pageSize.default = 20
- maximum = 500

Runtime listLibraryWorks test succeeded and no ResponseTooLargeError was observed.

## Legacy source search

Direct searchLibrary QA:

- query: Служебник
- maxResults: 5
- returned known source-level keys e3d3d1a8c3dea4c63543c6b2 and fb602be146212abd8afbc40b
- no searchLibraryWorks routing for that explicit test

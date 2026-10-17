# 10. Troubleshooting

## ResponseTooLargeError

Use pageSize=20 and paginate. v2.3.1 fixes the default at the Custom GPT layer.

## WORKGRAPH_STALE

Do not use work-level results. Use searchLibrary/listLibrarySources, regenerate workgraph, validate, then re-enable work-level access.

## readLibrarySource rejects an ID

Ensure fileId is a real sourceKey, not workId/originalId/Knowledge ID.

## Duplicate-looking titles

Use searchLibraryWorks to collapse logical works; use searchLibrary to inspect manifestations.

## Action unavailable

The GPT should state the library is unavailable rather than claim evidence it did not retrieve.

## Physical duplicate files remain

Some duplicate files could not be trashed because the operator did not own them / canTrash=false. The authoritative catalog is already corrected.

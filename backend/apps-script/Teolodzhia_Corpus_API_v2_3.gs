/**
 * TEOLODZHIYA CORPUS API v2.3
 * ------------------------------------------------------------
 * Reads the permanent V2.5 corpus created by teolodzhia_indexer.py:
 *
 * _TEOLODZHIYA_INDEX/
 *   catalog.jsonl
 *   catalog.jsonl.gz
 *   BOOKS/
 *     <sourceKey>__<title>/
 *       metadata.json
 *       search.txt
 *       chunks.jsonl.gz
 *
 * IMPORTANT:
 * - Keeps the existing public Apps Script API contract:
 *     ?secret=...&op=search&query=...&maxResults=...
 *     ?secret=...&op=read&fileId=...&query=...&maxExcerpts=...
 *     ?secret=...&op=list&page=1&pageSize=250&sort=title
 * - "fileId" is now the logical sourceKey returned by search.
 * - Search uses indexed search.txt files, NOT the original documents.
 * - Read uses chunks.jsonl.gz and returns RAW source excerpts.
 * - No OCR/conversion happens in Apps Script.
 * - No appProperties are required (cross-client safe).
 *
 * Prerequisite:
 * - Advanced Google service "Drive API" enabled for this Apps Script project.
 * - Existing Script Property API_PATH_SECRET remains unchanged.
 */

const TEOLODZHIYA_INDEX_ROOT_ID = "1rw56mpLd677u7r10UyUi0Cmxfdi_URZh";
const TEOLODZHIYA_INDEX_FORMAT = "2.5";
const TEOLODZHIYA_API_VERSION = "2.3-corpus-v2.5-workgraph";

const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";

const SEARCH_FILE_NAME = "search.txt";
const CHUNKS_FILE_NAME = "chunks.jsonl.gz";
const METADATA_FILE_NAME = "metadata.json";
const BOOKS_FOLDER_NAME = "BOOKS";
const CATALOG_GZIP_NAME = "catalog.jsonl.gz";
const WORKGRAPH_GZIP_NAME = "workgraph.json.gz";

const MAX_DRIVE_SEARCH_CANDIDATES = 350;
const MAX_SEARCH_RESULTS = 10;
const MAX_WORK_SEARCH_SOURCE_CANDIDATES = 50;
const MAX_READ_EXCERPTS = 5;
const MAX_EXCERPT_CHARS = 1900;


/* ============================================================
 * BASIC HELPERS
 * ============================================================ */

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


function escapeDriveSearch(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}


function escapeRegExp(value) {
  return String(value || "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function cleanExcerpt(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(String(value || ""));
  } catch (e) {
    return fallback;
  }
}


function getSearchTerms(query) {
  query = String(query || "");

  const stopWords = new Set([
    "как", "какво", "кой", "коя", "кои", "къде",
    "за", "на", "от", "до", "по", "при",
    "в", "във", "с", "със",
    "и", "или", "а",
    "е", "са", "се", "че", "като",
    "според", "относно", "върху",
    "св", "св.", "свети", "светия",
    "the", "and", "for", "from", "with",
    "about", "what", "how"
  ]);

  const seen = {};

  return query
    .trim()
    .split(/\s+/)
    .map(function(word) {
      return word
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
        .trim();
    })
    .filter(function(word) {
      const lower = word.toLowerCase();

      if (
        word.length < 3 ||
        stopWords.has(lower) ||
        seen[lower]
      ) {
        return false;
      }

      seen[lower] = true;
      return true;
    })
    .slice(0, 8);
}


/* ============================================================
 * AUTH
 * ============================================================ */

function getConfiguredApiSecret() {
  return (
    PropertiesService
      .getScriptProperties()
      .getProperty("API_PATH_SECRET") || ""
  );
}


function validateApiSecret(suppliedSecret) {
  const configuredSecret = getConfiguredApiSecret();

  if (!configuredSecret) {
    throw new Error(
      "API secret is not configured. Existing Script Property API_PATH_SECRET is missing."
    );
  }

  if (String(suppliedSecret || "") !== configuredSecret) {
    throw new Error("Unauthorized API request.");
  }

  return true;
}


/* ============================================================
 * DRIVE / INDEX STRUCTURE
 * ============================================================ */

function getBooksRootId() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("TEOLODZHIYA_BOOKS_ROOT_ID");

  if (cached) {
    return cached;
  }

  const q =
    "'" + escapeDriveSearch(TEOLODZHIYA_INDEX_ROOT_ID) + "' in parents " +
    "and trashed = false " +
    "and mimeType = '" + GOOGLE_FOLDER_MIME + "' " +
    "and name = '" + escapeDriveSearch(BOOKS_FOLDER_NAME) + "'";

  const response = Drive.Files.list({
    q: q,
    pageSize: 10,
    spaces: "drive",
    fields: "files(id,name,mimeType,parents)"
  });

  const files = response.files || [];

  if (!files.length) {
    throw new Error(
      "BOOKS folder not found under _TEOLODZHIYA_INDEX."
    );
  }

  cache.put(
    "TEOLODZHIYA_BOOKS_ROOT_ID",
    files[0].id,
    21600
  );

  return files[0].id;
}


function getBookFolderMeta(folderId) {
  const cache = CacheService.getScriptCache();
  const cacheKey = "BOOKFOLDER_" + String(folderId || "");
  const cached = cache.get(cacheKey);

  if (cached) {
    const parsed = safeJsonParse(cached, null);
    if (parsed) {
      return parsed;
    }
  }

  const meta = Drive.Files.get(
    folderId,
    {
      fields: "id,name,mimeType,parents",
      supportsAllDrives: true
    }
  );

  cache.put(
    cacheKey,
    JSON.stringify(meta),
    21600
  );

  return meta;
}


function isDirectBookFolder(folderId) {
  try {
    const booksRootId = getBooksRootId();
    const meta = getBookFolderMeta(folderId);

    return (
      meta.mimeType === GOOGLE_FOLDER_MIME &&
      (meta.parents || []).indexOf(booksRootId) !== -1
    );
  } catch (e) {
    return false;
  }
}


function sourceKeyFromFolderName(folderName) {
  const name = String(folderName || "");
  const marker = name.indexOf("__");

  if (marker <= 0) {
    return "";
  }

  return name.substring(0, marker);
}


function findBookFolderBySourceKey(sourceKey) {
  sourceKey = String(sourceKey || "").trim();

  if (!sourceKey) {
    throw new Error("Missing sourceKey/fileId.");
  }

  const booksRootId = getBooksRootId();

  const q =
    "'" + escapeDriveSearch(booksRootId) + "' in parents " +
    "and trashed = false " +
    "and mimeType = '" + GOOGLE_FOLDER_MIME + "' " +
    "and name contains '" + escapeDriveSearch(sourceKey + "__") + "'";

  const response = Drive.Files.list({
    q: q,
    pageSize: 50,
    spaces: "drive",
    fields: "files(id,name,mimeType,parents)"
  });

  const files = response.files || [];

  for (const file of files) {
    if (String(file.name || "").indexOf(sourceKey + "__") === 0) {
      return file;
    }
  }

  throw new Error(
    "Indexed book not found for sourceKey: " + sourceKey
  );
}


function findChildFile(folderId, fileName) {
  const q =
    "'" + escapeDriveSearch(folderId) + "' in parents " +
    "and trashed = false " +
    "and name = '" + escapeDriveSearch(fileName) + "'";

  const response = Drive.Files.list({
    q: q,
    pageSize: 20,
    spaces: "drive",
    fields: "files(id,name,mimeType,parents,description,size,modifiedTime)"
  });

  const files = response.files || [];

  return files.length ? files[0] : null;
}



function downloadDriveBlob(fileId) {
  return DriveApp
    .getFileById(fileId)
    .getBlob();
}


function readJsonFile(fileId) {
  const blob = downloadDriveBlob(fileId);
  const text = blob.getDataAsString("UTF-8");
  return JSON.parse(text);
}


function readGzipJsonl(fileId) {
  const compressed = downloadDriveBlob(fileId);
  const rawBlob = Utilities.ungzip(compressed.setContentType("application/x-gzip"));
  const text = rawBlob.getDataAsString("UTF-8");

  if (!text.trim()) {
    return [];
  }

  const lines = text.split(/\r?\n/);
  const rows = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      rows.push(JSON.parse(line));
    } catch (e) {
      // A single malformed JSONL line must not destroy the whole source.
    }
  }

  return rows;
}




function readGzipJson(fileId) {
  const compressed = downloadDriveBlob(fileId);
  const rawBlob = Utilities.ungzip(compressed.setContentType("application/x-gzip"));
  const text = rawBlob.getDataAsString("UTF-8");
  return JSON.parse(text);
}


/* ============================================================
 * ACTIVE COMPLETED CORPUS CATALOG
 *
 * catalog.jsonl.gz is produced only after a completed --full run.
 * BOOKS may contain old/test/orphan folders from earlier runs.
 * Public search/read therefore accepts only sourceKeys listed in
 * the current completed catalog.
 * ============================================================ */

let TEOLODZHIYA_ACTIVE_CATALOG_MEMO = null;


function getCatalogGzipFile() {
  const q =
    "'" + escapeDriveSearch(TEOLODZHIYA_INDEX_ROOT_ID) + "' in parents " +
    "and trashed = false " +
    "and name = '" + escapeDriveSearch(CATALOG_GZIP_NAME) + "'";

  const response = Drive.Files.list({
    q: q,
    pageSize: 10,
    spaces: "drive",
    fields: "files(id,name,mimeType,modifiedTime,size)"
  });

  const files = response.files || [];

  if (!files.length) {
    throw new Error(
      "catalog.jsonl.gz not found under _TEOLODZHIYA_INDEX."
    );
  }

  return files[0];
}


function getActiveCatalog() {
  if (TEOLODZHIYA_ACTIVE_CATALOG_MEMO) {
    return TEOLODZHIYA_ACTIVE_CATALOG_MEMO;
  }

  const catalogFile = getCatalogGzipFile();
  const rows = readGzipJsonl(catalogFile.id);

  const bySourceKey = {};
  let malformedRows = 0;

  for (const row of rows) {
    const sourceKey =
      String(
        row && row.sourceKey
          ? row.sourceKey
          : ""
      ).trim();

    if (!sourceKey) {
      malformedRows++;
      continue;
    }

    bySourceKey[sourceKey] = row;
  }

  TEOLODZHIYA_ACTIVE_CATALOG_MEMO = {
    fileId: catalogFile.id,
    modifiedTime: String(catalogFile.modifiedTime || ""),
    size: Number(catalogFile.size || 0),
    rowCount: rows.length,
    activeCount: Object.keys(bySourceKey).length,
    malformedRows: malformedRows,
    bySourceKey: bySourceKey
  };

  return TEOLODZHIYA_ACTIVE_CATALOG_MEMO;
}


function requireActiveSourceKey(sourceKey) {
  sourceKey = String(sourceKey || "").trim();

  const catalog = getActiveCatalog();
  const row = catalog.bySourceKey[sourceKey];

  if (!row) {
    throw new Error(
      "Source is not present in the active completed corpus catalog: " +
      sourceKey
    );
  }

  return row;
}




/* ============================================================
 * WORK / MANIFESTATION SIDECAR
 *
 * workgraph.json.gz is generated locally from the exact active catalog.
 * It NEVER replaces catalog.jsonl.gz. It only provides logical grouping
 * for repeated titles and generic scan-page series.
 * ============================================================ */

let TEOLODZHIYA_WORKGRAPH_MEMO = null;


function sha256HexUtf8(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
    Utilities.Charset.UTF_8
  );

  return digest
    .map(function(byteValue) {
      const value =
        byteValue < 0
          ? byteValue + 256
          : byteValue;

      return (
        "0" +
        value.toString(16)
      ).slice(-2);
    })
    .join("");
}


function normalizeLibraryView(value) {
  value = String(value || "sources")
    .trim()
    .toLowerCase();

  if (
    value === "works" ||
    value === "work" ||
    value === "logical"
  ) {
    return "works";
  }

  return "sources";
}


function getWorkgraphGzipFile() {
  const q =
    "'" + escapeDriveSearch(TEOLODZHIYA_INDEX_ROOT_ID) + "' in parents " +
    "and trashed = false " +
    "and name = '" + escapeDriveSearch(WORKGRAPH_GZIP_NAME) + "'";

  const response = Drive.Files.list({
    q: q,
    pageSize: 10,
    spaces: "drive",
    fields: "files(id,name,mimeType,modifiedTime,size)"
  });

  const files = response.files || [];

  if (!files.length) {
    throw new Error(
      "workgraph.json.gz not found under _TEOLODZHIYA_INDEX."
    );
  }

  return files[0];
}


function getWorkGraph() {
  if (TEOLODZHIYA_WORKGRAPH_MEMO) {
    return TEOLODZHIYA_WORKGRAPH_MEMO;
  }

  const workgraphFile =
    getWorkgraphGzipFile();

  const graph =
    readGzipJson(
      workgraphFile.id
    ) || {};

  const catalog =
    getActiveCatalog();

  const activeKeys =
    Object.keys(
      catalog.bySourceKey
    )
      .sort();

  const activeFingerprint =
    sha256HexUtf8(
      activeKeys.join("\n") +
      "\n"
    );

  if (
    Number(graph.catalogRows || 0) !==
    catalog.activeCount
  ) {
    throw new Error(
      "WORKGRAPH_STALE: catalog row count mismatch. " +
      "graph=" +
      String(graph.catalogRows || 0) +
      " active=" +
      String(catalog.activeCount)
    );
  }

  if (
    String(
      graph.activeSourceKeyFingerprint ||
      ""
    ) !==
    activeFingerprint
  ) {
    throw new Error(
      "WORKGRAPH_STALE: active source-key fingerprint mismatch."
    );
  }

  const namedWorks =
    Array.isArray(graph.namedWorks)
      ? graph.namedWorks
      : [];

  const scanSeries =
    Array.isArray(graph.scanSeries)
      ? graph.scanSeries
      : [];

  const sourceToEntity =
    (
      graph.sourceToEntity &&
      typeof graph.sourceToEntity === "object"
    )
      ? graph.sourceToEntity
      : {};

  const namedById = {};
  const seriesById = {};

  for (const work of namedWorks) {
    const workId =
      String(
        work &&
        work.workId
          ? work.workId
          : ""
      ).trim();

    if (workId) {
      namedById[workId] =
        work;
    }
  }

  for (const series of scanSeries) {
    const seriesId =
      String(
        series &&
        series.seriesId
          ? series.seriesId
          : ""
      ).trim();

    if (seriesId) {
      seriesById[seriesId] =
        series;
    }
  }

  for (const sourceKey in sourceToEntity) {
    if (!catalog.bySourceKey[sourceKey]) {
      throw new Error(
        "WORKGRAPH_STALE: mapped sourceKey is not active: " +
        sourceKey
      );
    }
  }

  TEOLODZHIYA_WORKGRAPH_MEMO = {
    fileId:
      workgraphFile.id,

    modifiedTime:
      String(
        workgraphFile.modifiedTime ||
        ""
      ),

    size:
      Number(
        workgraphFile.size ||
        0
      ),

    schemaVersion:
      String(
        graph.schemaVersion ||
        ""
      ),

    catalogRows:
      Number(
        graph.catalogRows ||
        0
      ),

    catalogSha256:
      String(
        graph.catalogSha256 ||
        ""
      ),

    activeSourceKeyFingerprint:
      activeFingerprint,

    namedWorks:
      namedWorks,

    scanSeries:
      scanSeries,

    sourceToEntity:
      sourceToEntity,

    namedById:
      namedById,

    seriesById:
      seriesById
  };

  return TEOLODZHIYA_WORKGRAPH_MEMO;
}


function compactLogicalSingleton(row) {
  const base =
    compactCatalogueRow(row);

  return {
    id:
      base.sourceKey,

    sourceKey:
      base.sourceKey,

    workId:
      "source:" +
      base.sourceKey,

    entityKind:
      "source",

    defaultSourceKey:
      base.sourceKey,

    manifestationCount:
      1,

    manifestationSourceKeys:
      [base.sourceKey],

    author:
      base.author,

    title:
      base.title,

    mimeType:
      base.mimeType,

    registryName:
      base.registryName,

    sourceType:
      base.sourceType,

    originalId:
      base.originalId,

    link:
      base.link,

    pages:
      base.pages,

    extractionMethod:
      base.extractionMethod,

    indexedAt:
      base.indexedAt,

    indexFormatVersion:
      base.indexFormatVersion
  };
}


function compactLogicalWork(
  work,
  catalog
) {
  const sourceKeys =
    Array.isArray(
      work.manifestationSourceKeys
    )
      ? work.manifestationSourceKeys
          .map(function(value) {
            return String(value || "").trim();
          })
          .filter(function(sourceKey) {
            return !!catalog.bySourceKey[sourceKey];
          })
      : [];

  let defaultSourceKey =
    String(
      work.defaultSourceKey ||
      ""
    ).trim();

  if (
    !defaultSourceKey ||
    !catalog.bySourceKey[defaultSourceKey]
  ) {
    defaultSourceKey =
      sourceKeys.length
        ? sourceKeys[0]
        : "";
  }

  if (!defaultSourceKey) {
    return null;
  }

  const row =
    catalog.bySourceKey[
      defaultSourceKey
    ];

  const base =
    compactCatalogueRow(row);

  return {
    id:
      defaultSourceKey,

    sourceKey:
      defaultSourceKey,

    workId:
      String(
        work.workId ||
        ""
      ),

    entityKind:
      "work",

    defaultSourceKey:
      defaultSourceKey,

    manifestationCount:
      sourceKeys.length,

    manifestationSourceKeys:
      sourceKeys,

    author:
      base.author,

    title:
      String(
        work.title ||
        base.title ||
        ""
      ),

    baseTitle:
      String(
        work.baseTitle ||
        ""
      ),

    titleRelation:
      String(
        work.titleRelation ||
        ""
      ),

    semanticStatus:
      String(
        work.semanticStatus ||
        ""
      ),

    mimeType:
      base.mimeType,

    registryName:
      base.registryName,

    sourceType:
      base.sourceType,

    originalId:
      base.originalId,

    link:
      base.link,

    pages:
      base.pages,

    extractionMethod:
      base.extractionMethod,

    indexedAt:
      base.indexedAt,

    indexFormatVersion:
      base.indexFormatVersion
  };
}


function compactLogicalScanSeries(
  series,
  catalog
) {
  const pages =
    Array.isArray(series.pages)
      ? series.pages.filter(function(page) {
          const sourceKey =
            String(
              page &&
              page.sourceKey
                ? page.sourceKey
                : ""
            ).trim();

          return !!catalog.bySourceKey[sourceKey];
        })
      : [];

  const sourceKeys =
    pages.map(function(page) {
      return String(
        page.sourceKey ||
        ""
      );
    });

  let defaultSourceKey =
    String(
      series.defaultSourceKey ||
      ""
    ).trim();

  if (
    !defaultSourceKey ||
    !catalog.bySourceKey[defaultSourceKey]
  ) {
    defaultSourceKey =
      sourceKeys.length
        ? sourceKeys[0]
        : "";
  }

  if (!defaultSourceKey) {
    return null;
  }

  const row =
    catalog.bySourceKey[
      defaultSourceKey
    ];

  const base =
    compactCatalogueRow(row);

  return {
    id:
      defaultSourceKey,

    sourceKey:
      defaultSourceKey,

    workId:
      String(
        series.seriesId ||
        ""
      ),

    entityKind:
      "scanSeries",

    defaultSourceKey:
      defaultSourceKey,

    manifestationCount:
      sourceKeys.length,

    manifestationSourceKeys:
      sourceKeys,

    author:
      base.author,

    title:
      String(
        series.title ||
        base.title ||
        ""
      ),

    mimeType:
      base.mimeType,

    registryName:
      base.registryName,

    sourceType:
      base.sourceType,

    originalId:
      base.originalId,

    link:
      base.link,

    pages:
      Number(
        series.pageCount ||
        sourceKeys.length ||
        0
      ),

    extractionMethod:
      base.extractionMethod,

    indexedAt:
      base.indexedAt,

    indexFormatVersion:
      base.indexFormatVersion,

    scanPageStart:
      series.pageNumberStart == null
        ? null
        : Number(
            series.pageNumberStart
          ),

    scanPageEnd:
      series.pageNumberEnd == null
        ? null
        : Number(
            series.pageNumberEnd
          ),

    scanModifiedDate:
      String(
        series.modifiedDate ||
        ""
      ),

    confidence:
      String(
        series.confidence ||
        ""
      )
  };
}


function buildLogicalCatalogRows() {
  const catalog =
    getActiveCatalog();

  const graph =
    getWorkGraph();

  const results = [];
  const consumed = {};

  for (const work of graph.namedWorks) {
    const compact =
      compactLogicalWork(
        work,
        catalog
      );

    if (!compact) {
      continue;
    }

    results.push(compact);

    for (
      const sourceKey
      of compact.manifestationSourceKeys
    ) {
      consumed[sourceKey] = true;
    }
  }

  for (const series of graph.scanSeries) {
    const compact =
      compactLogicalScanSeries(
        series,
        catalog
      );

    if (!compact) {
      continue;
    }

    results.push(compact);

    for (
      const sourceKey
      of compact.manifestationSourceKeys
    ) {
      consumed[sourceKey] = true;
    }
  }

  const activeKeys =
    Object.keys(
      catalog.bySourceKey
    );

  for (const sourceKey of activeKeys) {
    if (consumed[sourceKey]) {
      continue;
    }

    results.push(
      compactLogicalSingleton(
        catalog.bySourceKey[sourceKey]
      )
    );
  }

  return results;
}


function compareLogicalCatalogueRows(
  a,
  b,
  sortMode
) {
  if (sortMode === "indexed") {
    const ai =
      String(a.indexedAt || "");

    const bi =
      String(b.indexedAt || "");

    if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }

  if (sortMode === "author") {
    const aa =
      String(a.author || "");

    const ba =
      String(b.author || "");

    if (!!aa !== !!ba) {
      return aa ? -1 : 1;
    }

    const byAuthor =
      aa.localeCompare(
        ba,
        "bg",
        { sensitivity: "base" }
      );

    if (byAuthor !== 0) {
      return byAuthor;
    }
  }

  const byTitle =
    String(a.title || "")
      .localeCompare(
        String(b.title || ""),
        "bg",
        { sensitivity: "base" }
      );

  if (byTitle !== 0) {
    return byTitle;
  }

  return String(a.workId || "")
    .localeCompare(
      String(b.workId || "")
    );
}


function listLibraryWorks(
  page,
  pageSize,
  sortMode
) {
  page =
    Math.max(
      1,
      Number(page) || 1
    );

  pageSize =
    Math.max(
      1,
      Math.min(
        Number(pageSize) || 250,
        500
      )
    );

  sortMode =
    normalizeCatalogueSort(
      sortMode
    );

  const catalog =
    getActiveCatalog();

  const graph =
    getWorkGraph();

  const rows =
    buildLogicalCatalogRows()
      .sort(function(a, b) {
        return compareLogicalCatalogueRows(
          a,
          b,
          sortMode
        );
      });

  const total =
    rows.length;

  const totalPages =
    total === 0
      ? 0
      : Math.ceil(
          total / pageSize
        );

  const start =
    (page - 1) * pageSize;

  const selected =
    start >= total
      ? []
      : rows.slice(
          start,
          start + pageSize
        );

  let knownAuthors = 0;

  for (const row of rows) {
    if (String(row.author || "").trim()) {
      knownAuthors++;
    }
  }

  return {
    corpus:
      "Teolodzhia Orthodox Library",

    authoritativeCatalog:
      CATALOG_GZIP_NAME,

    workgraph:
      WORKGRAPH_GZIP_NAME,

    view:
      "works",

    indexFormatVersion:
      TEOLODZHIYA_INDEX_FORMAT,

    total:
      total,

    sourceTotal:
      catalog.activeCount,

    logicalReduction:
      catalog.activeCount -
      total,

    page:
      page,

    pageSize:
      pageSize,

    totalPages:
      totalPages,

    returned:
      selected.length,

    hasMore:
      totalPages > 0 &&
      page < totalPages,

    nextPage:
      (
        totalPages > 0 &&
        page < totalPages
      )
        ? page + 1
        : null,

    sort:
      sortMode,

    authorMetadata:
      {
        explicitAuthors:
          knownAuthors,

        missingAuthors:
          total -
          knownAuthors,

        note:
          "Author is returned only when explicit author metadata exists; it is never guessed from the filename."
      },

    catalogModifiedTime:
      catalog.modifiedTime,

    workgraphModifiedTime:
      graph.modifiedTime,

    workgraphCatalogSha256:
      graph.catalogSha256,

    results:
      selected
  };
}


/* ============================================================
 * EXHAUSTIVE ACTIVE CATALOG LIST
 *
 * Unlike searchLibrary(), this operation is NOT relevance search.
 * It lists the authoritative completed corpus from catalog.jsonl.gz
 * with deterministic pagination.
 *
 * This is the operation to use when the user asks:
 * - how many sources exist;
 * - show/list all sources;
 * - make a complete A-Z/A-Я catalogue;
 * - export the complete source inventory.
 * ============================================================ */

function normalizeCatalogueSort(value) {
  value = String(value || "title")
    .trim()
    .toLowerCase();

  if (
    value === "author" ||
    value === "title" ||
    value === "indexed"
  ) {
    return value;
  }

  return "title";
}


function catalogueAuthor(row) {
  // The current V2.5 catalog does not guarantee an author field.
  // Return only explicit metadata; never infer author from the title.
  return String(
    row.author ||
    row.creator ||
    row.sourceAuthor ||
    ""
  ).trim();
}


function cataloguePages(row) {
  if (
    row.extraction &&
    row.extraction.pageCount != null
  ) {
    return row.extraction.pageCount;
  }

  if (row.pages != null) {
    return row.pages;
  }

  return null;
}


function compactCatalogueRow(row) {
  return {
    id:
      String(row.sourceKey || ""),

    sourceKey:
      String(row.sourceKey || ""),

    author:
      catalogueAuthor(row),

    title:
      String(row.title || ""),

    mimeType:
      String(row.mimeType || ""),

    registryName:
      String(row.registryName || ""),

    sourceType:
      String(row.sourceType || ""),

    originalId:
      String(row.originalId || ""),

    link:
      String(row.sourceLink || ""),

    pages:
      cataloguePages(row),

    extractionMethod:
      String(
        (
          row.extraction &&
          row.extraction.method
        ) ||
        row.extractionMethod ||
        ""
      ),

    indexedAt:
      String(row.indexedAt || ""),

    indexFormatVersion:
      String(
        row.indexFormatVersion ||
        TEOLODZHIYA_INDEX_FORMAT
      )
  };
}


function compareCatalogueRows(a, b, sortMode) {
  if (sortMode === "indexed") {
    const ai = String(a.indexedAt || "");
    const bi = String(b.indexedAt || "");

    if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }

  if (sortMode === "author") {
    const aa = catalogueAuthor(a);
    const ba = catalogueAuthor(b);

    // Sources without explicit author metadata go after known authors.
    if (!!aa !== !!ba) {
      return aa ? -1 : 1;
    }

    const byAuthor =
      aa.localeCompare(
        ba,
        "bg",
        { sensitivity: "base" }
      );

    if (byAuthor !== 0) {
      return byAuthor;
    }
  }

  const at = String(a.title || "");
  const bt = String(b.title || "");

  const byTitle =
    at.localeCompare(
      bt,
      "bg",
      { sensitivity: "base" }
    );

  if (byTitle !== 0) {
    return byTitle;
  }

  return String(a.sourceKey || "")
    .localeCompare(
      String(b.sourceKey || "")
    );
}


function listLibrarySources(
  page,
  pageSize,
  sortMode
) {
  page =
    Math.max(
      1,
      Number(page) || 1
    );

  pageSize =
    Math.max(
      1,
      Math.min(
        Number(pageSize) || 250,
        500
      )
    );

  sortMode =
    normalizeCatalogueSort(
      sortMode
    );

  const catalog =
    getActiveCatalog();

  const rows =
    Object.keys(
      catalog.bySourceKey
    )
      .map(function(key) {
        return catalog.bySourceKey[key];
      })
      .sort(function(a, b) {
        return compareCatalogueRows(
          a,
          b,
          sortMode
        );
      });

  const total =
    rows.length;

  const totalPages =
    total === 0
      ? 0
      : Math.ceil(
          total / pageSize
        );

  const start =
    (page - 1) * pageSize;

  const selected =
    start >= total
      ? []
      : rows.slice(
          start,
          start + pageSize
        );

  const results =
    selected.map(
      compactCatalogueRow
    );

  let knownAuthors = 0;

  for (const row of rows) {
    if (catalogueAuthor(row)) {
      knownAuthors++;
    }
  }

  return {
    corpus:
      "Teolodzhia Orthodox Library",

    authoritativeCatalog:
      CATALOG_GZIP_NAME,

    indexFormatVersion:
      TEOLODZHIYA_INDEX_FORMAT,

    total:
      total,

    page:
      page,

    pageSize:
      pageSize,

    totalPages:
      totalPages,

    returned:
      results.length,

    hasMore:
      totalPages > 0 &&
      page < totalPages,

    nextPage:
      (
        totalPages > 0 &&
        page < totalPages
      )
        ? page + 1
        : null,

    sort:
      sortMode,

    authorMetadata:
      {
        explicitAuthors:
          knownAuthors,

        missingAuthors:
          total -
          knownAuthors,

        note:
          "Author is returned only when explicit author metadata exists in the V2.5 catalog; it is never guessed from the filename."
      },

    catalogModifiedTime:
      catalog.modifiedTime,

    results:
      results
  };
}


function testCorpusList() {
  const result =
    listLibrarySources(
      1,
      25,
      "title"
    );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}


/* ============================================================
 * SEARCH OVER V2.5 search.txt
 * ============================================================ */

function driveSearchIndexFiles(q, maxFiles) {
  maxFiles = Math.max(
    1,
    Math.min(
      Number(maxFiles) || MAX_DRIVE_SEARCH_CANDIDATES,
      MAX_DRIVE_SEARCH_CANDIDATES
    )
  );

  const all = [];
  let pageToken = null;

  while (all.length < maxFiles) {
    const pageSize = Math.min(100, maxFiles - all.length);

    const params = {
      q: q,
      pageSize: pageSize,
      spaces: "drive",
      fields:
        "nextPageToken," +
        "files(" +
          "id," +
          "name," +
          "mimeType," +
          "parents," +
          "description," +
          "modifiedTime," +
          "size" +
        ")"
    };

    if (pageToken) {
      params.pageToken = pageToken;
    }

    const response = Drive.Files.list(params);
    const files = response.files || [];

    for (const file of files) {
      all.push(file);

      if (all.length >= maxFiles) {
        break;
      }
    }

    pageToken = response.nextPageToken || null;

    if (!pageToken || files.length === 0) {
      break;
    }
  }

  return all;
}



function parseSearchFileRecord(file) {
  const description =
    safeJsonParse(file.description, {}) || {};

  const sourceKey =
    String(description.sourceKey || "").trim();

  if (!sourceKey) {
    return null;
  }

  const activeCatalog = getActiveCatalog();
  const catalogRow =
    activeCatalog.bySourceKey[sourceKey];

  if (!catalogRow) {
    return null;
  }

  return {
    searchFileId:
      file.id,

    bookFolderId:
      (file.parents || [])[0] || "",

    sourceKey:
      sourceKey,

    title:
      String(
        catalogRow.title ||
        description.title ||
        ""
      ),

    sourceType:
      String(
        catalogRow.sourceType ||
        description.sourceType ||
        ""
      ),

    registryName:
      String(
        catalogRow.registryName ||
        description.registryName ||
        ""
      ),

    originalId:
      String(
        catalogRow.originalId ||
        description.originalId ||
        ""
      ),

    sourceLink:
      String(
        catalogRow.sourceLink ||
        description.sourceLink ||
        ""
      ),

    mimeType:
      String(
        catalogRow.mimeType ||
        description.mimeType ||
        ""
      ),

    pages:
      (
        catalogRow.extraction &&
        catalogRow.extraction.pageCount != null
      )
        ? catalogRow.extraction.pageCount
        : (
            catalogRow.pages != null
              ? catalogRow.pages
              : (
                  description.pages == null
                    ? null
                    : description.pages
                )
          ),

    extractionMethod:
      String(
        (
          catalogRow.extraction &&
          catalogRow.extraction.method
        ) ||
        catalogRow.extractionMethod ||
        description.extractionMethod ||
        ""
      ),

    modifiedTime:
      String(
        catalogRow.modifiedTime ||
        file.modifiedTime ||
        ""
      ),

    indexedAt:
      String(
        catalogRow.indexedAt || ""
      )
  };
}


function scoreIndexedResult(record, query, terms, isStrict) {
  const title = String(record.title || "").toLowerCase();
  const library =
    String(record.registryName || "").toLowerCase();
  const wholeQuery =
    String(query || "").toLowerCase();

  let score = isStrict ? 1000 : 0;

  if (
    wholeQuery &&
    title.indexOf(wholeQuery) !== -1
  ) {
    score += 120;
  }

  for (const term of terms) {
    const lower = term.toLowerCase();

    if (title.indexOf(lower) !== -1) {
      score += 28;
    }

    if (library.indexOf(lower) !== -1) {
      score += 8;
    }
  }

  // A tiny stable bonus for page-aware material.
  if (record.pages != null) {
    score += 1;
  }

  return score;
}


function searchLibrarySources(
  query,
  maxResults,
  maxAllowed
) {
  query = String(query || "").trim();

  maxAllowed =
    Math.max(
      MAX_SEARCH_RESULTS,
      Math.min(
        Number(maxAllowed) ||
        MAX_SEARCH_RESULTS,
        MAX_WORK_SEARCH_SOURCE_CANDIDATES
      )
    );

  maxResults = Math.max(
    1,
    Math.min(
      Number(maxResults) || 8,
      maxAllowed
    )
  );

  const terms = getSearchTerms(query);

  if (!terms.length) {
    return {
      query: query,
      count: 0,
      error:
        "Няма достатъчно значими думи за търсене.",
      results: []
    };
  }

  const base =
    "trashed = false " +
    "and name = '" + escapeDriveSearch(SEARCH_FILE_NAME) + "'";

  const strictConditions = terms.map(function(term) {
    return (
      "fullText contains '" +
      escapeDriveSearch(term) +
      "'"
    );
  });

  const strictQuery =
    base +
    " and (" +
    strictConditions.join(" and ") +
    ")";

  const strictFiles =
    driveSearchIndexFiles(
      strictQuery,
      MAX_DRIVE_SEARCH_CANDIDATES
    );

  const strictIds = {};
  const mergedById = {};

  for (const file of strictFiles) {
    strictIds[file.id] = true;
    mergedById[file.id] = file;
  }

  if (
    strictFiles.length < maxResults &&
    terms.length > 1
  ) {
    const broadConditions = terms.map(function(term) {
      return (
        "fullText contains '" +
        escapeDriveSearch(term) +
        "'"
      );
    });

    const broadQuery =
      base +
      " and (" +
      broadConditions.join(" or ") +
      ")";

    const broadFiles =
      driveSearchIndexFiles(
        broadQuery,
        MAX_DRIVE_SEARCH_CANDIDATES
      );

    for (const file of broadFiles) {
      if (!mergedById[file.id]) {
        mergedById[file.id] = file;
      }
    }
  }

  const bySourceKey = {};

  for (const id in mergedById) {
    const file = mergedById[id];
    const record = parseSearchFileRecord(file);

    if (!record) {
      continue;
    }

    const isStrict = !!strictIds[file.id];
    const score =
      scoreIndexedResult(
        record,
        query,
        terms,
        isStrict
      );

    const existing = bySourceKey[record.sourceKey];

    if (
      !existing ||
      score > existing.score
    ) {
      bySourceKey[record.sourceKey] = {
        record: record,
        isStrict: isStrict,
        score: score
      };
    }
  }

  const ranked = Object.keys(bySourceKey)
    .map(function(key) {
      return bySourceKey[key];
    })
    .sort(function(a, b) {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return String(a.record.title || "")
        .localeCompare(
          String(b.record.title || ""),
          "bg"
        );
    });

  const selected =
    ranked.slice(0, maxResults);

  const results =
    selected.map(function(item) {
      const r = item.record;

      return {
        // Backwards-compatible key expected by the existing Worker/GPT Action.
        id: r.sourceKey,

        // Explicit logical identifier for the V2.5 corpus.
        sourceKey: r.sourceKey,

        name: r.title,
        mimeType: r.mimeType,
        link: r.sourceLink,
        modifiedTime: r.modifiedTime,

        match:
          item.isStrict
            ? "strict"
            : "broad",

        score: item.score,

        registryName: r.registryName,
        sourceType: r.sourceType,
        originalId: r.originalId,
        pages: r.pages,
        extractionMethod:
          r.extractionMethod,

        indexFormatVersion:
          TEOLODZHIYA_INDEX_FORMAT
      };
    });

  return {
    query: query,
    view: "sources",
    searchTerms: terms,
    strictMatches:
      results.filter(function(item) {
        return item.match === "strict";
      }).length,
    count: results.length,
    results: results
  };
}



function logicalSearchEntity(
  sourceResult,
  graph
) {
  const sourceKey =
    String(
      sourceResult.sourceKey ||
      sourceResult.id ||
      ""
    ).trim();

  const mapping =
    graph.sourceToEntity[
      sourceKey
    ];

  if (
    !mapping ||
    !mapping.kind ||
    !mapping.id
  ) {
    return {
      entityKey:
        "source:" +
        sourceKey,

      workId:
        "source:" +
        sourceKey,

      entityKind:
        "source",

      title:
        String(
          sourceResult.name ||
          ""
        ),

      defaultSourceKey:
        sourceKey,

      manifestationCount:
        1,

      manifestationSourceKeys:
        [sourceKey]
    };
  }

  if (
    mapping.kind === "work"
  ) {
    const work =
      graph.namedById[
        String(mapping.id)
      ];

    if (work) {
      return {
        entityKey:
          "work:" +
          String(work.workId || ""),

        workId:
          String(work.workId || ""),

        entityKind:
          "work",

        title:
          String(
            work.title ||
            sourceResult.name ||
            ""
          ),

        defaultSourceKey:
          String(
            work.defaultSourceKey ||
            sourceKey
          ),

        manifestationCount:
          Number(
            work.manifestationCount ||
            (
              Array.isArray(
                work.manifestationSourceKeys
              )
                ? work.manifestationSourceKeys.length
                : 0
            ) ||
            1
          ),

        manifestationSourceKeys:
          Array.isArray(
            work.manifestationSourceKeys
          )
            ? work.manifestationSourceKeys.slice()
            : [sourceKey]
      };
    }
  }

  if (
    mapping.kind === "scanSeries"
  ) {
    const series =
      graph.seriesById[
        String(mapping.id)
      ];

    if (series) {
      const pageSourceKeys =
        Array.isArray(series.pages)
          ? series.pages.map(function(page) {
              return String(
                page &&
                page.sourceKey
                  ? page.sourceKey
                  : ""
              );
            }).filter(Boolean)
          : [sourceKey];

      return {
        entityKey:
          "scanSeries:" +
          String(
            series.seriesId ||
            ""
          ),

        workId:
          String(
            series.seriesId ||
            ""
          ),

        entityKind:
          "scanSeries",

        title:
          String(
            series.title ||
            sourceResult.name ||
            ""
          ),

        defaultSourceKey:
          String(
            series.defaultSourceKey ||
            sourceKey
          ),

        manifestationCount:
          pageSourceKeys.length,

        manifestationSourceKeys:
          pageSourceKeys,

        scanPageStart:
          series.pageNumberStart == null
            ? null
            : Number(
                series.pageNumberStart
              ),

        scanPageEnd:
          series.pageNumberEnd == null
            ? null
            : Number(
                series.pageNumberEnd
              )
      };
    }
  }

  return {
    entityKey:
      "source:" +
      sourceKey,

    workId:
      "source:" +
      sourceKey,

    entityKind:
      "source",

    title:
      String(
        sourceResult.name ||
        ""
      ),

    defaultSourceKey:
      sourceKey,

    manifestationCount:
      1,

    manifestationSourceKeys:
      [sourceKey]
  };
}


function searchLibraryWorks(
  query,
  maxResults
) {
  maxResults =
    Math.max(
      1,
      Math.min(
        Number(maxResults) || 8,
        MAX_SEARCH_RESULTS
      )
    );

  const sourceCandidateLimit =
    Math.min(
      MAX_WORK_SEARCH_SOURCE_CANDIDATES,
      Math.max(
        20,
        maxResults * 5
      )
    );

  const sourceSearch =
    searchLibrarySources(
      query,
      sourceCandidateLimit,
      MAX_WORK_SEARCH_SOURCE_CANDIDATES
    );

  if (
    sourceSearch.error ||
    !Array.isArray(sourceSearch.results)
  ) {
    return {
      query:
        String(query || ""),

      view:
        "works",

      count:
        0,

      error:
        sourceSearch.error ||
        "Source search failed.",

      results:
        []
    };
  }

  const graph =
    getWorkGraph();

  const grouped = {};

  for (
    const result
    of sourceSearch.results
  ) {
    const entity =
      logicalSearchEntity(
        result,
        graph
      );

    const entityKey =
      entity.entityKey;

    if (!grouped[entityKey]) {
      grouped[entityKey] = {
        entity:
          entity,

        best:
          result,

        score:
          Number(
            result.score ||
            0
          ),

        strict:
          result.match === "strict",

        matchingSourceKeys:
          []
      };
    }

    const group =
      grouped[entityKey];

    const sourceKey =
      String(
        result.sourceKey ||
        result.id ||
        ""
      );

    if (
      group.matchingSourceKeys.indexOf(
        sourceKey
      ) === -1
    ) {
      group.matchingSourceKeys.push(
        sourceKey
      );
    }

    if (
      Number(result.score || 0) >
      group.score
    ) {
      group.best =
        result;

      group.score =
        Number(
          result.score ||
          0
        );
    }

    if (
      result.match === "strict"
    ) {
      group.strict = true;
    }
  }

  const ranked =
    Object.keys(grouped)
      .map(function(key) {
        return grouped[key];
      })
      .sort(function(a, b) {
        if (b.score !== a.score) {
          return b.score - a.score;
        }

        return String(
          a.entity.title ||
          ""
        )
          .localeCompare(
            String(
              b.entity.title ||
              ""
            ),
            "bg",
            { sensitivity: "base" }
          );
      });

  const selected =
    ranked.slice(
      0,
      maxResults
    );

  const results =
    selected.map(function(group) {
      const best =
        group.best;

      const entity =
        group.entity;

      return {
        // Keep id/sourceKey readable by the existing /read route.
        id:
          String(
            best.sourceKey ||
            best.id ||
            entity.defaultSourceKey ||
            ""
          ),

        sourceKey:
          String(
            best.sourceKey ||
            best.id ||
            entity.defaultSourceKey ||
            ""
          ),

        workId:
          entity.workId,

        entityKind:
          entity.entityKind,

        name:
          entity.title,

        defaultSourceKey:
          entity.defaultSourceKey,

        manifestationCount:
          entity.manifestationCount,

        manifestationSourceKeys:
          entity.manifestationSourceKeys,

        matchingSourceKeys:
          group.matchingSourceKeys,

        mimeType:
          best.mimeType,

        link:
          best.link,

        modifiedTime:
          best.modifiedTime,

        match:
          group.strict
            ? "strict"
            : "broad",

        score:
          group.score,

        registryName:
          best.registryName,

        sourceType:
          best.sourceType,

        originalId:
          best.originalId,

        pages:
          best.pages,

        extractionMethod:
          best.extractionMethod,

        scanPageStart:
          entity.scanPageStart == null
            ? null
            : entity.scanPageStart,

        scanPageEnd:
          entity.scanPageEnd == null
            ? null
            : entity.scanPageEnd,

        indexFormatVersion:
          TEOLODZHIYA_INDEX_FORMAT
      };
    });

  return {
    query:
      String(query || ""),

    view:
      "works",

    searchTerms:
      sourceSearch.searchTerms || [],

    strictMatches:
      results.filter(function(item) {
        return item.match === "strict";
      }).length,

    sourceCandidatesConsidered:
      sourceSearch.count,

    count:
      results.length,

    results:
      results
  };
}


function searchLibrary(
  query,
  maxResults,
  view
) {
  view =
    normalizeLibraryView(
      view
    );

  if (view === "works") {
    return searchLibraryWorks(
      query,
      maxResults
    );
  }

  return searchLibrarySources(
    query,
    maxResults,
    MAX_SEARCH_RESULTS
  );
}


/* ============================================================
 * READ FROM V2.5 chunks.jsonl.gz
 * ============================================================ */

function buildContentTerms(queryTerms, fileName) {
  const lowerName =
    String(fileName || "").toLowerCase();

  let contentTerms =
    queryTerms.filter(function(term) {
      return (
        lowerName.indexOf(
          String(term).toLowerCase()
        ) === -1
      );
    });

  if (!contentTerms.length) {
    contentTerms = queryTerms.slice();
  }

  return contentTerms;
}


function countOccurrences(haystack, needle, limit) {
  haystack = String(haystack || "");
  needle = String(needle || "");

  if (!needle) {
    return 0;
  }

  const regex =
    new RegExp(
      escapeRegExp(needle),
      "gi"
    );

  const matches =
    haystack.match(regex);

  if (!matches) {
    return 0;
  }

  return Math.min(
    matches.length,
    Number(limit) || 20
  );
}


function scoreChunk(
  chunk,
  allTerms,
  contentTerms
) {
  const searchText =
    String(
      chunk.searchText ||
      chunk.rawText ||
      chunk.text ||
      ""
    );

  const lower =
    searchText.toLowerCase();

  const matchedContentTerms =
    contentTerms.filter(function(term) {
      return (
        lower.indexOf(
          String(term).toLowerCase()
        ) !== -1
      );
    });

  const matchedAllTerms =
    allTerms.filter(function(term) {
      return (
        lower.indexOf(
          String(term).toLowerCase()
        ) !== -1
      );
    });

  if (!matchedAllTerms.length) {
    return null;
  }

  let score =
    matchedContentTerms.length * 1000 +
    matchedAllTerms.length * 80;

  if (
    contentTerms.length &&
    matchedContentTerms.length ===
      contentTerms.length
  ) {
    score += 600;
  }

  for (const term of contentTerms) {
    score +=
      countOccurrences(
        searchText,
        term,
        20
      ) * 12;
  }

  const textQuality =
    Number(chunk.textQuality);

  if (!isNaN(textQuality)) {
    score += Math.round(
      Math.max(0, Math.min(1, textQuality)) * 20
    );
  }

  const ocrConfidence =
    Number(chunk.ocrConfidence);

  if (!isNaN(ocrConfidence)) {
    score += Math.round(
      Math.max(0, Math.min(1, ocrConfidence)) * 10
    );
  }

  return {
    chunk: chunk,
    score: score,
    matchedContentTerms:
      matchedContentTerms,
    matchedAllTerms:
      matchedAllTerms
  };
}


function excerptFromRawChunk(
  rawText,
  preferredTerms,
  fallbackTerms
) {
  rawText = String(rawText || "");

  if (!rawText) {
    return "";
  }

  const lower =
    rawText.toLowerCase();

  const terms =
    preferredTerms
      .concat(fallbackTerms)
      .filter(function(value, index, arr) {
        const lowerValue =
          String(value || "").toLowerCase();

        return (
          lowerValue &&
          arr.findIndex(function(v) {
            return (
              String(v || "").toLowerCase() ===
              lowerValue
            );
          }) === index
        );
      });

  let found = -1;

  for (const term of terms) {
    const pos =
      lower.indexOf(
        String(term).toLowerCase()
      );

    if (
      pos !== -1 &&
      (found === -1 || pos < found)
    ) {
      found = pos;
    }
  }

  if (found === -1) {
    return cleanExcerpt(
      rawText.substring(
        0,
        MAX_EXCERPT_CHARS
      )
    );
  }

  const before = 650;
  const after =
    MAX_EXCERPT_CHARS - before;

  let start =
    Math.max(
      0,
      found - before
    );

  let end =
    Math.min(
      rawText.length,
      found + after
    );

  // Prefer clean paragraph boundaries where possible.
  const previousBreak =
    rawText.lastIndexOf(
      "\n",
      found
    );

  if (
    previousBreak >= 0 &&
    previousBreak >= start - 250
  ) {
    start = Math.max(
      0,
      previousBreak + 1
    );
  }

  const nextBreak =
    rawText.indexOf(
      "\n",
      end
    );

  if (
    nextBreak !== -1 &&
    nextBreak <= end + 250
  ) {
    end = nextBreak;
  }

  return cleanExcerpt(
    rawText.substring(
      start,
      end
    )
  );
}


function getSourceExcerpts(
  fileId,
  query,
  maxExcerpts
) {
  const sourceKey =
    String(fileId || "").trim();

  query =
    String(query || "").trim();

  maxExcerpts =
    Math.max(
      1,
      Math.min(
        Number(maxExcerpts) || 4,
        MAX_READ_EXCERPTS
      )
    );

  if (!sourceKey) {
    throw new Error("Missing fileId/sourceKey.");
  }

  if (!query) {
    throw new Error("Missing query.");
  }

  requireActiveSourceKey(sourceKey);

  const folder =
    findBookFolderBySourceKey(
      sourceKey
    );

  const metadataFile =
    findChildFile(
      folder.id,
      METADATA_FILE_NAME
    );

  const chunksFile =
    findChildFile(
      folder.id,
      CHUNKS_FILE_NAME
    );

  if (!chunksFile) {
    throw new Error(
      "chunks.jsonl.gz not found for sourceKey: " +
      sourceKey
    );
  }

  let metadata = {};

  if (metadataFile) {
    try {
      metadata =
        readJsonFile(
          metadataFile.id
        );
    } catch (e) {
      metadata = {};
    }
  }

  const chunks =
    readGzipJsonl(
      chunksFile.id
    );

  if (!chunks.length) {
    throw new Error(
      "No readable chunks found for sourceKey: " +
      sourceKey
    );
  }

  const fileName =
    String(
      metadata.title ||
      String(folder.name || "")
        .replace(
          sourceKey + "__",
          ""
        )
    );

  const allTerms =
    getSearchTerms(query);

  const contentTerms =
    buildContentTerms(
      allTerms,
      fileName
    );

  const ranked = [];
  let extractedCharacters = 0;

  for (const chunk of chunks) {
    const rawText =
      String(
        chunk.rawText ||
        chunk.text ||
        ""
      );

    extractedCharacters +=
      rawText.length;

    const scored =
      scoreChunk(
        chunk,
        allTerms,
        contentTerms
      );

    if (scored) {
      ranked.push(scored);
    }
  }

  ranked.sort(function(a, b) {
    return b.score - a.score;
  });

  const selected = [];
  const seenChunkNumbers = {};

  for (const item of ranked) {
    const chunk =
      item.chunk || {};

    const chunkNumber =
      String(
        chunk.chunk == null
          ? selected.length + 1
          : chunk.chunk
      );

    if (seenChunkNumbers[chunkNumber]) {
      continue;
    }

    seenChunkNumbers[chunkNumber] = true;

    const rawText =
      String(
        chunk.rawText ||
        chunk.text ||
        ""
      );

    const excerpt =
      excerptFromRawChunk(
        rawText,
        item.matchedContentTerms,
        item.matchedAllTerms
      );

    if (!excerpt) {
      continue;
    }

    selected.push({
      score:
        item.score,

      matchedTerms:
        item.matchedContentTerms,

      text:
        excerpt,

      chunk:
        chunk.chunk == null
          ? null
          : chunk.chunk,

      pageStart:
        chunk.pageStart == null
          ? null
          : chunk.pageStart,

      pageEnd:
        chunk.pageEnd == null
          ? null
          : chunk.pageEnd,

      textOrigin:
        String(
          chunk.textOrigin ||
          "unknown"
        ),

      textQuality:
        chunk.textQuality == null
          ? null
          : chunk.textQuality,

      linguisticQuality:
        chunk.linguisticQuality == null
          ? null
          : chunk.linguisticQuality,

      garbageRatio:
        chunk.garbageRatio == null
          ? null
          : chunk.garbageRatio,

      ocrConfidence:
        chunk.ocrConfidence == null
          ? null
          : chunk.ocrConfidence
    });

    if (
      selected.length >=
      maxExcerpts
    ) {
      break;
    }
  }

  return {
    // Backwards-compatible field name.
    fileId:
      sourceKey,

    sourceKey:
      sourceKey,

    fileName:
      fileName,

    mimeType:
      String(
        metadata.mimeType || ""
      ),

    link:
      String(
        metadata.sourceLink || ""
      ),

    registryName:
      String(
        metadata.registryName || ""
      ),

    query:
      query,

    extractedCharacters:
      extractedCharacters,

    chunkCount:
      chunks.length,

    excerptCount:
      selected.length,

    indexFormatVersion:
      String(
        metadata.indexFormatVersion ||
        TEOLODZHIYA_INDEX_FORMAT
      ),

    excerpts:
      selected
  };
}


/* ============================================================
 * STATUS / TESTS
 * ============================================================ */

function countIndexedBookFolders() {
  const booksRootId =
    getBooksRootId();

  const q =
    "'" + escapeDriveSearch(booksRootId) + "' in parents " +
    "and trashed = false " +
    "and mimeType = '" + GOOGLE_FOLDER_MIME + "'";

  let count = 0;
  let pageToken = null;

  do {
    const params = {
      q: q,
      pageSize: 1000,
      spaces: "drive",
      fields: "nextPageToken,files(id)"
    };

    if (pageToken) {
      params.pageToken =
        pageToken;
    }

    const response =
      Drive.Files.list(params);

    count +=
      (response.files || []).length;

    pageToken =
      response.nextPageToken || null;

  } while (pageToken);

  return count;
}



function testCorpusStatus() {
  const physicalBookFolders =
    countIndexedBookFolders();

  const catalog =
    getActiveCatalog();

  const result = {
    indexRootId:
      TEOLODZHIYA_INDEX_ROOT_ID,

    booksRootId:
      getBooksRootId(),

    indexFormatVersion:
      TEOLODZHIYA_INDEX_FORMAT,

    apiVersion:
      TEOLODZHIYA_API_VERSION,

    physicalBookFolders:
      physicalBookFolders,

    activeCatalogRows:
      catalog.rowCount,

    activeCatalogSources:
      catalog.activeCount,

    catalogMalformedRows:
      catalog.malformedRows,

    inactiveOrOldBookFolders:
      Math.max(
        0,
        physicalBookFolders -
        catalog.activeCount
      ),

    catalogModifiedTime:
      catalog.modifiedTime,

    workgraph:
      (function() {
        try {
          const graph = getWorkGraph();
          return {
            ok: true,
            fileId: graph.fileId,
            modifiedTime: graph.modifiedTime,
            schemaVersion: graph.schemaVersion,
            catalogRows: graph.catalogRows,
            catalogSha256: graph.catalogSha256,
            namedWorks: graph.namedWorks.length,
            scanSeries: graph.scanSeries.length
          };
        } catch (error) {
          return {
            ok: false,
            error:
              String(
                error &&
                error.message
                  ? error.message
                  : error
              )
          };
        }
      })()
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}


function testCorpusSearch() {
  const result =
    searchLibrary(
      "Максим Изповедник любов",
      5
    );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}


function testCorpusRead() {
  const search =
    searchLibrary(
      "Максим Изповедник любов",
      5
    );

  if (
    !search.results ||
    !search.results.length
  ) {
    throw new Error(
      "Search returned no result."
    );
  }

  const first =
    search.results[0];

  const result =
    getSourceExcerpts(
      first.id,
      "Максим Изповедник любов",
      3
    );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}




function testCorpusReadDirect() {
  const sourceKey =
    "5de687b68d38838f3b226237";

  const result =
    getSourceExcerpts(
      sourceKey,
      "Максим Изповедник любов",
      3
    );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}



function testCorpusListWorks() {
  const result =
    listLibraryWorks(
      1,
      25,
      "title"
    );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}


function testCorpusSearchWorks() {
  const result =
    searchLibrary(
      "Пастирско богословие",
      8,
      "works"
    );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}


/* ============================================================
 * API HANDLER
 * ============================================================ */

function handleLibraryApiRequest(params) {
  params = params || {};

  validateApiSecret(
    params.secret
  );

  const operation =
    String(
      params.op || ""
    )
      .trim()
      .toLowerCase();

  if (operation === "list") {
    const page =
      Math.max(
        1,
        Number(params.page) || 1
      );

    const pageSize =
      Math.max(
        1,
        Math.min(
          Number(params.pageSize) || 250,
          500
        )
      );

    const sortMode =
      normalizeCatalogueSort(
        params.sort
      );

    const view =
      normalizeLibraryView(
        params.view
      );

    const result =
      view === "works"
        ? listLibraryWorks(
            page,
            pageSize,
            sortMode
          )
        : listLibrarySources(
            page,
            pageSize,
            sortMode
          );

    return jsonResponse({
      ok: true,
      operation:
        "list",
      data:
        result
    });
  }

  if (operation === "search") {
    const query =
      String(
        params.query || ""
      ).trim();

    if (!query) {
      return jsonResponse({
        ok: false,
        error:
          "Missing query."
      });
    }

    const maxResults =
      Math.max(
        1,
        Math.min(
          Number(
            params.maxResults
          ) || 8,
          MAX_SEARCH_RESULTS
        )
      );

    const view =
      normalizeLibraryView(
        params.view
      );

    const result =
      searchLibrary(
        query,
        maxResults,
        view
      );

    return jsonResponse({
      ok: true,
      operation:
        "search",
      data:
        result
    });
  }

  if (operation === "read") {
    const fileId =
      String(
        params.fileId || ""
      ).trim();

    const query =
      String(
        params.query || ""
      ).trim();

    if (!fileId) {
      return jsonResponse({
        ok: false,
        error:
          "Missing fileId."
      });
    }

    if (!query) {
      return jsonResponse({
        ok: false,
        error:
          "Missing query."
      });
    }

    const maxExcerpts =
      Math.max(
        1,
        Math.min(
          Number(
            params.maxExcerpts
          ) || 4,
          MAX_READ_EXCERPTS
        )
      );

    const result =
      getSourceExcerpts(
        fileId,
        query,
        maxExcerpts
      );

    return jsonResponse({
      ok: true,
      operation:
        "read",
      data:
        result
    });
  }

  return jsonResponse({
    ok: false,
    error:
      "Unknown operation."
  });
}


/* ============================================================
 * PRIVACY
 * ============================================================ */

function getPrivacyPolicyHtml() {
  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Teolodzhia Library Privacy Policy</title>
</head>
<body>
<h1>Teolodzhia Library Privacy Policy</h1>

<p>
This service provides read-only search access to the indexed
theological research corpus used by the public Teolodzhia GPT.
</p>

<p>
When Teolodzhia uses this service, theological search terms and
relevant portions of a user's request may be sent solely in order
to locate relevant indexed sources and passages.
</p>

<p>
The service reads only the permanent Teolodzhia index stored under
the predefined _TEOLODZHIYA_INDEX Google Drive folder. It does not
provide general browsing access to the ow
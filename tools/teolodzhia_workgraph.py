#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
TEOLODZHIYA WORK / MANIFESTATION GRAPH — local sidecar generator

Purpose:
- Read a local TEOLODZHIYA catalog.jsonl or catalog.jsonl.gz.
- Preserve every catalog source record unchanged.
- Build named work-candidate clusters only for repeated display-normalized titles.
- Keep generic scan filenames out of the named-work layer.
- Optionally reconstruct generic "scan N.jpg" files into scan-series bundles
  using local scan.jsonl timestamps.
- Write only local sidecar artifacts. Never modifies Google Drive or the
  authoritative catalog.

This is deliberately separate from index format 2.5.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import gzip
import hashlib
import json
import re
import unicodedata
from pathlib import Path
from typing import Any, Dict, Iterable, List


EXT_RE = re.compile(
    r"(?i)\.(pdf|docx?|pptx?|xlsx?|jpg|jpeg|png|tif|tiff)$"
)
GENERIC_SCAN_RE = re.compile(
    r"(?i)^scan[ _.-]*(\d+)\.jpg$"
)


def read_catalog(path: Path) -> tuple[List[Dict[str, Any]], bytes]:
    raw = path.read_bytes()
    if path.name.lower().endswith(".gz"):
        data = gzip.decompress(raw)
    else:
        data = raw

    rows: List[Dict[str, Any]] = []
    for line_no, line in enumerate(data.decode("utf-8").splitlines(), 1):
        if not line.strip():
            continue
        obj = json.loads(line)
        if not isinstance(obj, dict):
            raise RuntimeError(f"Catalog line {line_no} is not an object")
        rows.append(obj)
    return rows, data


def read_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        obj = json.loads(line)
        if not isinstance(obj, dict):
            raise RuntimeError(f"{path.name} line {line_no} is not an object")
        rows.append(obj)
    return rows


def title_of(row: Dict[str, Any]) -> str:
    return str(row.get("title") or row.get("name") or "").strip()


def stem_title(title: str) -> str:
    return EXT_RE.sub("", title).strip()


def display_key(title: str) -> str:
    value = unicodedata.normalize("NFKC", title).replace("\u00a0", " ")
    value = re.sub(r"\s+", " ", value).strip().casefold()
    return value


def choose_display_title(titles: Iterable[str]) -> str:
    counts = collections.Counter(titles)
    return sorted(
        counts,
        key=lambda value: (
            -counts[value],
            value.isupper(),
            -len(value),
            value.casefold(),
            value,
        ),
    )[0]


def stable_id(prefix: str, value: str) -> str:
    return prefix + hashlib.sha256(value.encode("utf-8")).hexdigest()[:20]


def iso_time(value: str) -> dt.datetime | None:
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def build_named_work_candidates(
    rows: List[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]], set[str]]:
    by_title: Dict[str, List[Dict[str, Any]]] = collections.defaultdict(list)

    for row in rows:
        title = title_of(row)
        if title:
            by_title[display_key(title)].append(row)

    named_works: List[Dict[str, Any]] = []
    manifestations: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []
    generic_source_keys: set[str] = set()

    for key, members in sorted(by_title.items(), key=lambda kv: kv[0]):
        if len(members) < 2:
            continue

        titles = [title_of(row) for row in members]
        display_title = choose_display_title(titles)
        generic_matches = [GENERIC_SCAN_RE.fullmatch(title) for title in titles]

        if all(generic_matches):
            generic_source_keys.update(
                str(row.get("sourceKey") or "") for row in members
            )
            continue

        work_id = stable_id("work_", key)
        literal_titles = sorted(set(titles))
        content_fps = {
            str(row.get("contentFingerprint") or "")
            for row in members
            if row.get("contentFingerprint")
        }
        source_fps = {
            str(row.get("fingerprint") or "")
            for row in members
            if row.get("fingerprint")
        }
        mime_types = sorted(
            {str(row.get("mimeType") or "") for row in members}
        )
        registries = sorted(
            {str(row.get("registryName") or "") for row in members}
        )

        if len(content_fps) == 1:
            semantic_status = "SAME_EXTRACTED_CONTENT"
        else:
            semantic_status = "MULTIPLE_CONTENT_MANIFESTATIONS"

        named_works.append(
            {
                "workId": work_id,
                "displayTitle": display_title,
                "baseTitle": stem_title(display_title),
                "normalizedTitleKey": key,
                "titleRelation": (
                    "EXACT_LITERAL"
                    if len(literal_titles) == 1
                    else "DISPLAY_NORMALIZED_VARIANT"
                ),
                "semanticStatus": semantic_status,
                "manifestationCount": len(members),
                "distinctLiteralTitles": literal_titles,
                "distinctContentFingerprints": len(content_fps),
                "distinctSourceFingerprints": len(source_fps),
                "mimeTypes": mime_types,
                "registries": registries,
            }
        )

        for row in sorted(
            members, key=lambda item: str(item.get("sourceKey") or "")
        ):
            source_key = str(row.get("sourceKey") or "")
            manifestations.append(
                {
                    "manifestationId": source_key,
                    "workId": work_id,
                    "sourceKey": source_key,
                    "originalId": row.get("originalId"),
                    "title": title_of(row),
                    "mimeType": row.get("mimeType"),
                    "sizeBytes": row.get("sizeBytes"),
                    "modifiedTime": row.get("modifiedTime"),
                    "indexedAt": row.get("indexedAt"),
                    "registryName": row.get("registryName"),
                    "originalLocation": row.get("originalLocation"),
                    "contentFingerprint": row.get("contentFingerprint"),
                    "fingerprint": row.get("fingerprint"),
                    "extraction": row.get("extraction"),
                }
            )
            edges.append(
                {
                    "from": work_id,
                    "to": source_key,
                    "relation": "HAS_MANIFESTATION",
                }
            )

    return named_works, manifestations, edges, generic_source_keys


def build_scan_series(
    catalog_rows: List[Dict[str, Any]],
    generic_source_keys: set[str],
    scan_rows: List[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    catalog_by_key = {
        str(row.get("sourceKey") or ""): row for row in catalog_rows
    }
    scan_by_key = {
        str(row.get("sourceKey") or ""): row for row in scan_rows
    }

    items: List[Dict[str, Any]] = []
    for source_key in sorted(generic_source_keys):
        catalog_row = catalog_by_key.get(source_key)
        scan_row = scan_by_key.get(source_key)
        if not catalog_row or not scan_row:
            continue

        match = GENERIC_SCAN_RE.fullmatch(title_of(catalog_row))
        if not match:
            continue

        items.append(
            {
                "sourceKey": source_key,
                "originalId": catalog_row.get("originalId"),
                "pageNumber": int(match.group(1)),
                "title": title_of(catalog_row),
                "modifiedTime": str(scan_row.get("modifiedTime") or ""),
                "createdTime": str(scan_row.get("createdTime") or ""),
                "sizeBytes": catalog_row.get("sizeBytes"),
                "contentFingerprint": catalog_row.get("contentFingerprint"),
                "fingerprint": catalog_row.get("fingerprint"),
            }
        )

    by_modified_date: Dict[str, List[Dict[str, Any]]] = collections.defaultdict(list)
    for item in items:
        by_modified_date[item["modifiedTime"][:10]].append(item)

    raw_series: List[List[Dict[str, Any]]] = []

    for _day, day_items in sorted(by_modified_date.items()):
        page_numbers = [item["pageNumber"] for item in day_items]

        # If every page number is unique for the date, keep it as one series.
        if len(page_numbers) == len(set(page_numbers)):
            raw_series.append(
                sorted(day_items, key=lambda item: (item["pageNumber"], item["sourceKey"]))
            )
            continue

        # Repeated page numbers imply multiple scans on the same date.
        # Separate timestamp batches when there is a substantial creation-time gap.
        ordered = sorted(
            day_items,
            key=lambda item: (
                item["createdTime"],
                item["pageNumber"],
                item["sourceKey"],
            ),
        )

        current: List[Dict[str, Any]] = []
        previous_time: dt.datetime | None = None

        for item in ordered:
            current_time = iso_time(item["createdTime"])
            should_split = (
                bool(current)
                and current_time is not None
                and previous_time is not None
                and (current_time - previous_time).total_seconds() > 30
            )
            if should_split:
                raw_series.append(
                    sorted(
                        current,
                        key=lambda value: (
                            value["pageNumber"],
                            value["sourceKey"],
                        ),
                    )
                )
                current = []

            current.append(item)
            previous_time = current_time

        if current:
            raw_series.append(
                sorted(
                    current,
                    key=lambda value: (
                        value["pageNumber"],
                        value["sourceKey"],
                    ),
                )
            )

    bundles: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []

    for index, series in enumerate(raw_series, 1):
        page_numbers = [item["pageNumber"] for item in series]
        page_start = min(page_numbers)
        page_end = max(page_numbers)
        contiguous = (
            sorted(page_numbers) == list(range(page_start, page_end + 1))
            and len(page_numbers) == len(set(page_numbers))
        )
        seed = "|".join(item["sourceKey"] for item in series)
        series_id = stable_id("scanseries_", seed)

        bundle = {
            "seriesId": series_id,
            "label": (
                f"Untitled scan series {index} "
                f"(scan {page_start}–{page_end})"
            ),
            "kind": "UNTITLED_SCAN_SERIES",
            "pageCount": len(series),
            "pageNumberStart": page_start,
            "pageNumberEnd": page_end,
            "contiguousPageNumbers": contiguous,
            "modifiedDate": series[0]["modifiedTime"][:10],
            "createdTimeStart": min(item["createdTime"] for item in series),
            "createdTimeEnd": max(item["createdTime"] for item in series),
            "confidence": "HIGH" if contiguous else "MEDIUM",
            "pages": series,
        }
        bundles.append(bundle)

        for item in series:
            edges.append(
                {
                    "from": series_id,
                    "to": item["sourceKey"],
                    "relation": "HAS_PAGE",
                    "pageNumber": item["pageNumber"],
                }
            )

    return bundles, edges


def write_jsonl(path: Path, rows: Iterable[Dict[str, Any]]) -> None:
    values = list(rows)
    text = "\n".join(
        json.dumps(row, ensure_ascii=False) for row in values
    )
    if text:
        text += "\n"
    path.write_text(text, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build local TEOLODZHIYA work/manifestation sidecars."
    )
    parser.add_argument(
        "--catalog",
        required=True,
        help="Local catalog.jsonl or catalog.jsonl.gz",
    )
    parser.add_argument(
        "--scan-jsonl",
        default="",
        help="Optional local scan.jsonl for reconstructing generic scan series.",
    )
    parser.add_argument(
        "--output-dir",
        default=".teolodzhia_workgraph",
        help="Local output directory.",
    )
    args = parser.parse_args()

    catalog_path = Path(args.catalog).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    rows, catalog_bytes = read_catalog(catalog_path)
    catalog_sha = hashlib.sha256(catalog_bytes).hexdigest()

    named_works, manifestations, work_edges, generic_source_keys = (
        build_named_work_candidates(rows)
    )

    scan_bundles: List[Dict[str, Any]] = []
    scan_edges: List[Dict[str, Any]] = []
    if args.scan_jsonl:
        scan_path = Path(args.scan_jsonl).resolve()
        scan_bundles, scan_edges = build_scan_series(
            rows,
            generic_source_keys,
            read_jsonl(scan_path),
        )

    clustered_keys = {
        item["sourceKey"] for item in manifestations
    }
    clustered_keys.update(
        page["sourceKey"]
        for bundle in scan_bundles
        for page in bundle["pages"]
    )

    summary = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "mode": "LOCAL_SIDECAR_ONLY",
        "catalogPath": str(catalog_path),
        "catalogRows": len(rows),
        "catalogSha256": catalog_sha,
        "namedWorkCandidates": len(named_works),
        "namedWorkManifestations": len(manifestations),
        "scanSeriesBundles": len(scan_bundles),
        "scanSeriesPages": sum(
            bundle["pageCount"] for bundle in scan_bundles
        ),
        "clusteredSourceRecords": len(clustered_keys),
        "singletonSourceRecords": len(rows) - len(clustered_keys),
        "catalogMutation": False,
        "driveMutation": False,
        "model": (
            "Named repeated-title work candidates plus untitled scan-series "
            "bundles. Every source record remains a separate manifestation/page."
        ),
    }

    (output_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "work_candidates.json").write_text(
        json.dumps(named_works, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_jsonl(output_dir / "manifestations.jsonl", manifestations)
    write_jsonl(output_dir / "work_edges.jsonl", work_edges)
    (output_dir / "scan_series_bundles.json").write_text(
        json.dumps(scan_bundles, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_jsonl(output_dir / "scan_series_edges.jsonl", scan_edges)

    active_source_keys = sorted(
        str(row.get("sourceKey") or "")
        for row in rows
        if row.get("sourceKey")
    )
    active_source_key_fingerprint = hashlib.sha256(
        ("\n".join(active_source_keys) + "\n").encode("utf-8")
    ).hexdigest()

    manifestations_by_work: Dict[str, List[Dict[str, Any]]] = (
        collections.defaultdict(list)
    )
    for item in manifestations:
        manifestations_by_work[item["workId"]].append(item)

    compact_works: List[Dict[str, Any]] = []
    source_to_entity: Dict[str, Dict[str, Any]] = {}

    for work in named_works:
        members = sorted(
            manifestations_by_work.get(work["workId"], []),
            key=lambda item: (
                str(item.get("indexedAt") or "9999"),
                str(item.get("sourceKey") or ""),
            ),
        )
        source_keys = [item["sourceKey"] for item in members]
        default_source_key = source_keys[0] if source_keys else ""

        compact_works.append(
            {
                "workId": work["workId"],
                "title": work["displayTitle"],
                "baseTitle": work["baseTitle"],
                "titleRelation": work["titleRelation"],
                "semanticStatus": work["semanticStatus"],
                "manifestationCount": len(source_keys),
                "defaultSourceKey": default_source_key,
                "manifestationSourceKeys": source_keys,
                "mimeTypes": work["mimeTypes"],
                "registries": work["registries"],
            }
        )

        for source_key in source_keys:
            source_to_entity[source_key] = {
                "kind": "work",
                "id": work["workId"],
            }

    compact_series: List[Dict[str, Any]] = []

    for series in scan_bundles:
        pages = sorted(
            [
                {
                    "pageNumber": page["pageNumber"],
                    "sourceKey": page["sourceKey"],
                }
                for page in series["pages"]
            ],
            key=lambda page: page["pageNumber"],
        )
        default_source_key = pages[0]["sourceKey"] if pages else ""

        compact_series.append(
            {
                "seriesId": series["seriesId"],
                "title": series["label"],
                "kind": "UNTITLED_SCAN_SERIES",
                "pageCount": series["pageCount"],
                "pageNumberStart": series["pageNumberStart"],
                "pageNumberEnd": series["pageNumberEnd"],
                "modifiedDate": series["modifiedDate"],
                "confidence": series["confidence"],
                "defaultSourceKey": default_source_key,
                "pages": pages,
            }
        )

        for page in pages:
            source_to_entity[page["sourceKey"]] = {
                "kind": "scanSeries",
                "id": series["seriesId"],
                "pageNumber": page["pageNumber"],
            }

    workgraph_bundle = {
        "schemaVersion": "1.0",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "catalogRows": len(rows),
        "catalogSha256": catalog_sha,
        "activeSourceKeyFingerprint": active_source_key_fingerprint,
        "namedWorks": compact_works,
        "scanSeries": compact_series,
        "sourceToEntity": source_to_entity,
        "counts": {
            "namedWorks": len(compact_works),
            "namedWorkManifestations": sum(
                item["manifestationCount"] for item in compact_works
            ),
            "scanSeries": len(compact_series),
            "scanSeriesPages": sum(
                item["pageCount"] for item in compact_series
            ),
            "clusteredSources": len(source_to_entity),
        },
    }

    workgraph_bytes = (
        json.dumps(
            workgraph_bundle,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8")

    (output_dir / "workgraph.json").write_bytes(workgraph_bytes)
    (output_dir / "workgraph.json.gz").write_bytes(
        gzip.compress(workgraph_bytes, compresslevel=6)
    )

    summary["activeSourceKeyFingerprint"] = (
        active_source_key_fingerprint
    )
    summary["workgraphGzipBytes"] = (
        output_dir / "workgraph.json.gz"
    ).stat().st_size
    (output_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    for bundle in scan_bundles:
        print(
            "SCAN SERIES:",
            bundle["label"],
            "| pages=",
            bundle["pageCount"],
            "| date=",
            bundle["modifiedDate"],
            "| confidence=",
            bundle["confidence"],
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

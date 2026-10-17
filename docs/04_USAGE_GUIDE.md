# 04. Usage guide

## Normal use

Ask theological questions normally. When a question can be checked in the indexed Orthodox library, the GPT should consult the Action before answering.

Examples:

- „Как св. Максим Изповедник разбира любовта?“
- „Намери пасажи за литургията.“
- „Какво казват източниците за обожението?“

## Work-level search

Use when you want one logical entry per work.

Expected operation: searchLibraryWorks.

## Source-level search

Use when you need separate files or editions.

Expected operation: searchLibrary.

## Read a source

After search returns sourceKey, use readLibrarySource with that sourceKey and a focused query.

## Full catalog

- logical works/titles -> listLibraryWorks
- exact active files/source records -> listLibrarySources

Both must paginate to hasMore=false.

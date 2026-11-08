# Export contract

`asset-studio export <job> --out <folder> [--drafts]` writes a folder the consumer packages from. It needs nothing from the work folder.

## Folder

- `export-index.json`
- One file per exported asset, named `<sha256>.<ext>`. The hash is the SHA-256 of the file's bytes; the extension is the real format (`webp` for pictures, mood stills and glow masks; `m4a` for lines; a given sound keeps the format it was given, so it can be a `wav`).
- Nothing else: no masters, no voice WAVs, no `captions/`, no `index.json`, no `notes.json`, no settings.

Only `final` assets are exported. `--drafts` adds `draft` ones. `rejected` and `missing` assets never ship. An empty set gives an index with `"assets": {}` and no media.

## `export-index.json`

```json
{
  "schema": 1,
  "story": "dracula",
  "source": "sha256:<64 hex>",
  "assets": {
    "n1-house.02~vo-01": {
      "kind": "line",
      "file": "<hash>.m4a",
      "size": { "seconds": 3.2 },
      "status": "final",
      "speaker": "count",
      "text": "Come in, late."
    },
    "painting.n1-house": {
      "kind": "painting",
      "file": "<hash>.webp",
      "size": { "width": 1920, "height": 1080 },
      "status": "final"
    }
  }
}
```

- `source` is the job's `source` hash, copied unchanged.
- `size` is `{width, height}` in pixels for a picture, or `{seconds}` for audio.
- `status` is `final`, or `draft` when `--drafts` was used. Keep it: the consumer decides what a draft may do.
- `speaker` and `text` appear only on a `line`, taken from the job. `speaker` is the cast id.
- Every `file` is a bare name beside the index. Resolve it as `<export folder>/<file>`.

## Keys

The key is the asset ID, with one rule: a picture with two or more profiles has one entry per profile, keyed `<id>~<profile>` (`foe.shade~board`, `foe.shade~ipad`); there is no bare entry. A picture with one profile keeps its bare ID. Mood stills are `portrait.<speaker>~<mood>`, the neutral still `portrait.<speaker>`, and a glow mask is `glow.<entry>`.

## Failure

The folder is built next to `--out` and swapped in only when complete. If anything fails (a store file missing or not matching its hash, a copy error), the previous export is left as it was and the command exits 1 with `AS-EXPORT-2` or `AS-EXPORT-4` (`AS-EXPORT-5`: the old export could not be restored, and the message names the `.export-old` folder; `AS-EXPORT-6`: the new export is in place but the old one could not be deleted, and the message names the leftover folder). `AS-EXPORT-3` refuses an `--out` that is inside the story's work folder, contains the job or work folder, or is a non-empty folder that is not an earlier export (it is left alone).

## Replacing and silent captions

`--out` is replaced whole: an earlier export in it (an `export-index.json` that parses with `schema: 1`) is swapped out for the new folder, and anything else in it goes too. A non-empty folder that is not an earlier export is refused. Paths are compared after resolving symlinks.

Silent captions (repeated or substituted lines, C-04) are not in `lines[]`, so they never reach the export; the consumer takes them from its own script.

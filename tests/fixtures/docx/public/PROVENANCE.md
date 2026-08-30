# Public DOCX fixture provenance

Task12 commits only byte-pinned public interoperability fixtures. `manifest.json` is the machine-readable authority for download URLs, SHA-256 values, licenses, source statements, and observed package evidence. The fetch script refuses a download before replacing a local fixture when its hash differs.

| ID | Claimed producer | Public source statement | Package evidence | License/status |
| --- | --- | --- | --- | --- |
| `word-desktop-comments` | Microsoft Word Desktop | Mammoth publishes the file as comments test data. | `docProps/app.xml` records `Microsoft Office Word` 14.0000. | Mammoth MIT fixture. |
| `word-desktop-footnotes` | Microsoft Word Desktop | Mammoth publishes the file as footnotes test data. | `docProps/app.xml` records `Microsoft Office Word` 14.0000. | Mammoth MIT fixture. |
| `google-docs-export` | Google Docs | The PDF Association says it created the document in Google Docs and exported it to DOCX. | No `docProps` producer metadata is present; the producer claim therefore relies on the explicit source statement, not an inferred package field. | Public interoperability document; the source author retains copyright. |
| `libreoffice` | LibreOffice | mat2 publishes the file as metadata-cleaning test data. | `docProps/app.xml` records LibreOffice 5.4.5.1 on Linux x86-64. | mat2 LGPL-3.0-or-later fixture. |
| `word-online` | Microsoft Word Online | No fixture met both provenance and redistribution requirements. | None accepted. | Intentionally absent; explicit compatibility/deployment gap. |

The Google Docs manifest uses a direct `drive.usercontent.google.com` byte URL for the same public file ID because it yields the exact pinned bytes without relying on an interactive editor redirect. Its canonical source URL and the independent PDF Association provenance page remain recorded separately.

Word Online is not inferred from a filename, a generic `Microsoft Office Word` application field, or a file merely opened in Word for the web. Add `word-online.docx` only with an explicit public creation/export statement, redistribution permission, a pinned hash, and internal package evidence.

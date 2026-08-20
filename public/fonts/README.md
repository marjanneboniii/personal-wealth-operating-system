# Bundled fonts

`Vazirmatn-{Regular,Medium,SemiBold,Bold,Black}.woff2` — Vazirmatn v33.003 by
Saber Rastikerdar, SIL Open Font License 1.1
(<https://github.com/rastikerdar/vazirmatn>, files identical to the official
npm package `vazirmatn@33.0.3` → `fonts/webfonts/`).

SECURITY (L-02): fonts are self-hosted so the app performs **no third-party
CDN request at runtime** — previously they were loaded from
`cdn.jsdelivr.net`, which leaks visitor metadata and is a supply-chain and
availability dependency. Do not reintroduce remote font URLs; keep
`font-src 'self'` in the CSP effective.

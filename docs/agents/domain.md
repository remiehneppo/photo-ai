# Domain Docs

How engineering skills should consume this repo's domain documentation when exploring codebase.

## Before exploring, read these

- **`CONTEXT.md`** at repo root, or
- **`CONTEXT-MAP.md`** at repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to topic.
- **`docs/adr/`** — read ADRs that touch area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. Producer skill (`/grill-with-docs`) creates them lazily when terms or decisions get resolved.

## File structure

Single-context repo:

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-*.md
│   └── ...
├── backend/
└── frontend/
```

## Use the glossary's vocabulary

When your output names a domain concept (in issue title, refactor proposal, hypothesis, test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If a concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 — but worth reopening because…_

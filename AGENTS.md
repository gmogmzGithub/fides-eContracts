# Shared project context

Before planning, editing, reviewing, or deploying this repository, read
`PROJECT_MEMORY.md`, then read the relevant terms in `CONTEXT.md` and accepted
decisions under `docs/adr/`.

This repository contains Fides, a managed multi-industry contract
platform. Do not introduce dependencies on another product or an
industry-specific operating model unless a new accepted decision requires it.

Treat `PROJECT_MEMORY.md` as orientation, not as a substitute for current
branch evidence. Accepted ADRs and verified implementation on the current
branch win if a summary has drifted. Preserve unrelated worktree changes and
never commit real credentials, contracts, identity documents, or sensitive
evidence.

Keep repository documentation canonical and small. Update `CONTEXT.md`, an
existing ADR, `docs/architecture/SYSTEM-ARCHITECTURE.md`, or
`docs/requirements/REAL-PILOT-GATES.md` before creating another document.
Do not commit temporary grilling notes, design-session transcripts,
point-in-time audits, copy-ready messages, legal drafts, sector research or
duplicate intake forms under `docs/`.

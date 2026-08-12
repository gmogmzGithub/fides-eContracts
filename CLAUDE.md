# Fides

## Product Boundary

Fides is a managed, multi-industry contract platform. The application starts
after approved legal content and programmed fields are already configured for an
organization. Do not model prospecting, negotiation, legal drafting, or approval
workflow inside the product unless an accepted ADR changes that boundary.

Canonical language is in `CONTEXT.md`. Accepted decisions are in `docs/adr/`.
The target architecture is in `docs/architecture/SYSTEM-ARCHITECTURE.md`, and
real-data gates are in `docs/requirements/REAL-PILOT-GATES.md`.

## Core Rules

- Every record and object belongs to an organization.
- Organization roles are Administrator, Emitter, and Reviewer; they may
  accumulate.
- Organizations do not edit templates, privacy notices, clauses, or versions.
- Templates are versioned Markdown stored in the platform.
- An issued contract is one immutable snapshot and has no version sequence.
- New contracts always use the current template publication.
- The digital text is primary; create PDF only on explicit `View PDF` demand.
- The Emitter chooses every enabled evidence and review option, with useful
  defaults.
- The signer uses an opaque link without an account, email, phone, or OTP.
- The signer must scroll the complete contract before continuing; never call
  that proof of reading or understanding.
- Evidence may include document capture and guided video when configured.
- Review may be none, manual, or AI-assisted. AI recommends; a Reviewer decides.
- Review can accept, repeat the whole attempt, or use documented `SKIP`.
- Repetition creates a new attempt and link on the same immutable contract.
- Expiry requires a new contract created from the current template publication.
- There is no `Rejected` state.
- Archiving and deletion are operational classifications, not contract states.
- Cold custody exists for every organization; active custody changes access and
  recovery service, not whether records are retained.

## Safety And Evidence

- Never describe the platform as automatically valid, legally immutable,
  non-repudiable, NOM-151 compliant, or equivalent to an advanced signature.
- The application stores and presents content; it does not decide legal
  sufficiency.
- Keep acceptance, payment, service delivery, and fulfillment separate.
- Never commit passwords, real contracts, identity documents, videos, personal
  evidence, provider secrets, or customer data.

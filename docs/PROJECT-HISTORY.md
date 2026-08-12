# Project History

Fides began as a focused contract and evidence workflow and was later generalized
into a managed, multi-industry contract platform.

The current architecture keeps the useful parts of the earlier work: simple
organization-controlled issuance, opaque signer links, acceptance evidence,
review decisions, PDF generation on demand, and custody packages. The platform
model avoids turning the product into a free-form legal-document editor. Instead,
an organization operates only the templates, variables, and evidence profiles
that have already been configured for it.

The local POC-demo was built to prove the product path with synthetic data before
any real pilot:

- Multi-organization fixture catalog.
- Role-specific organization access.
- Versioned contract templates and privacy notices.
- Issued-contract snapshots.
- Signer acceptance flow.
- Evidence capture.
- Manual and AI-assisted review.
- Queue-backed async work with retries, DLQ, and redrive.
- Contract packages, custody behavior, search, folders, archive, and delete
  classifications.

This public project history is distilled from the working repository and private
development notes. Raw private notes are intentionally not published.

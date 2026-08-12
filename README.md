# Fides eContracts

Fides eContracts is a local proof of concept for a managed, multi-industry
contract platform. It focuses on the operational backend of issuing approved
contract templates, collecting signer acceptance and evidence, routing human or
AI-assisted review, preserving immutable contract packages, and proving the flow
with synthetic end-to-end data.

This repository is public as an engineering portfolio project. It does not
contain real contracts, identity documents, customer data, provider secrets, or
legal advice.

## What It Demonstrates

- Multi-organization contract operations with isolated data and role-based
  access.
- Versioned contract templates stored as Markdown and rendered into immutable
  issued contracts.
- Signer flow through opaque, temporary links without a signer account.
- Configurable evidence profiles, including guided video and document capture
  in the local synthetic environment.
- Manual review, AI-assisted recommendation, documented skip, and repeat-attempt
  workflows.
- Contract search, folders, archive/delete classifications, active custody, cold
  custody, package generation, and export jobs.
- A local asynchronous worker model with PostgreSQL as the source of truth,
  queue dispatch, retries, DLQ, and explicit redrive.
- CI-oriented verification with linting, type checks, coverage thresholds, build,
  smoke tests, and Docker Compose E2E checks.

## Stack

- Next.js App Router, React, TypeScript, and server actions.
- PostgreSQL for identity, authorization, contracts, events, retention metadata,
  hashes, and outbox state.
- Docker Compose for the local stack: app, worker, PostgreSQL, ElasticMQ,
  message sink, and a controlled AI-provider double.
- Vitest, ESLint, Oxlint, TypeScript, and GitHub Actions.

## Architecture Shape

Fides is deliberately not a free-form document editor. A platform operator
configures approved contract templates and fields before an organization uses
the system. Organization users issue contracts only through enabled templates and
approved variables. Each issued contract is an immutable snapshot, while PDF and
ZIP artifacts are generated from the canonical stored data.

The signer experience is intentionally narrow: open an opaque link, review the
contract, provide the required evidence, and accept. The application records and
presents evidence; it does not claim automatic legal sufficiency, advanced
signature status, identity verification, NOM-151 compliance, or non-repudiation.

## Run Locally

Requirements: Docker with Compose v2. Node 22 is useful for tests and local
development.

```bash
docker compose up -d --build
docker compose logs seed
```

The seed process prints the synthetic demo accounts and local-only values needed
to explore the product. They are intentionally synthetic and must not be reused
outside this local environment.

Useful commands:

| Command | Purpose |
|---|---|
| `npm run local:up` | Build and start the local Docker stack |
| `npm run local:reset` | Delete local demo volumes, rebuild, and reseed |
| `npm run verify:logins` | Verify all seeded demo accounts and access scopes |
| `npm run smoke` | Exercise the main contract lifecycle end to end |
| `npm run smoke:queue` | Verify dispatch, retries, DLQ, and redrive |
| `npm run verify` | Lint, typecheck, coverage, and production build |

## Documentation

- [Domain language](./CONTEXT.md)
- [Architecture](./docs/architecture/SYSTEM-ARCHITECTURE.md)
- [Accepted decisions](./docs/adr)
- [Real-pilot gates](./docs/requirements/REAL-PILOT-GATES.md)
- [Project history](./docs/PROJECT-HISTORY.md)
- [Branching and public-repo policy](./docs/BRANCHING.md)

## Public Repository Policy

This public branch is designed for code review by recruiters and hiring
managers. Operational runbooks, private Codex notes, temporary planning files,
real credentials, real evidence, and customer-specific material stay out of Git.

Branch protection controls how changes are merged. It does not hide content. In
a public GitHub repository, every pushed branch and tag should be treated as
public.

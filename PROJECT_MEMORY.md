# Fides Public Project Memory

This file keeps stable orientation for contributors and coding agents. It is a
public-safe summary, not a private runbook. Current code, `CONTEXT.md`, accepted
ADRs, and architecture documents remain the source of truth when they differ.

## Product

Fides is a managed, multi-industry digital contract platform.

- The product begins after a platform operator has configured the organization's
  access, contract templates, fields, privacy notices, consent text, and review
  options.
- Organizations issue contracts through enabled templates; they do not freely
  edit legal clauses, privacy notices, or published template versions.
- Contract templates are versioned Markdown plus programmed fields.
- Each issued contract is an immutable snapshot of the exact template version,
  field values, parties, and configuration used at issue time.
- The digital contract is canonical; PDF is generated only on demand.
- The signer uses an opaque temporary link and does not need an account.
- Evidence options are configured per contract profile.
- AI-assisted review is advisory. A human reviewer decides whether to accept,
  repeat, or document a skip.
- There is no signer rejection state. Cancellation belongs to the organization;
  expiry requires a new contract.
- Archive and delete are operational classifications, not contract states.
- Cold custody is part of the base model. Active custody changes access,
  export, and recovery behavior.

## Current Stage

The repository contains a local Docker POC-demo with synthetic data only.

The local stack includes the web app, worker, PostgreSQL, private object storage,
an SQS-compatible local queue with DLQ, local email/WhatsApp capture, and a
controlled AI-provider double. The smoke suites exercise the product end to end
without contacting external providers.

No real contracts, counterparties, identity documents, videos, personal
evidence, provider credentials, or customer messages are authorized in this
repository.

## Engineering Discipline

- Keep the product direct and operationally small.
- Prefer accepted domain decisions over accidental behavior in old code.
- Do not introduce a separate order, signer rejection, free legal editor, or
  organization-side template approval flow without a new accepted decision.
- Store only synthetic demo data in Git.
- Keep private notes and operational runbooks outside tracked files.
- Use `docs/BRANCHING.md` before publishing branches to the public GitHub repo.

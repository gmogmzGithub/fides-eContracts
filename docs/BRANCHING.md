# Branching And Public Repository Policy

This repository is intended to be public. Treat every pushed branch and tag as
visible to recruiters, hiring managers, and anyone else on GitHub.

Branch protection controls change flow; it does not hide content.

## Branches

| Branch | Purpose | Public content rule |
|---|---|---|
| `main` | Default public branch and portfolio-ready code | Must always be safe to show publicly |
| `develop` | Integration branch for completed work before release | Must also be public-safe |
| `codex/*` | Short-lived implementation branches | Public-safe only; delete after merge |

Do not push private branches, raw Codex memories, operational runbooks, real
credentials, customer-specific notes, or temporary planning documents to this
public repository. Keep those in `.private/` locally or in a separate private
repository.

## Recommended GitHub Protection

Protect `main`:

- Require pull request before merging.
- Require at least one approval.
- Require status checks to pass.
- Require branches to be up to date before merging.
- Require conversation resolution before merging.
- Restrict force pushes.
- Restrict deletions.

Protect `develop`:

- Require status checks to pass.
- Require pull request before merging when work is not trivial.
- Restrict force pushes.
- Restrict deletions.

Use `codex/<short-task-name>` for implementation branches. Merge through Pull
Requests into `develop`, then promote `develop` into `main` when the public story
and verification are clean.

## Local-Only Notes

The ignored `.private/` directory may contain:

- imported private README/runbook material;
- private project memory;
- local demo notes;
- credentials for purely local experiments;
- temporary planning notes.

Nothing in `.private/` is committed or pushed.

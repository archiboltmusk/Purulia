# Governance

Parishkar Purulia is a public civic service, so it must keep running if any one person steps away. This page says who decides things and how the project survives a change of hands.

## Roles

- **Contributors**: anyone who opens an issue or pull request.
- **Maintainers**: review and merge pull requests, apply database migrations to the live Supabase project, and moderate this repository. Listed in [CONTRIBUTING.md](CONTRIBUTING.md#maintainers).
- **Moderators**: handle reports on `admin.html`. They don't need repository access. See the moderator section of [RUNBOOK.md](RUNBOOK.md).

## Decisions

- Day-to-day changes: one maintainer approves and merges.
- Changes to the resolution rules (how a report becomes "fixed"), the public record in `record/`, data licensing, or privacy: open an issue first and leave it open at least 7 days for comment before merging.
- Maintainers aim for consensus. If they can't agree, the longest-serving active maintainer decides and writes the reason in the issue.

## Becoming a maintainer

After several merged contributions, any contributor can ask in an issue. An existing maintainer adds them. New maintainers get GitHub write access first; Supabase access follows once they have shipped a database change with review.

## Keeping the project alive

The project must always have **at least two people** who hold each of these:

| Access | Where |
|---|---|
| GitHub admin on this repository | Settings → Collaborators |
| Supabase project owner/admin | Supabase → Organization → Members |
| Supabase Edge Function secrets | Supabase → Edge Functions → Secrets (list in RUNBOOK.md) |
| Cloudflare account (Workers deploy), if used | Cloudflare → Members |
| Grievance/security mailbox (`GRIEVANCE_EMAIL` in `config.js`) | Mail provider |
| Domain registrar, if a custom domain is added | Registrar account |

If a maintainer is inactive for 6 months, another maintainer may remove their access after trying to reach them. If every maintainer is gone, anyone may fork and continue under the MIT licence. [DEPLOY.md](DEPLOY.md) explains how to stand the service up from scratch, and `record/` lets anyone verify that published data wasn't altered.

## Changes to this document

Same as rule changes above: an issue, 7 days, then merge.

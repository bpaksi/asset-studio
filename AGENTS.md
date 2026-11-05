# AGENTS.md

## Agentic SDLC

- Every change is a PR from a git worktree, never the main checkout.
- Review matrix:
  - Product-behavior code → Review A and Review B, on different models.
  - Test-only and docs-only PRs → merge on green, no review.
  - Art → one Low review.
  - Design and story PRs → no review.
- At most 3 review rounds, then apply the `needs-bob` label.
- No force-push, no `--no-verify`, no amending pushed commits, no deploy without Bob's OK.
- Secrets via env only, never committed. CI runs gitleaks on every PR.
- Wright squash-merges on green.

# PR10E.10 — Production Build & TypeScript Blocker Fixes

Paul approved this scope after PR #155 was human-merged at
`8d2bd4d4ebbfc2642f3f9ffd3bddf3240fdbbcb8`.

## Acceptance scope

- Reproduce the three lint errors and nine TypeScript diagnostics recorded by
  PR10E.9 and correct their underlying causes in the seven affected components.
- Preserve existing API failure handling, explicit user actions, estimate
  disclosure, confirmation prompts and canonical application navigation.
- Keep strict compiler, lint and build settings; do not suppress diagnostics,
  broaden shared contracts or add dependencies to bypass the failures.
- Pass `tsc --noEmit --incremental false`, scoped ESLint, the strict
  `npm run build:next`, targeted regressions and `npm run test:core`.
- Run the production build and complete TypeScript check in CI for changes to
  build inputs. Browser acceptance remains a separate development-mode gate.
- Keep the complete diff below 1,500 changed lines, including verification.

## Review and release boundary

Frontend owns the component fixes and directly related behavioral coverage.
Lead owns this scope record, build CI and PR coordination. Security is a
separate review from the start; independent QA verifies the frozen candidate,
then a read-only Reviewer assesses the complete diff and evidence.

Record actual commands, results, source-tree identity and environment limits
in the PR body. Local verification reuses the installed dependency versions;
the native CI production build uses a clean lockfile installation.

This slice does not authorize deployment, production-data changes, provider
actions, new business features or changes to tenant/permission/approval controls.
Agents leave the PR draft and unmerged for Paul's human review and merge.

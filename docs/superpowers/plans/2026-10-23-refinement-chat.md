# Inline refinement chat implementation plan

Goal: Refine the current quote draft through a collapsible conversation, explicit Apply/Dismiss and Undo.

Architecture: Each generation remains an owned, resumable job. Refinements reference a completed job and reuse its Pi Durable database under the same lock; each submission carries the current editor text and user's request. The inline panel owns presentation and revision safeguards; Composer retains polling/cancellation.

Constraints: Never post automatically, never silently replace manual edits, keep existing tools and credential boundary, preserve existing uncommitted fixes.

- [x] Test durable follow-up context across reopen and idempotent replay.
- [x] Validate refinement ownership, source, limits and completed predecessor; share session storage and retain it until all associated jobs expire.
- [x] Add collapsible chat, proposal Apply/Dismiss, current-text capture, guarded Undo, busy/cancel/error/retry states.
- [x] Test current manual edits, stale proposal, Undo, cancellation, repeated refinements and packaged integration.
- [x] Document, verify types/tests/release browser checks, review, rebuild install package.

Validation: 48 tests, typecheck/build, release ZIP browser integration (including refinement tools/history, Apply/Dismiss/Undo, mobile dark layout) and independent review passed. Installed package files updated; browser reload left for user because computer use was interrupted.

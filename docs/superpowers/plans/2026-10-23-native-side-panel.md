# Native assistant side panel

Goal: Remove inline chat and editor focus contention. Use Chrome's native side panel for prompt controls, conversation and revision review. Keep only Open assistant in X's quote dialog.

- [x] Test content controller: no injected text inputs; requests capture current editor; explicit apply/undo with conflict checks; stale composer/closed dialog rejected.
- [x] Implement native side panel opening synchronously from content user gesture; trusted extension-only state/command bridge to active X tab. No provider credentials exposed.
- [x] Build restrained responsive panel with source summary, scrollable conversation, revision cards, fixed chat composer, apply/dismiss, undo, progress/cancel and recovery states.
- [x] Test native panel focus isolation using an X-style focus trap, cross-tab lifecycle and full packaged UI flow.
- [x] Update docs, run full verification/review and refresh local package.

Initial and subsequent generations are proposals; only explicit Apply writes to X. Posting stays in X. Pi Durable conversation/session pipeline remains unchanged.

Verification: 48 unit tests, typecheck/build/format and packaged browser checks passed. Native side-panel extension bundle verified with focus-trap isolation, preserved typing across polls, prompt blur, explicit apply/conflict/undo, source/dialog lifecycle, and multi-window regression coverage. Independent review resolved two findings and approved targeted recheck. The UI browser test exercises the panel page; native Chrome reload was attempted but browser control was interrupted. Updated ZIP copied to installed folder; user must reload extension and refresh X.

# Original tweet workspace

Design: A persistent New tweet entry in the side panel and a primary empty-state action create a separate X composer tab. The panel switches to Original tweet mode, invites an idea/audience/tone, then presents drafts and conversational refinements. Apply is always explicit; X remains responsible for posting. Existing quote mode stays intact.

- [x] Add original-mode job/input types and validated brief admission; preserve mode and brief through durable followups.
- [x] Add authorized new-composer tab handoff, attach only to extension-created plain composers, open the panel from the extension action.
- [x] Add first-message/blank-start behavior, original writing preset, ongoing unapplied proposal refinement, Apply/Undo protection.
- [x] Add panel entry points, mode labels, starter suggestions and empty/error states.
- [x] Verify controller/agent/security tests, packaged quote+original browser flow, review and documentation/package update.

Verified: 55 tests, typecheck/build/format, packaged browser flow for quotes and original posts, Apply/Undo, initial brief with existing editor text, unapplied revision continuity, and source-free agent input. Independent review findings fixed. ZIP copied to local installation; reload extension and refresh X to activate.

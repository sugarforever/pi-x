# Conversational Drawing Tool Implementation Plan

**Goal:** Bring Smart’s conversational geometry capability into pi-x page chat using existing model/provider and research infrastructure.

**Reference:** Codex chat “Brainstorm MVP” (01a1690c-2f32-7c53-a31b-a0d0cc90aa4c), and the local Smart geometry kernel, arithmetic parser, and scene schema.

**Architecture:** Reuse the pure TypeScript geometry kernel and bounded arithmetic parser. Register chat-only `get_diagram`, `draw_diagram`, and `calculate` tools in the existing durable harness. Persist versioned diagrams separately from page snapshots to avoid overwriting either during model work. Render validated structured geometry with native SVG, including rotatable 3D wireframes; never execute model-generated code or HTML.

**Scope:** Planar geometry, common solids, derived constructions, declared numerical constraints, conversational edits, version selection/undo, draggable labels, zoom/reset, expanded preview, SVG/PNG export. General reasoning and research remain with the selected model and existing search tools. Diagrams share the page conversation’s local retention/deletion lifecycle.

**Boundaries:** This is numerical validation of declared relationships, not a symbolic proof or a general constraint solver. Underspecified figures must disclose assumptions. Drawing alone does not authorize revealing solution hints. Keep native pi-x UI and build tooling.

## Tasks

- [x] Add failing geometry/calculation tests, then port Smart’s pure kernel/schema/parser with attribution.
- [x] Test and implement bounded versioned diagram persistence, idempotent durable commits, undo/history, and safe label offsets.
- [x] Test chat-only tool rounds, invalid edit recovery, and current-diagram context after manual history changes; connect lifecycle cleanup and trusted panel commands.
- [x] Test and implement SVG plane/solid renderer, prominent panel preview, expanded view, label manipulation, zoom/rotation, and exports.
- [x] Run full unit/build/format and browser checks for drawing, auxiliary construction, undo/reload, expansion, solid rotation, export, and existing X/page chat. Review and document results.

Execution: implement in this session using the writing-plans, test-driven-development, and verification workflows.

Verification: `npm run check` passed with 179 tests; `npm run format:check` and `npm run test:browser:release` passed. Browser coverage includes numerical drawing, conversational median construction, undo/version restore, label movement, expanded/full-browser-width previews, solid rotation, SVG/PNG downloads, reload persistence, deletion, and existing page-chat/X flows. Independent review findings for durable operation receipts and interrupted label drags were reproduced and fixed; visual review also improved layout and scroll anchoring.

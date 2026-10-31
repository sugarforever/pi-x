# General Artifact Workspace Implementation Plan

**Goal:** Let a page conversation create, preview and iteratively revise multiple typed artifacts using a common workspace.

**Architecture:** A conversation owns a collection of stable artifact IDs. Each artifact owns typed, validated revision data and a selected version. One persistence engine handles creation, optimistic updates, selection, version restoration, operation receipts, migration, and cleanup. A renderer registry supplies geometry, Markdown documents, and code views. Existing drawing tools adapt to this engine.

**Interaction:** Successful tool operations produce artifact cards in the corresponding chat round. Clicking a card opens its artifact/version. The workspace offers an artifact selector, preview/source views, version history, restore/undo, export, a larger modal, and a browser-width tab. The next model request receives current selections and reads full content through tools before editing.

**Initial types:** diagram (validated SceneSpec), document (Markdown rendered without raw HTML), code (inert code and language metadata). Executable HTML/apps and external embeds remain outside this release. Additional kinds register validation, serialization/export, and rendering without changing conversation/job lifecycle.

**Invariants:** Writes to existing artifacts name a base version. Reject stale updates and invalid data without mutation. Preserve durable operation receipts, including no-ops and deleted artifacts. Bound artifacts, revisions, content, and collection size. Migrate legacy diagrams without losing versions or labels. Conversation deletion/expiry clears every artifact type. X writing remains unchanged.

## Tasks

- [x] Test and build typed registry, shared mutation engine, migration and storage; adapt legacy DiagramStore.
- [x] Test and add list/read/create/update artifact tools, current-state context, trusted selection/version commands and cleanup.
- [x] Test and build shared workspace with diagram/document/code renderers, source view, revisions, exports, expansion and chat cards.
- [x] Verify real browser iteration across two artifact types, switching/restoring, full-width preview, reload and deletion, alongside existing drawing/X workflows. Review and update documentation.

Execution: native in this chat using the existing planning, test-first, review and verification workflows.

## Verification

- `npm run check`: type checking, 187 tests across 32 files, and extension build pass.
- `npm run format:check`: pass.
- `npm run test:browser:release`: pass against the packaged extension (51 fixture API requests). Covers document creation/revision/restoration/source, inert code preview, artifact switching, drawing modal/full-tab/exports, persistence, deletion, and existing X workflows.
- Inspected document, code and drawing preview screenshots.
- Independent review identified round-card selection and concurrent drawing base-version issues; both corrected. Regression checks cover final round cards and stale drawing rejection after a generic update.

# Chat-first artifact preview

Implemented compact artifact chips in the conversation panel, a separate resizable artifact-only window, and optional inline docking. Existing preview storage, commands and polling synchronize version selection, revisions and labels. Opening the separate preview hides the docked workspace and focuses an existing window when available. Closing a preview permits reopening; deleting the conversation closes its detached preview on the next successful poll.

Page context displays a single Attached title line by default. Metadata, captured content, screenshot consent and context actions stay inside its expandable details. The compact send/stop icon and growing message input remain.

Verification: 189 tests across 32 files, type checking, build and formatting pass. Packaged browser checks pass (51 fixture requests), including chat space measurement, detached preview, live drawing revision, context removal/refresh, window reuse/close, docking, reload, artifact iteration and deletion. Existing X workflows also pass. Inspected chat-first and detached preview screenshots. Independent review identified context-tab identity closing the detached view; conversation-only identity and a regression test address it.

## Always-on-top follow-up

Default preview now uses Chrome Document Picture-in-Picture. Styles copy synchronously from the loaded extension stylesheet; controls use the preview document for focus, clipboard and removal confirmation. Native popup remains a compatibility fallback. Pinned preview closes with its source panel or conversation change. Verified Chrome reports `alwaysOnTop: true` before and after focusing chat. Browser checks cover live revisions, label dragging and persistence, Copy, Remove, window reuse/reopening and conversation deletion. All 193 tests across 33 files, type/build/format checks and packaged browser suite pass (51 fixture API requests).

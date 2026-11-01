# Inline drawings implementation plan

**Goal:** Display drawing artifacts as static, version-specific previews in assistant messages, with optional existing preview windows.

**Architecture:** Resolve each job's last receipt per artifact; draw its retained SceneSpec through the existing SVG renderer without editing affordances. Keep document/code cards and all existing preview/export controls. Open drawing versions through a validated, serialized background preview request; retain one preview host per chat/mode.

**Constraints:** No release or main push. Preserve unrelated local files. Use isolated browser fixtures only.

- [x] Add failing sidepanel tests for multiple drawings, multiple revisions, older turns, loading/error and missing versions.
- [x] Add a static drawing renderer and integrate receipt-based inline figures with responsive CSS and accessible open action.
- [x] Validate and select the requested version atomically when opening its existing preview host; test correct selection and rejection.
- [x] Load historical drawing data on demand and guard against stale history responses.
- [x] Extend isolated browser tests for inline display, history/reload, correct preview and responsive layout; retain PiP/export coverage.
- [x] Run full checks and isolated browser suite, review diff, document behavior, push feature branch and open/attach PR.

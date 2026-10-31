# pi-x product scope

Status: initial page-chat implementation, including standalone conversations and the existing X writing adapter. Multiple attached pages remain outside the initial release.

## Product definition

pi-x is a browser companion for understanding, discussing, and working with the page you are viewing. Open the side panel on a page, inspect the context it has captured, and chat about it. Writing on X is one capability within this experience.

The primary object is a conversation with page context. A draft is an optional output of that conversation, and an X composer is an optional destination.

## Core experience

1. Open pi-x from the extension toolbar on any supported page. Do not open X or require an editor.
2. Capture the page's readable content and available metadata. Show the attached page and a context preview before the first message.
3. Ask questions, discuss an argument, request an explanation, solve a problem, or develop an idea through follow-up messages.
4. Inspect and refresh the attached context as needed. A new capture must not silently replace the context used by earlier messages.
5. Copy a useful response, continue the conversation later, or explicitly start an X writing workflow.

Opening the panel does not call the model. Sending a message submits the attached context and conversation to the selected provider.

## Page context

Capture a structured snapshot rather than treating the page as an unlabelled block of text:

| Context | Required behavior |
| --- | --- |
| Identity | Page URL, canonical URL when available, title, and site name. |
| Metadata | Available author, publication/update dates, description, and language. Missing fields remain absent; do not invent them. |
| Content | Readable main content with headings, lists, tables, code, and mathematical notation preserved where extraction permits. |
| User focus | Selected text when present, clearly distinguished from the broader page. |
| Provenance | Capture time, source tab, and extraction limitations, including truncation or inaccessible content. |
| Visual context | Explicit screenshot/image attachment for diagrams, image-only questions, and content that text extraction cannot represent. |

Show what is attached and allow the user to remove context or refresh it. Bound content size and identify omitted sections. Prefer the main content over navigation and repeated page chrome. Treat page text and metadata as source material, never as instructions that override the user's request.

The goal is broad website support, including pages the user can read while signed in. Browser-protected pages, unavailable frames, inaccessible PDFs, and image-only content need a clear unsupported or partial-context state. Never present a partial capture as the whole page. Existing restrictions on agent-driven URL reading remain separate from attaching the current page; any change to them requires deliberate implementation.

## Features and priority

| Priority | Feature | Scope |
| --- | --- | --- |
| P0 | Chat on the current page | General conversation in the side panel without an X composer or writing preset. |
| P0 | Inspectable page context | Content, metadata, selected text, capture state, remove, and refresh controls. |
| P0 | Follow-up discussion | Retain the question, assistant responses, and associated context across turns. |
| P0 | Independent conversations | A stable conversation ID, local history, and recovery independent of a live editor. |
| P0 | Existing X writing | Preserve original posts, quotes, replies, revision proposals, Insert, and Undo as explicit writing actions. |
| P1 | Visual questions | Attach a screenshot or image and discuss diagrams with a vision-capable model. |
| P1 | Supporting research | Explicitly distinguish the attached page from additional sources retrieved by existing research tools. |
| Later | Multiple attached pages | Explicitly add and remove sources in one conversation, with per-source attribution. |

Model profiles, provider connections, saved prompts, durable execution, and tool history remain shared infrastructure. General page chat must not inherit tweet-only response formatting, automatic translation, a target draft language, or a requirement to return only a draft. Writing-specific preferences apply when a writing action is selected.

## Example: discuss an AMC problem

A user opens a page containing an AMC question and its published solution, then opens pi-x. The context includes the problem statement, answer choices, available solution, page title, and URL. Selecting the question identifies the focus without discarding the rest of the page.

The user can ask “Give me a hint without revealing the answer,” “Why does the solution use this substitution?”, or “Can we solve it using geometry instead?” Follow-ups preserve the discussion. If the published solution is already in context, a hint-only request still controls what the assistant reveals. Distinguish the page's solution from the assistant's own reasoning and flag missing formulas or diagrams instead of guessing.

Text-based questions and solutions belong in the first release. Diagram-dependent questions require explicit visual context; do not claim complete AMC support from text extraction alone. Creating an X post about the explanation is a separate action the user may choose afterward.

## Conversation and navigation rules

- Capture the active page when starting a new conversation; keep that conversation attached to its snapshot.
- Switching tabs or navigating does not silently attach another page or mix its content into the conversation. Show when the current page differs and offer an explicit update or new chat.
- Refreshing context creates a new snapshot for subsequent messages; preserve the association between earlier messages and their source snapshot.
- Closing the side panel, source tab, or X composer does not delete a general conversation. Detaching an editor disables its write actions without ending page chat.
- Retain existing manual review before inserting into X and manual posting through X itself.
- Keep history local, expose deletion controls, and disclose that attached signed-in content is sent to the selected model provider when a message is submitted. Keep page conversations and all their turns for 24 hours after the latest message or context update, with cleanup while Chrome runs.

## Implementation boundaries

Standalone page-chat records provide conversation identity; jobs retain immutable page-context snapshots. The X adapter continues to use composer IDs for its existing workflows. Do not model every page as a synthetic X post or every assistant response as a draft revision.

Browser extraction supports current-page metadata and selection capture. Chat messages are displayed separately from insertable draft proposals, and existing X histories and settings remain compatible. Explicit screenshot opt-in enables visual research on the unchanged attached page; it requires a vision-capable model.

## First-release acceptance criteria

- On a normal non-X article page, opening pi-x shows the page title, URL, and captured content state, and the user can ask a question without opening X.
- Answers can use captured page content and metadata, and the user can inspect what was attached.
- A text-based AMC question and solution support hints, step explanations, and alternative approaches across follow-ups without tweet formatting.
- Missing or truncated content is visible; image-only problems identify the need for visual context.
- Switching tabs, navigating, refreshing context, closing the panel, and reopening history obey the conversation rules above.
- X original-post, quote, reply, Insert, and Undo workflows continue to work when explicitly selected.
- Page text cannot authorize tool actions or override user instructions.

## Outside the initial scope

Autonomous posting, arbitrary form filling, broad browser automation, background collection of browsing history, automatic attachment of every open tab, and a dedicated AMC question bank or grading system are outside the first release.

## Conversational drawing capability

Page chat now exposes `calculate`, `get_diagram`, and `draw_diagram`. These tools reuse Smart’s pure TypeScript geometry kernel and arithmetic parser. They provide validated, evolving planar diagrams and rotatable solid wireframes, with prominent/expanded previews, label movement, zoom, version selection/undo, and SVG/PNG export. Explanations and relevant knowledge remain the responsibility of the configured model and existing research tools. A request to draw alone does not authorize revealing hints or solutions.

Diagram documents are stored separately from page snapshots. The latest 24 drawing versions and up to 1,000 applied-operation receipts prevent durable retries from duplicating edits or restoring old drawings. Invalid edits leave the existing document untouched. Current diagram state is attached to each follow-up so manual undo/history changes remain authoritative. Conversation deletion and expiry remove diagram data too.

Supported declared constraints are checked numerically, not symbolically. Common solids are displayed as wireframes; this is not a full CAD or proof environment. Geometry that is ambiguous or outside the supported schema should trigger clarification or a specific limitation.

## General artifact workspace

Page chat owns multiple reusable artifacts, initially geometry diagrams, Markdown documents and inert code. Stable IDs and independent revision histories let follow-up messages revise an existing deliverable. Shared controls provide selection, preview/source, restoration, copy/download, expansion and a full-width tab. Round cards open that round's final revision of each artifact.

The type and renderer registries separate content validation/rendering from conversation persistence. Additional kinds use the same list/read/create/update tools, version checks and cleanup lifecycle. Raw HTML applications and executable previews are outside this release. Markdown renders through safe DOM construction and code remains inert. Artifact contents are untrusted source data in model context.

Storage permits 12 artifacts, 24 revisions each, 1,000 durable operation receipts and a bounded collection size per conversation. Legacy drawing histories migrate on first write. Concurrent or stale edits are rejected; deletion and expiry remove all artifact kinds.

## Chat-first preview layout

Artifact canvases are hidden from the chat panel by default. A compact chip or chat artifact card opens an artifact-only, resizable popup directly, including when the inline preview was docked. The popup offers Keep on top, invoking Document Picture-in-Picture from its own document. The side panel never waits on the PiP API. Unavailable or nonresponsive pin requests leave the regular preview open. The pinned preview is bound to its originating panel and conversation and closes on conversation changes, deletion or panel closure. The existing shared store and polling keep updates, version selection and labels synchronized across chat and preview. Opening an existing preview focuses it; closing it allows reopening. Refreshing or removing page context preserves the preview conversation. Conversation deletion closes the detached preview on its next successful poll.

Dock preview optionally restores the inline workspace; Hide preview or opening the detached window returns that space to chat. Page metadata, text, screenshot consent and context actions live in the toolbar’s Chat options menu. The composer contains no attached-page row. The message field grows with input and retains the compact send/stop icon.

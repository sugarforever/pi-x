# Model Providers Implementation Plan

**Goal:** Add ChatGPT subscription sign-in and an explicit OpenAI-compatible provider choice to pi-x.

**Architecture:** Keep existing model profiles and default selection. Add a provider discriminator, defaulting existing profiles to OpenAI-compatible. Handle ChatGPT device authorization and token refresh in the extension background worker; use Pi’s Codex Responses adapter for subscription requests. Store subscription credentials separately from editable settings and expose only account status to the options page.

**Tech Stack:** TypeScript, Chrome Manifest V3, Pi AI 1.4.0, Vitest, Playwright.

**Spec:** User request in this chat: ChatGPT subscription sign-in and OpenAI-compatible integration with base URL and API key.

## Constraints

- Preserve existing uncommitted work and legacy endpoint settings.
- Keep credentials out of content scripts, public settings, error messages, and exported model profiles.
- Use the existing OpenAI-compatible request behavior for migrated profiles.
- Device sign-in depends on account/workspace device authorization availability.

## Review Focus

Expired and rotated tokens; cancellation and service-worker restart during login; switching between subscription and custom providers; malformed token responses; preventing subscription credentials from reaching custom endpoints.

## Task 1: Provider profiles and options

Files: `src/shared/types.ts`, `src/shared/settings.ts`, `src/options/index.ts`, `src/options/options.html`, `tests/settings.test.ts`, `tests/preferences.test.ts`, `tests/options.test.ts`.

- [x] Write tests for legacy profile migration, provider validation, and switching model profiles without losing endpoint settings.
- [x] Run targeted tests and confirm failures establish the missing provider behavior.
- [x] Add optional `provider: 'openai-compatible' | 'chatgpt'` to profiles and resolved settings; missing provider means OpenAI-compatible.
- [x] Add provider selection; show base URL and API key for compatible providers and subscription status/sign-in/sign-out for ChatGPT.
- [x] Run targeted tests and typecheck.

## Task 2: Subscription authentication and requests

Files: new `src/background/chatgpt-auth.ts`, `src/background/index.ts`, `src/agent/models.ts`, new `tests/chatgpt-auth.test.ts`, `tests/models.test.ts`.

Interfaces: background-only start/poll/cancel/status/sign-out operations; request authentication resolves persisted subscription credentials, refreshing before expiry. `configuredModels` retains the existing `configured` provider identifier for agent compatibility.

- [x] Write failing tests for pending/success/denied/expired device authorization, cancellation, malformed responses, refresh serialization, sign-out, and secret-free status/errors.
- [x] Implement browser-safe device authorization based on the installed Pi protocol, with bounded polling and persisted login expiry. Restrict authentication messages to extension settings.
- [x] Write failing request tests proving Codex adapter selection and proving custom providers never receive subscription tokens.
- [x] Resolve ChatGPT request credentials only in the background and route through Pi’s Codex Responses adapter. Keep tool limits and request timeout behavior.
- [x] Run authentication, request, and existing agent tests.

## Task 3: Documentation and verification

Files: `README.md`, browser integration tests as needed.

- [x] Update setup and privacy documentation to explain both provider choices and device-code sign-in.
- [x] Run `npm run check` and `npm run test:browser`; report any failures by name.
- [x] Inspect final diff for unrelated edits and credential exposure. Live subscription authentication requires the user’s own account; report whether it was exercised.

## Verification results

`npm run check` passed (121 tests, typecheck and browser build). `npm run test:browser` passed, including a simulated subscription device flow, Settings reload recovery, Codex request, sign-out and restored custom endpoint. The browser suite also covered existing compose/research behavior. Code review identified transient refresh credential loss; it was fixed and regression tested. Live authorization with a real ChatGPT account was not exercised.

## Browser sign-in follow-up

User requested standard browser sign-in as the default. Use Pi's existing authorization-code protocol with a random state and S256 PKCE. Persist the verifier, state, originating tab ID and expiry in background-only storage. Observe the registered localhost callback in that exact tab, validate its full origin/path and state, exchange once, then navigate to Settings. Keep device-code sign-in as an explicit fallback. Test tab binding, wrong state/origin, PKCE derivation, restart recovery, expiry, cancellation and a Chrome callback navigation without a local listener.

Browser follow-up verification: `npm run check` passed with 126 tests; formatting and diff checks passed. `npm run test:browser` passed, including both sign-in methods and capture of a loopback callback without a local server. Code review found no substantive issue. Real-account authorization remains unverified.

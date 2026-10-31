# Chat redesign implementation plan

Goal: Apply the supplied pi-x Redesign-v2.html panel design.
Architecture: Keep the existing panel commands and safety checks. Change panel markup, styles and presentation of revisions, citations and tool activity.
Spec: /Users/wyang14/Downloads/pi-x Redesign-v2.html

- [x] Add regression coverage for source context inside the composer, compact citations and expandable earlier versions.
- [x] Replace mode tabs with a compact native disclosure menu and move source context into the composer. Keep the model control available in the header.
- [x] Render earlier revisions as disclosures, domain source chips and compact tool summaries. Preserve original text for copying and insertion.
- [x] Match spacing, typography, actions and responsive behavior to the prototype.
- [x] Run typecheck, tests and build; inspect rendered panel.

Validation: npm run check (133 tests), npm run test:browser, formatting and diff checks passed. Rendered at 320, 400 and 600 pixels without horizontal overflow. Thread presentation recognizes complete explicit 1/N numbering; insertion remains the existing single-draft command. Model choice remains available in the compact header.

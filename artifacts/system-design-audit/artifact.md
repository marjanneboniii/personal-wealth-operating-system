# Template execution contract

## Reference

- Source: `/Users/miladsaki/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-system-design/assets/reference.docx`
- SHA 256: `13504f6c221a42c1726460a9e865e563355539ff97d702d6c9b2267b4b261d76`
- Render: `/private/tmp/system-design-audit-20260912/reference-render`
- Evidence: `/private/tmp/system-design-audit-20260912/template-style-evidence.json`
- Pages: 7
- Sections: 1

## Page system

- Letter portrait, 8.5 by 11 inches.
- Margins: left 0.70, right 0.70, top 0.70, bottom 0.62 inches.
- One `NEW_PAGE` section with different first page enabled.
- Header and footer are not linked to a previous section.
- The first page is a sparse cover. Later pages use a centered footer.

## Typography

- Source body and heading family: embedded Helvetica Neue; occasional Arial.
- Title: very large, left aligned, two-tier system name and proposal title.
- Heading 1: dark navy, numbered, bold, compact spacing.
- Heading 3: gray-blue, bold. The source skips Heading 2 for two subsections.
- Body: dark slate, approximately 11 to 12 points, open leading.
- The source relies heavily on direct formatting: 200 directly formatted runs and 218 directly formatted paragraphs.
- The Persian audit intentionally uses Arial for Arabic-script coverage while retaining the source page geometry and restrained sans-serif character.

## Lists and tables

- Numbered request-lifecycle lists use lower-case alphabetic markers and hanging indents.
- Tables use dark navy headers with white text, pale blue first columns or alternating rows, white internal gridlines, and generous row height.
- Tables span the content width with unequal columns based on content.
- Source tables are used for goals, components, contracts, failure scenarios, readiness, alternatives, and milestones.

## Components and content flow

- Cover with title, status, owner, update date, and a four-row metadata table.
- Twelve numbered sections: abstract; goals and non-goals; background; architecture; lifecycle; contracts; consistency and replay; security; readiness; alternatives; open questions; decision and next steps.
- One inline architecture image at 6.70 by 3.43 inches.
- One footnote reference and two alternate header/footer pairs.

## Slot map

- Main body placeholders are editable and may be replaced for this audit.
- Cover title, status, owner, date, authors, reviewers, related documents, and scope are editable.
- Architecture image is replaceable. In the source it has no alt text; the audit output must provide alt text.
- Header and footer organization placeholders are editable.
- Page size, margins, recurring footer rhythm, table language, and restrained hierarchy remain source-derived.
- Embedded fonts, theme, numbering, relationships, and package metadata are preserve-only unless the redesign needs a deliberate replacement.

## Package preservation

- Baseline package contains 24 parts, including 8 embedded Helvetica Neue font binaries, 4 header/footer XML parts, numbering, styles, theme, one PNG, and footnotes.
- The audit is a deliberate redesign requested by the user. Body content, headers, footers, image relationships, styles, and font declarations may change.
- Page geometry and the reference file itself are immutable fidelity gates.

## Audit findings on the reference

- Accessibility: one high-severity missing-alt-text finding for the architecture image.
- Structure: two medium heading-level jumps from Heading 1 to Heading 3.
- Navigation: no TOC and no Word fields for page numbers or cross-references.
- Visual: the cover leaves most of the page unused and has no product identity.
- Domain fit: the template is a generic software RFC and has no dedicated financial invariants, reconciliation, valuation provenance, ledger controls, tenant isolation, or disaster-recovery evidence.

## Fidelity gates

- Keep the reference byte-for-byte unchanged and verify its SHA 256 at delivery.
- Render every page of the output and inspect it at normal size.
- Confirm Letter geometry, RTL readability, correct Persian shaping, clean tables, no clipping, and consistent recurring footer treatment.
- Run section, style, heading, image, and accessibility audits on the final document.


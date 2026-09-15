# Low vision

Profile: `low-vision` · Vision

Magnification, contrast, reflow and text spacing.

## Perspective

Journey: **pointer**. Screenshots, blurred and reduced-contrast simulations, measured contrast and page code.

You review the page as a person with low vision: high magnification, reduced acuity and reduced contrast sensitivity. You receive the standard screenshot, a blurred-vision simulation, a reduced-contrast simulation, a 320px-wide reflow rendering, a 200% text-size rendering, measured contrast ratios and the page code.

Do not report on screen-reader behaviour or audio; those belong to other profiles.

Evidence channels: screenshot, simulation, measurements, dom, axe, journey-transcript.

Additional renderings per page state: blurredVision, reducedContrast, narrow-viewport, large-text.

## Agent instructions

You are the Low vision accessibility specialist.

Goal: A person with partial sight can read and operate the scenario at high zoom, large text and reduced contrast sensitivity.

Perspective: You review the page as a person with low vision: high magnification, reduced acuity and reduced contrast sensitivity. You receive the standard screenshot, a blurred-vision simulation, a reduced-contrast simulation, a 320px-wide reflow rendering, a 200% text-size rendering, measured contrast ratios and the page code.
Evidence you receive: the standard screenshot of each page state; alternative renderings of the same state; measured values such as contrast ratios, target sizes and overflow; the rendered HTML; automated rule results relevant to this profile; the transcript of the navigation agent for this perspective.
Do not report on screen-reader behaviour or audio; those belong to other profiles.

Assess only evidence that is present. For each issue explain the user impact, the exact page state and element as it appears in your evidence, the WCAG 2.2 criterion when applicable, and a practical fix. Use needs_review when a real assistive technology or human judgement is required. Do not infer a pass from missing evidence.

Checks:
- Text and non-text contrast: Report measured contrast ratios below the minimum for text and meaningful UI components. (1.4.3 Contrast (Minimum), 1.4.11 Non-text Contrast)
- Reflow at 320px: Measure horizontal overflow when the viewport is 320 CSS pixels wide; this stands in for 400% zoom but is not browser zoom. (1.4.10 Reflow)
- Text resize and spacing: Measure clipping and overflow at 200% root text size and at the WCAG text-spacing values. (1.4.4 Resize Text, 1.4.12 Text Spacing)
- Readability when magnified: Compare the standard, 320px and 200%-text renderings: is content lost, clipped or unreachable, and does the task remain understandable? (1.4.10 Reflow, 1.4.4 Resize Text, 2.4.11 Focus Not Obscured (Minimum))
- Visibility with blurred and low-contrast vision: Using the blurred-vision and reduced-contrast renderings, judge whether controls, focus, boundaries and status information remain perceivable. (1.4.3 Contrast (Minimum), 1.4.11 Non-text Contrast, 2.4.7 Focus Visible)

Limitations:
- Automated evidence is a signal for review, not a declaration of WCAG conformance.
- Each specialist reviews only the evidence its perspective allows; findings outside that perspective belong to another profile.
- Viewport and text-size probes approximate browser zoom; they do not replace 200 to 400% browser zoom testing.

## Procedure and evidence

### Text and non-text contrast

Report measured contrast ratios below the minimum for text and meaningful UI components.

Method: tool. Record the page-state identifier, the element as it appears in the perspective's evidence, the measured value or exact observation, and the cited evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [1.4.3 — Contrast (Minimum)](https://www.w3.org/TR/WCAG22/#contrast-minimum)
- [1.4.11 — Non-text Contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast)

### Reflow at 320px

Measure horizontal overflow when the viewport is 320 CSS pixels wide; this stands in for 400% zoom but is not browser zoom.

Method: tool. Record the page-state identifier, the element as it appears in the perspective's evidence, the measured value or exact observation, and the cited evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [1.4.10 — Reflow](https://www.w3.org/TR/WCAG22/#reflow)

### Text resize and spacing

Measure clipping and overflow at 200% root text size and at the WCAG text-spacing values.

Method: tool. Record the page-state identifier, the element as it appears in the perspective's evidence, the measured value or exact observation, and the cited evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [1.4.4 — Resize Text](https://www.w3.org/TR/WCAG22/#resize-text)
- [1.4.12 — Text Spacing](https://www.w3.org/TR/WCAG22/#text-spacing)

### Readability when magnified

Compare the standard, 320px and 200%-text renderings: is content lost, clipped or unreachable, and does the task remain understandable?

Method: gemini. Record the page-state identifier, the element as it appears in the perspective's evidence, the measured value or exact observation, and the cited evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [1.4.10 — Reflow](https://www.w3.org/TR/WCAG22/#reflow)
- [1.4.4 — Resize Text](https://www.w3.org/TR/WCAG22/#resize-text)
- [2.4.11 — Focus Not Obscured (Minimum)](https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum)

### Visibility with blurred and low-contrast vision

Using the blurred-vision and reduced-contrast renderings, judge whether controls, focus, boundaries and status information remain perceivable.

Method: gemini. Record the page-state identifier, the element as it appears in the perspective's evidence, the measured value or exact observation, and the cited evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [1.4.3 — Contrast (Minimum)](https://www.w3.org/TR/WCAG22/#contrast-minimum)
- [1.4.11 — Non-text Contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast)
- [2.4.7 — Focus Visible](https://www.w3.org/TR/WCAG22/#focus-visible)

## Result policy

Use `fail` only for verified checker violations; use `needs_review` for model interpretation or unverified exceptions. A passing rule does not establish profile-wide or WCAG conformance. Conditions such as disability or sensory sensitivity are test perspectives, not diagnoses of the user.

The typed execution catalog is maintained in `src/playbooks.ts`; regenerate this file with `npm run docs:playbooks` after changing it.

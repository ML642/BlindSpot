# Motor and dexterity impairments

Profile: `motor` · Movement

Keyboard access, generous targets and alternatives to dragging.

## Agent instructions

You are the Motor and dexterity impairments accessibility specialist.

Goal: A user with limited dexterity can complete the scenario without precision, dragging or tight timing.

Review the supplied page states, screenshots, DOM, accessibility tree, tool output, and user scenario. Assess only evidence that is present. For each issue, explain the user impact, exact state and element, WCAG 2.2 criterion when applicable, and a practical fix. Use needs_review when a real assistive-technology or human judgment is required. Do not infer a pass from missing evidence.

Checks:
- Keyboard access: Inspect focusable controls, tabindex and keyboard-reachable names; runtime traversal is recommended. (2.1.1 Keyboard, 2.1.2 No Keyboard Trap)
- Target size and spacing: Find actionable targets below 24×24 CSS pixels, excluding applicable exceptions. (2.5.8 Target Size (Minimum))
- Dragging alternatives: Identify draggable widgets and request a keyboard or single-pointer alternative. (2.5.7 Dragging Movements, 2.5.1 Pointer Gestures)
- Forgiving interaction flow: Review timing, accidental activation, undo and destructive-action spacing. (2.5.2 Pointer Cancellation, 3.3.4 Error Prevention (Legal, Financial, Data))

Limitations:
- Automated evidence is a signal for review, not a declaration of WCAG conformance.
- The specialist must review screenshots, DOM and accessibility-tree evidence in the context of the requested scenario.
- A real screen reader, switch, voice-control system, or assistive technology is not emulated by this audit.

## Procedure and evidence

### Keyboard access

Inspect focusable controls, tabindex and keyboard-reachable names; runtime traversal is recommended.

Method: tool. Record the page-state identifier, selector if available, measured value or exact observation, and screenshot/DOM/ARIA evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [2.1.1 — Keyboard](https://www.w3.org/TR/WCAG22/#keyboard)
- [2.1.2 — No Keyboard Trap](https://www.w3.org/TR/WCAG22/#no-keyboard-trap)

### Target size and spacing

Find actionable targets below 24×24 CSS pixels, excluding applicable exceptions.

Method: tool. Record the page-state identifier, selector if available, measured value or exact observation, and screenshot/DOM/ARIA evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [2.5.8 — Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum)

### Dragging alternatives

Identify draggable widgets and request a keyboard or single-pointer alternative.

Method: tool. Record the page-state identifier, selector if available, measured value or exact observation, and screenshot/DOM/ARIA evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [2.5.7 — Dragging Movements](https://www.w3.org/TR/WCAG22/#dragging-movements)
- [2.5.1 — Pointer Gestures](https://www.w3.org/TR/WCAG22/#pointer-gestures)

### Forgiving interaction flow

Review timing, accidental activation, undo and destructive-action spacing.

Method: gemini. Record the page-state identifier, selector if available, measured value or exact observation, and screenshot/DOM/ARIA evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [2.5.2 — Pointer Cancellation](https://www.w3.org/TR/WCAG22/#pointer-cancellation)
- [3.3.4 — Error Prevention (Legal, Financial, Data)](https://www.w3.org/TR/WCAG22/#error-prevention-legal-financial-data)

## Result policy

Use `fail` only for verified checker violations; use `needs_review` for model interpretation or unverified exceptions. A passing rule does not establish profile-wide or WCAG conformance. Conditions such as disability, temporary limitation or situation are test perspectives, not diagnoses of the user.

The typed execution catalog is maintained in `src/playbooks.ts`; update both this playbook and that catalog when changing procedures.

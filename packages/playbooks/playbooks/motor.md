# Motor and dexterity

Profile: `motor` · Movement

Keyboard-only operation, target size, and no dragging or tight timing.

## Perspective

Journey: **keyboard**. Screenshots with the keyboard focus trace, measured target sizes and page code. The agent never uses a mouse.

You review the page as a person who cannot use a mouse and relies on the keyboard, a switch or voice control. You receive screenshots, a sequential Tab focus trace with focus-indicator measurements, measured target sizes, the page code and the transcript of a navigation agent that used only the keyboard.

Do not report screen-reader announcements or colour issues; judge reachability, operability, focus visibility and forgiving interaction.

Evidence channels: screenshot, focus-trace, measurements, dom, axe, journey-transcript.

## Agent instructions

You are the Motor and dexterity accessibility specialist.

Goal: A person who cannot use a mouse and has limited precision can complete the scenario with the keyboard alone, without dragging or accidental activation.

Perspective: You review the page as a person who cannot use a mouse and relies on the keyboard, a switch or voice control. You receive screenshots, a sequential Tab focus trace with focus-indicator measurements, measured target sizes, the page code and the transcript of a navigation agent that used only the keyboard.
Evidence you receive: the standard screenshot of each page state; a sequential Tab focus trace with focus-indicator measurements; measured values such as contrast ratios, target sizes and overflow; the rendered HTML; automated rule results relevant to this profile; the transcript of the navigation agent for this perspective.
Do not report screen-reader announcements or colour issues; judge reachability, operability, focus visibility and forgiving interaction.

Assess only evidence that is present. For each issue explain the user impact, the exact page state and element as it appears in your evidence, the WCAG 2.2 criterion when applicable, and a practical fix. Use needs_review when a real assistive technology or human judgement is required. Do not infer a pass from missing evidence.

Checks:
- Keyboard reachability and traps: Compare focusable controls with the Tab trace; detect repeated focus positions and controls never reached. (2.1.1 Keyboard, 2.1.2 No Keyboard Trap, 2.4.3 Focus Order)
- Visible focus indicator: Measure whether the focused element changes outline, shadow, border or background compared with its unfocused state. (2.4.7 Focus Visible)
- Target size: Find actionable targets smaller than 24 by 24 CSS pixels. (2.5.8 Target Size (Minimum))
- Dragging and pointer-only patterns: Identify draggable widgets and controls without an accessible name for voice control. (2.5.7 Dragging Movements, 2.5.1 Pointer Gestures, 2.5.3 Label in Name)
- Keyboard-only task completion: From the keyboard transcript and screenshots, judge whether every step of the scenario could be reached and operated by keyboard, whether focus was visible at each step, and whether any step needed hover, drag or precise timing. (2.1.1 Keyboard, 2.4.3 Focus Order, 2.4.7 Focus Visible, 2.5.7 Dragging Movements, 2.5.2 Pointer Cancellation)

Limitations:
- Automated evidence is a signal for review, not a declaration of WCAG conformance.
- Each specialist reviews only the evidence its perspective allows; findings outside that perspective belong to another profile.
- Switch access and voice control are approximated by keyboard operation and accessible-name checks.

## Procedure and evidence

### Keyboard reachability and traps

Compare focusable controls with the Tab trace; detect repeated focus positions and controls never reached.

Method: tool. Record the page-state identifier, the element as it appears in the perspective's evidence, the measured value or exact observation, and the cited evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [2.1.1 — Keyboard](https://www.w3.org/TR/WCAG22/#keyboard)
- [2.1.2 — No Keyboard Trap](https://www.w3.org/TR/WCAG22/#no-keyboard-trap)
- [2.4.3 — Focus Order](https://www.w3.org/TR/WCAG22/#focus-order)

### Visible focus indicator

Measure whether the focused element changes outline, shadow, border or background compared with its unfocused state.

Method: tool. Record the page-state identifier, the element as it appears in the perspective's evidence, the measured value or exact observation, and the cited evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [2.4.7 — Focus Visible](https://www.w3.org/TR/WCAG22/#focus-visible)

### Target size

Find actionable targets smaller than 24 by 24 CSS pixels.

Method: tool. Record the page-state identifier, the element as it appears in the perspective's evidence, the measured value or exact observation, and the cited evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [2.5.8 — Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum)

### Dragging and pointer-only patterns

Identify draggable widgets and controls without an accessible name for voice control.

Method: tool. Record the page-state identifier, the element as it appears in the perspective's evidence, the measured value or exact observation, and the cited evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [2.5.7 — Dragging Movements](https://www.w3.org/TR/WCAG22/#dragging-movements)
- [2.5.1 — Pointer Gestures](https://www.w3.org/TR/WCAG22/#pointer-gestures)
- [2.5.3 — Label in Name](https://www.w3.org/TR/WCAG22/#label-in-name)

### Keyboard-only task completion

From the keyboard transcript and screenshots, judge whether every step of the scenario could be reached and operated by keyboard, whether focus was visible at each step, and whether any step needed hover, drag or precise timing.

Method: gemini. Record the page-state identifier, the element as it appears in the perspective's evidence, the measured value or exact observation, and the cited evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [2.1.1 — Keyboard](https://www.w3.org/TR/WCAG22/#keyboard)
- [2.4.3 — Focus Order](https://www.w3.org/TR/WCAG22/#focus-order)
- [2.4.7 — Focus Visible](https://www.w3.org/TR/WCAG22/#focus-visible)
- [2.5.7 — Dragging Movements](https://www.w3.org/TR/WCAG22/#dragging-movements)
- [2.5.2 — Pointer Cancellation](https://www.w3.org/TR/WCAG22/#pointer-cancellation)

## Result policy

Use `fail` only for verified checker violations; use `needs_review` for model interpretation or unverified exceptions. A passing rule does not establish profile-wide or WCAG conformance. Conditions such as disability or sensory sensitivity are test perspectives, not diagnoses of the user.

The typed execution catalog is maintained in `src/playbooks.ts`; regenerate this file with `npm run docs:playbooks` after changing it.

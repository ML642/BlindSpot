# Blindness

Profile: `blindness` · Vision

Screen readers, semantic structure, labels and reading order.

## Agent instructions

You are the Blindness accessibility specialist.

Goal: A blind person can understand and complete the scenario with a screen reader and keyboard.

Review the supplied page states, screenshots, DOM, accessibility tree, tool output, and user scenario. Assess only evidence that is present. For each issue, explain the user impact, exact state and element, WCAG 2.2 criterion when applicable, and a practical fix. Use needs_review when a real assistive-technology or human judgment is required. Do not infer a pass from missing evidence.

Checks:
- Semantic structure and landmarks: Check headings, landmarks, lists, tables and relationships exposed in the DOM. (1.3.1 Info and Relationships, 2.4.6 Headings and Labels)
- Meaningful names and labels: Find images, controls and links without useful accessible names. (1.1.1 Non-text Content, 4.1.2 Name, Role, Value, 3.3.2 Labels or Instructions)
- Logical reading order: Compare DOM order with the visual and task order of content. (1.3.2 Meaningful Sequence, 2.4.3 Focus Order)
- Screen-reader task flow: Review whether announcements, focus, errors and dynamic states make the scenario understandable. (4.1.3 Status Messages, 3.3.1 Error Identification)

Limitations:
- Automated evidence is a signal for review, not a declaration of WCAG conformance.
- The specialist must review screenshots, DOM and accessibility-tree evidence in the context of the requested scenario.
- A real screen reader, switch, voice-control system, or assistive technology is not emulated by this audit.

## Procedure and evidence

### Semantic structure and landmarks

Check headings, landmarks, lists, tables and relationships exposed in the DOM.

Method: tool. Record the page-state identifier, selector if available, measured value or exact observation, and screenshot/DOM/ARIA evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [1.3.1 — Info and Relationships](https://www.w3.org/TR/WCAG22/#info-and-relationships)
- [2.4.6 — Headings and Labels](https://www.w3.org/TR/WCAG22/#headings-and-labels)

### Meaningful names and labels

Find images, controls and links without useful accessible names.

Method: tool. Record the page-state identifier, selector if available, measured value or exact observation, and screenshot/DOM/ARIA evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [1.1.1 — Non-text Content](https://www.w3.org/TR/WCAG22/#non-text-content)
- [4.1.2 — Name, Role, Value](https://www.w3.org/TR/WCAG22/#name-role-value)
- [3.3.2 — Labels or Instructions](https://www.w3.org/TR/WCAG22/#labels-or-instructions)

### Logical reading order

Compare DOM order with the visual and task order of content.

Method: tool. Record the page-state identifier, selector if available, measured value or exact observation, and screenshot/DOM/ARIA evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [1.3.2 — Meaningful Sequence](https://www.w3.org/TR/WCAG22/#meaningful-sequence)
- [2.4.3 — Focus Order](https://www.w3.org/TR/WCAG22/#focus-order)

### Screen-reader task flow

Review whether announcements, focus, errors and dynamic states make the scenario understandable.

Method: gemini. Record the page-state identifier, selector if available, measured value or exact observation, and screenshot/DOM/ARIA evidence. Mark unexecuted checks blocked; interpretive checks need review.

- [4.1.3 — Status Messages](https://www.w3.org/TR/WCAG22/#status-messages)
- [3.3.1 — Error Identification](https://www.w3.org/TR/WCAG22/#error-identification)

## Result policy

Use `fail` only for verified checker violations; use `needs_review` for model interpretation or unverified exceptions. A passing rule does not establish profile-wide or WCAG conformance. Conditions such as disability, temporary limitation or situation are test perspectives, not diagnoses of the user.

The typed execution catalog is maintained in `src/playbooks.ts`; update both this playbook and that catalog when changing procedures.

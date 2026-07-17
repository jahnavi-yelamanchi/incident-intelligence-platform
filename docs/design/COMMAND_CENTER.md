# Command Center Design Reference

The command center uses a calm, focus-first operations layout: navigation, incident queue, active incident signal/timeline, and one investigation panel. Secondary surfaces are hidden behind explicit drawers or view controls, and panel visibility is saved per browser.

## Visual rules

- Absolute black canvas with charcoal elevation and thin structural separators.
- White content, gray metadata, semantic red/cyan/green, and gold reserved for the primary approval action.
- Sharp rectangular geometry, condensed uppercase display type, and compact monospace operational data.
- No gradients, decorative imagery, pill-heavy UI, or dense card grids.

## Motion rules

- Motion must explain state: chart traces draw, new timeline events settle into place, panels slide from their edge, confidence fills, and approval transitions confirm completion.
- Keep transitions between 150–400 ms, except data traces up to 1.5 seconds.
- Do not scale or bounce ordinary controls. Respect `prefers-reduced-motion` globally.

The adjacent `command-center-concept.png` is the accepted desktop visual reference.

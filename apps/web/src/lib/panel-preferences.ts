const panelKeys = ["incidents", "investigation"] as const;

export type PanelKey = (typeof panelKeys)[number];

export function parseHiddenPanels(value: string | null): PanelKey[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return panelKeys.filter((panel) => parsed.includes(panel));
  } catch {
    return [];
  }
}

export function toggleHiddenPanel(current: readonly PanelKey[], panel: PanelKey): PanelKey[] {
  return current.includes(panel) ? current.filter((item) => item !== panel) : [...current, panel];
}

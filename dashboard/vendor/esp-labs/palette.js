// Adapted from esp-labs-web (https://github.com/agharsallah/esp-labs-web), MIT License,
// Copyright (c) 2026 Abderrehmen Gharsallah. Original file: src/lib/palette.ts.
// Changes: rewritten as a minimal CSS custom-property reader. See THIRD_PARTY_NOTICE.txt.
// Minimal replacement for the original palette helper: map friendly names to CSS custom properties.
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export function definePalette(spec) {
  let cached;
  return () => (cached ??= Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, cssVar(v)])));
}

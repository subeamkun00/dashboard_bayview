// Visual sizing only: no browser zoom, application data, or permissions change.
export const UI_SCALE = 1.25;
export const uiPixels = (designPixels: number) => designPixels * UI_SCALE;
// Matches the corresponding scaled editor breakpoint in globals.css.
export const EMPLOYEE_DRAWER_QUERY = `(max-width: ${uiPixels(1100)}px)`;

// Escapes text for safe interpolation into an innerHTML template string.
// Dependency-free by design: every page bundle (popup/jobs/options) that only
// needs this one helper shouldn't have to pull in render.ts's full chain
// (api.ts, outputAnalysis.ts, outputSchema.ts) just to escape a string.
export function escHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}

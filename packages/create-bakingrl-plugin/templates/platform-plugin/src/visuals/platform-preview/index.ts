import { defineVisual, type VisualContext } from "@bakingrl/plugin-sdk";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function render(count: number, message: string) {
  return `
    <style>
      .platform-preview{height:100%;display:grid;align-content:center;gap:8px;padding:20px;background:#f8fafc;color:#111827;border-left:6px solid #16a34a;font:14px/1.4 Inter,ui-sans-serif,system-ui,sans-serif}
      .label{color:#166534;text-transform:uppercase;font-size:12px;font-weight:900}.value{font-size:28px;font-weight:950}.meta{color:#475569}
    </style>
    <section class="platform-preview">
      <div class="label">__PLUGIN_NAME__</div>
      <div class="value">${count} contribution(s)</div>
      <div class="meta">${escapeHtml(message)}</div>
    </section>
  `;
}

export default defineVisual({
  async mount(context: VisualContext) {
    async function paint() {
      try {
        const snapshot = await context.services.call<{ contributions?: unknown[] }>(
          `${context.package.id}/platform`,
          "snapshot",
          {}
        );
        context.root.innerHTML = render(snapshot.contributions?.length ?? 0, "Host discovery is available");
      } catch (error) {
        context.root.innerHTML = render(0, error instanceof Error ? error.message : "Discovery unavailable");
      }
    }

    await paint();
  }
});

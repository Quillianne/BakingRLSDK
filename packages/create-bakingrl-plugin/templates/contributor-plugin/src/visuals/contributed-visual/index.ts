import { defineVisual, type VisualContext } from "@bakingrl/plugin-sdk";

export default defineVisual({
  mount(context: VisualContext) {
    context.root.innerHTML = `
      <section style="height:100%;display:grid;place-items:center;background:#fff7ed;color:#111827;border-left:6px solid #ea580c;font:700 18px system-ui,sans-serif">
        __PLUGIN_NAME__ contribution
      </section>
    `;
  }
});

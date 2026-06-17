import { defineWebview, type WebviewContext } from "@bakingrl/plugin-sdk";

export default defineWebview({
  mount(context: WebviewContext) {
    context.root.innerHTML = "";
    const root = document.createElement("main");
    root.style.cssText = [
      "display:flex",
      "min-height:100vh",
      "align-items:center",
      "justify-content:center",
      "background:#111827",
      "color:#f9fafb",
      "font:16px system-ui,sans-serif"
    ].join(";");
    root.textContent = "__PLUGIN_NAME__";
    context.root.append(root);
  }
});

import { defineWebview, type WebviewContext } from "@bakingrl/plugin-sdk";

export default defineWebview({
  mount(context: WebviewContext) {
    context.root.innerHTML = "";
    const root = document.createElement("main");
    root.style.cssText = [
      "box-sizing:border-box",
      "min-height:100vh",
      "display:grid",
      "place-items:center",
      "padding:24px",
      "background:#f8fafc",
      "color:#111827",
      "font:16px system-ui,sans-serif"
    ].join(";");
    root.innerHTML = "<strong>__PLUGIN_NAME__ platform</strong>";
    context.root.append(root);
  }
});

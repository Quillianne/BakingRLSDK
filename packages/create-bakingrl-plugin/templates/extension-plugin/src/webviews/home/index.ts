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

document.body.append(root);

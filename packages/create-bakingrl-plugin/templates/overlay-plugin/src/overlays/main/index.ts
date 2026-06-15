const root = document.createElement("div");
root.style.cssText = [
  "box-sizing:border-box",
  "display:flex",
  "align-items:center",
  "justify-content:space-between",
  "width:100vw",
  "height:100vh",
  "padding:20px 28px",
  "background:rgba(8,12,18,.84)",
  "border:1px solid rgba(255,255,255,.18)",
  "color:white",
  "font:700 22px Inter,Arial,sans-serif"
].join(";");
root.innerHTML = `
  <span>__PLUGIN_NAME__</span>
  <span style="font-size:14px;font-weight:600;color:#93c5fd;">Overlay ready</span>
`;

document.body.style.margin = "0";
document.body.append(root);

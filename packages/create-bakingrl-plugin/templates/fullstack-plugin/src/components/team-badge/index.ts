import { defineComponent, type ComponentContext } from "@bakingrl/plugin-sdk";

export default defineComponent({
  async mount(context: ComponentContext, props: Record<string, unknown>) {
    const teamName = String(props.teamName ?? "Team");
    const color = String(props.color ?? "#4fa0ff");
    context.root.innerHTML = `
      <div style="display:inline-flex;gap:8px;align-items:center;color:white;font:700 14px Inter,Arial,sans-serif;">
        <span style="width:12px;height:12px;border-radius:50%;background:${color};"></span>
        <span>${teamName}</span>
      </div>
    `;
  }
});

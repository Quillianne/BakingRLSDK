import { defineVisual, type VisualContext } from "@bakingrl/plugin-sdk";

export default defineVisual({
  async mount(context: VisualContext) {
    context.root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;background:rgba(10,14,18,.82);color:white;border:1px solid rgba(255,255,255,.18);font:700 28px Inter,Arial,sans-serif;">
        Waiting for match data
      </div>
    `;
    return context.bus.subscribe("UpdateState", (event) => {
      const data = event.Data as any;
      const teams = data?.Game?.Teams ?? [];
      const blue = teams.find((team: any) => team.TeamNum === 0);
      const orange = teams.find((team: any) => team.TeamNum === 1);
      context.root.firstElementChild!.textContent = `${blue?.Name ?? "Blue"} ${blue?.Score ?? 0} - ${orange?.Score ?? 0} ${orange?.Name ?? "Orange"}`;
    });
  }
});

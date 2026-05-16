import { defineVisual, type VisualContext } from "@bakingrl/plugin-sdk";

function emitEditorState(context: VisualContext, blueScore = 1, orangeScore = 0) {
  context.editor?.emit("UpdateState", {
    Game: {
      Teams: [
        { TeamNum: 0, Name: "Blue", Score: blueScore },
        { TeamNum: 1, Name: "Orange", Score: orangeScore }
      ]
    }
  } as any);
}

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
  },
  editor: {
    mount(context: VisualContext) {
      emitEditorState(context);
    },
    actions() {
      return [
        {
          id: "blue-goal",
          label: "Blue Goal",
          run(context: VisualContext) {
            emitEditorState(context, 2, 0);
          }
        },
        {
          id: "orange-goal",
          label: "Orange Goal",
          run(context: VisualContext) {
            emitEditorState(context, 1, 1);
          }
        }
      ];
    }
  }
});

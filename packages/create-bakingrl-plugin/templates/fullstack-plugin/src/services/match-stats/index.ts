import { defineService, type ServiceContext } from "@bakingrl/plugin-sdk";

let lastSnapshot: unknown = null;

export default defineService({
  async mount(context: ServiceContext) {
    context.bus.subscribe("UpdateState", (event) => {
      lastSnapshot = event.Data;
      context.registry.set("plugin.__PLUGIN_ID__.matchStats.current", event.Data);
    });
  },
  methods: {
    async snapshot() {
      return lastSnapshot;
    },
    async reset() {
      lastSnapshot = null;
      return { ok: true };
    }
  }
});

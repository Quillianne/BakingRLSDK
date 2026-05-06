import { defineConnector, type ConnectorContext } from "@bakingrl/plugin-sdk";

export default defineConnector({
  async mount(context: ConnectorContext) {
    context.diagnostics.log("Twitch connector mounted. Configure credentials before making requests.");
  }
});

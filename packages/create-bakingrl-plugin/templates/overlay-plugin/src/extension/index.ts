import { defineExtension, type ExtensionContext } from "@bakingrl/plugin-sdk";

const extension = defineExtension({
  async activate(context: ExtensionContext) {
    context.logger.info("__PLUGIN_NAME__ overlay extension activated.");
  },
  async deactivate() {}
});

export const activate = extension.activate;
export const deactivate = extension.deactivate;

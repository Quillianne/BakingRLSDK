import { defineExtension, type ExtensionContext } from "@bakingrl/plugin-sdk";

const extension = defineExtension({
  async activate(context: ExtensionContext) {
    context.logger.info("__PLUGIN_NAME__ activated.");
    context.services.register("ping", {
      ping(input: unknown) {
        return {
          ok: true,
          input,
          packageId: context.packageId
        };
      }
    });
  },
  async deactivate() {}
});

export const activate = extension.activate;
export const deactivate = extension.deactivate;

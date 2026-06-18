import { createResourceRef, defineExtension, type ExtensionContext } from "@bakingrl/plugin-sdk";

const SERVICE_ID = "contributor";
const RESOURCE_ID = "contributionData";

const extension = defineExtension({
  async activate(context: ExtensionContext) {
    context.logger.info("__PLUGIN_NAME__ contributor activated.");
    context.services.register(SERVICE_ID, {
      async snapshot() {
        const data = await context.resources.readJson(createResourceRef(context.packageId, RESOURCE_ID));
        return {
          packageId: context.packageId,
          resource: RESOURCE_ID,
          data
        };
      }
    });
  },
  async deactivate() {}
});

export const activate = extension.activate;
export const deactivate = extension.deactivate;

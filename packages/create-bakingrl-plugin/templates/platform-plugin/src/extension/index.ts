import { createExtensionTarget, defineExtension, type ExtensionContext } from "@bakingrl/plugin-sdk";

const EXTENSION_POINT = "items";
const SERVICE_ID = "platform";

function target(context: ExtensionContext) {
  return createExtensionTarget(context.packageId, EXTENSION_POINT);
}

async function discover(context: ExtensionContext) {
  return context.extensions.contributions(target(context));
}

const extension = defineExtension({
  async activate(context: ExtensionContext) {
    context.logger.info("__PLUGIN_NAME__ platform activated.");
    context.services.register(SERVICE_ID, {
      async snapshot() {
        const contributions = await discover(context);
        return {
          packageId: context.packageId,
          target: target(context),
          contributions
        };
      },
      async contributions() {
        return discover(context);
      }
    });
  },
  async deactivate() {}
});

export const activate = extension.activate;
export const deactivate = extension.deactivate;

type ExtensionContext = {
  diagnostics?: {
    log(message: string, data?: unknown): void;
  };
};

export async function activate(context: ExtensionContext = {}) {
  context.diagnostics?.log("__PLUGIN_NAME__ activated.");
}

export async function deactivate() {}

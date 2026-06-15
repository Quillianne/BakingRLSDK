import type { RlTelemetryEventName, RlTelemetryPayloadByEvent } from "./telemetry.js";

export const SDK_VERSION = "1.0.0";
export const RUNTIME_API_VERSION = "1.0.0";
export const SUPPORTED_RUNTIME_API_RANGE = ">=1.0.0 <2.0.0";

export * from "./telemetry.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type CleanupFn = () => void;

export type BakingRLEvent<TData = unknown, TEvent extends string = string> = {
  Event: TEvent;
  Data: TData;
};

export type BakingRLEventData<TEvent extends string> = TEvent extends RlTelemetryEventName
  ? RlTelemetryPayloadByEvent[TEvent]
  : unknown;

export type VisualContext = {
  root: HTMLElement;
  package: {
    id: string;
    name: string;
    enabled: boolean;
  };
  exportName: string;
  item: {
    id: string;
    package_id: string;
    export_name: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    z_index: number;
    visible: boolean;
    locked: boolean;
    opacity: number;
    settings: Record<string, unknown>;
  };
  settings: Record<string, unknown>;
  mode: "runtime" | "editor";
  editor?: VisualEditorContext;
  setActive(active: boolean): void;
  bus: VisualBus;
  registry: ReadonlyRegistry;
  components: ComponentLoader;
  services: ServiceCaller;
  assets: AssetResolver;
  diagnostics: Diagnostics;
};

export type VisualEditorContext = {
  emit<TEvent extends string>(eventName: TEvent, payload?: BakingRLEventData<TEvent>): void;
};

export type ComponentContext = {
  root: HTMLElement;
  providerPackageId: string;
  exportName: string;
  assets: AssetResolver;
  diagnostics: Diagnostics;
};

export type ServiceContext = {
  bus: BackendBus;
  registry: Registry;
  storage: PluginStorage;
  services: ServiceCaller;
  settings: SettingsReader;
  diagnostics: Diagnostics;
};

export type ConnectorContext = ServiceContext & {
  secrets: SecretReader;
  fetch(input: string, init?: unknown): Promise<unknown>;
  websocket: {
    connect(url: string): Promise<unknown>;
  };
};

export type VisualBus = {
  subscribe<TEvent extends string>(
    eventName: TEvent,
    callback: (event: BakingRLEvent<BakingRLEventData<TEvent>, TEvent>) => void
  ): CleanupFn;
};

export type BackendBus = VisualBus & {
  emit<TEvent extends string>(eventName: TEvent, payload: BakingRLEventData<TEvent>): void;
};

export type ReadonlyRegistry = {
  get<TValue = unknown>(key: string): Promise<TValue | null>;
};

export type Registry = {
  get<TValue = unknown>(key: string): TValue | null;
  set<TValue = unknown>(key: string, value: TValue): void;
};

export type PluginStorage = {
  readText(uri: string): Promise<string>;
  writeText(uri: string, contents: string): Promise<void>;
};

export type ComponentHandle = {
  mount(root: HTMLElement, props: Record<string, unknown>): Promise<CleanupFn | void>;
};

export type ComponentLoader = {
  load(ref: string): Promise<ComponentHandle>;
};

export type ServiceCaller = {
  call<TOutput = unknown>(ref: string, method: string, input?: unknown): Promise<TOutput>;
};

export type AssetResolver = {
  url(ref: string): string;
};

export type SettingsReader = {
  get<TValue = unknown>(key: string): TValue | undefined;
  all(): Record<string, unknown>;
};

export type SecretReader = {
  get(key: string): string | undefined;
  configured(key: string): boolean;
};

export type Diagnostics = {
  log(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
};

export type RuntimeApiVersion = typeof RUNTIME_API_VERSION;
export type SupportedRuntimeApiRange = typeof SUPPORTED_RUNTIME_API_RANGE;

export type ExtensionMode = "development" | "production" | "test";

export type ExtensionKind = "extensionHost";

export type ActivationEvent =
  | "*"
  | "onStartupFinished"
  | `onCommand:${string}`
  | `onView:${string}`
  | `onPage:${string}`
  | `onOverlay:${string}`
  | `onService:${string}`
  | `onConfiguration:${string}`
  | `workspaceContains:${string}`;

export type ExtensionSubscription = {
  dispose(): void | Promise<void>;
};

export type Disposable = ExtensionSubscription;

export type ExtensionLogger = {
  trace(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
};

export type ExtensionDiagnosticSeverity = "info" | "warning" | "error";

export type ExtensionDiagnostic = {
  code: string;
  severity: ExtensionDiagnosticSeverity;
  message: string;
  source?: string;
  data?: JsonValue;
};

export type ExtensionDiagnostics = {
  report(diagnostic: ExtensionDiagnostic): void;
  clear(code?: string): void;
};

export type ExtensionSafeMode = {
  enabled: boolean;
  reason?: string;
};

export type ExtensionContext = {
  extension: {
    id: string;
    name: string;
    version: string;
    runtimeApi: RuntimeApiVersion | string;
  };
  mode: ExtensionMode;
  subscriptions: ExtensionSubscription[];
  storage: PluginStorage;
  logger: ExtensionLogger;
  diagnostics: ExtensionDiagnostics;
  safeMode: ExtensionSafeMode;
  secrets: SecretReader;
  configuration: SettingsReader;
  commands: ExtensionCommandRegistry;
  services: ExtensionServiceRegistry;
  views: ExtensionViewRegistry;
  pages: ExtensionPageRegistry;
  overlays: ExtensionOverlayRegistry;
  assets: AssetResolver;
};

export type ExtensionActivate = (context: ExtensionContext) => void | ExtensionSubscription | Promise<void | ExtensionSubscription>;

export type ExtensionDeactivate = () => void | Promise<void>;

export type ExtensionModule = {
  activate?: ExtensionActivate;
  deactivate?: ExtensionDeactivate;
};

export type ExtensionCommand = (...args: unknown[]) => unknown | Promise<unknown>;

export type ExtensionCommandRegistry = {
  registerCommand(command: string, handler: ExtensionCommand): ExtensionSubscription;
  executeCommand<TOutput = unknown>(command: string, ...args: unknown[]): Promise<TOutput>;
};

export type ExtensionServiceMethod = (input: unknown, context: ExtensionContext) => unknown | Promise<unknown>;

export type ExtensionServiceRegistry = {
  registerService(id: string, methods: Record<string, ExtensionServiceMethod>): ExtensionSubscription;
  call<TOutput = unknown>(service: string, method: string, input?: unknown): Promise<TOutput>;
};

export type ExtensionWebviewProviderContext = {
  webview: WebviewEndpoint;
  extension: ExtensionContext;
};

export type ExtensionViewProvider = (context: ExtensionWebviewProviderContext) => void | ExtensionSubscription | Promise<void | ExtensionSubscription>;

export type ExtensionViewRegistry = {
  registerView(id: string, provider: ExtensionViewProvider): ExtensionSubscription;
};

export type ExtensionPageRegistry = {
  registerPage(id: string, provider: ExtensionViewProvider): ExtensionSubscription;
};

export type ExtensionOverlayRegistry = {
  registerOverlay(id: string, provider: ExtensionViewProvider): ExtensionSubscription;
};

export type RuntimeExtensionHost = {
  entry: string;
};

export type RuntimeSidecarKind = "jsonrpc-stdio";

export type RuntimeSidecar = {
  kind: RuntimeSidecarKind;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type RuntimeDeclaration = {
  api: RuntimeApiVersion | string;
  extensionHost: RuntimeExtensionHost;
  sidecars?: Record<string, RuntimeSidecar>;
};

export type ContributionCommand = {
  command: string;
  title: string;
  category?: string;
  icon?: string;
};

export type ContributionService = {
  id: string;
  title?: string;
  methods?: string[];
  sidecar?: string;
  schema?: string;
};

export type ContributionWebview = {
  id: string;
  title: string;
  entry: string;
  icon?: string;
  configuration?: string;
};

export type ContributionPage = ContributionWebview & {
  route?: string;
};

export type ContributionOverlay = ContributionWebview & {
  defaultSize?: [number, number];
};

export type ContributionConfiguration = {
  id: string;
  title?: string;
  schema: string;
};

export type ContributionAsset = {
  id: string;
  path: string;
};

export type ContributionSchema = {
  id: string;
  path: string;
};

export type PluginManifestV3Contributes = {
  commands?: ContributionCommand[];
  services?: ContributionService[];
  views?: ContributionWebview[];
  pages?: ContributionPage[];
  overlays?: ContributionOverlay[];
  configuration?: ContributionConfiguration[];
  assets?: ContributionAsset[];
  schemas?: ContributionSchema[];
};

export type ExtensionCapability =
  | "commands"
  | "services"
  | "views"
  | "pages"
  | "overlays"
  | "configuration"
  | "assets"
  | "schemas"
  | "secrets"
  | "storage"
  | "network"
  | "sidecars";

export type PluginCapabilityDeclaration = Partial<Record<ExtensionCapability, boolean | string[]>>;

export type PluginManifestV3 = {
  schema: "bakingrl.plugin/3";
  id: string;
  name: string;
  version: string;
  publisher?: string;
  author?: string;
  description?: string;
  license?: string;
  runtime: RuntimeDeclaration;
  activationEvents?: ActivationEvent[];
  contributes?: PluginManifestV3Contributes;
  capabilities?: PluginCapabilityDeclaration;
  diagnostics?: {
    enabled?: boolean;
  };
  safeMode?: {
    supported?: boolean;
  };
};

export type WebviewMessage<TType extends string = string, TPayload = unknown> = {
  type: TType;
  payload?: TPayload;
  requestId?: string;
};

export type WebviewRequest<TType extends string = string, TPayload = unknown> = WebviewMessage<TType, TPayload> & {
  requestId: string;
};

export type WebviewResponse<TPayload = unknown> = {
  type: "response";
  requestId: string;
  payload?: TPayload;
  error?: string;
};

export type WebviewEndpoint = {
  postMessage<TType extends string, TPayload>(message: WebviewMessage<TType, TPayload>): void | Promise<void>;
  onMessage<TMessage extends WebviewMessage>(handler: (message: TMessage) => void | Promise<void>): ExtensionSubscription;
};

export type WebviewBridge = {
  post<TType extends string, TPayload = unknown>(type: TType, payload?: TPayload): void | Promise<void>;
  request<TOutput = unknown, TType extends string = string, TPayload = unknown>(
    type: TType,
    payload?: TPayload
  ): Promise<TOutput>;
  on<TMessage extends WebviewMessage>(handler: (message: TMessage) => void | Promise<void>): ExtensionSubscription;
};

export type VisualExport = {
  mount(context: VisualContext): void | CleanupFn | Promise<void | CleanupFn>;
  update?(context: VisualContext): void | Promise<void>;
  unmount?(): void | Promise<void>;
  editor?: {
    mount?(context: VisualContext): void | CleanupFn | Promise<void | CleanupFn>;
    actions?(context: VisualContext): VisualEditorAction[] | Promise<VisualEditorAction[]>;
  };
};

export type VisualEditorAction = {
  id: string;
  label: string;
  disabled?: boolean;
  run(context: VisualContext): void | Promise<void>;
};

export type ComponentExport = {
  mount(
    context: ComponentContext,
    props: Record<string, unknown>
  ): void | CleanupFn | Promise<void | CleanupFn>;
};

export type ServiceExport = {
  mount?(context: ServiceContext): void | Promise<void>;
  unmount?(): void | Promise<void>;
  methods?: Record<string, (input: unknown, context: ServiceContext) => unknown | Promise<unknown>>;
};

export type ConnectorExport = {
  mount?(context: ConnectorContext): void | Promise<void>;
  unmount?(): void | Promise<void>;
};

export type ManifestCompatibility = {
  runtimeApi: string;
  sdk?: string;
};

export type ManifestVisualExport = {
  entry: string;
  defaultSize?: [number, number];
  settings?: string;
};

export type ManifestComponentExport = {
  entry: string;
  props?: string;
};

export type ManifestServiceExport = {
  entry: string;
  methods?: string[];
  schema?: string;
};

export type ManifestConnectorExport = {
  entry: string;
};

export type ManifestTemplateExport = {
  path: string;
  title?: string;
  description?: string;
};

export type ManifestConfigurationExport = {
  path: string;
  title?: string;
  description?: string;
  visuals?: Record<string, ManifestVisualExport>;
};

export type PluginManifest = {
  schema: "bakingrl.plugin/2";
  id: string;
  name: string;
  version: string;
  author?: string;
  compatibility: ManifestCompatibility;
  exports: {
    visuals?: Record<string, ManifestVisualExport>;
    components?: Record<string, ManifestComponentExport>;
    services?: Record<string, ManifestServiceExport>;
    connectors?: Record<string, ManifestConnectorExport>;
    assets?: Record<string, { path: string }>;
    schemas?: Record<string, { path: string }>;
    pages?: Record<string, ManifestTemplateExport>;
    layouts?: Record<string, ManifestTemplateExport>;
    configuration?: ManifestConfigurationExport;
  };
  imports?: {
    components?: string[];
    services?: string[];
  };
  permissions?: {
    bus?: {
      read?: string[];
      publish?: string[];
    };
    registry?: {
      read?: string[];
      write?: string[];
    };
    network?: {
      http?: string[];
      websocket?: string[];
    };
    storage?: string[];
  };
  settings?: string;
};

export type PluginDefinition = {
  id: string;
  name: string;
  version: string;
  visuals?: Record<string, () => Promise<unknown>>;
  components?: Record<string, () => Promise<unknown>>;
  services?: Record<string, () => Promise<unknown>>;
  connectors?: Record<string, () => Promise<unknown>>;
};

export function definePlugin<T extends PluginDefinition>(definition: T): T {
  return definition;
}

export function defineExtension<T extends ExtensionModule>(extension: T): T {
  return extension;
}

export function defineVisual<T extends VisualExport>(visual: T): T {
  return visual;
}

export function defineComponent<T extends ComponentExport>(component: T): T {
  return component;
}

export function defineService<T extends ServiceExport>(service: T): T {
  return service;
}

export function defineConnector<T extends ConnectorExport>(connector: T): T {
  return connector;
}

export function createWebviewBridge(endpoint: WebviewEndpoint): WebviewBridge {
  return {
    post(type, payload) {
      return endpoint.postMessage({ type, payload });
    },
    request(type, payload) {
      const requestId = createRequestId();
      return new Promise((resolve, reject) => {
        const subscription = endpoint.onMessage<WebviewResponse>((message) => {
          if (message.type !== "response" || message.requestId !== requestId) return;
          void Promise.resolve(subscription.dispose()).finally(() => {
            if (message.error) reject(new Error(message.error));
            else resolve(message.payload as never);
          });
        });
        void endpoint.postMessage({ type, payload, requestId });
      });
    },
    on(handler) {
      return endpoint.onMessage(handler);
    }
  };
}

export function currentCompatibility(): ManifestCompatibility {
  return {
    runtimeApi: RUNTIME_API_VERSION,
    sdk: SDK_VERSION
  };
}

export function setting<TValue>(
  settings: Record<string, unknown>,
  key: string,
  fallback: TValue
): TValue {
  const value = settings[key];
  return value === undefined || value === null ? fallback : (value as TValue);
}

export function createCleanup() {
  const callbacks: CleanupFn[] = [];
  return {
    add(cleanup: CleanupFn | void | null | false) {
      if (typeof cleanup === "function") callbacks.push(cleanup);
      return cleanup;
    },
    run() {
      while (callbacks.length) callbacks.pop()?.();
    }
  };
}

export function createMockVisualContext(
  partial: Partial<VisualContext> = {}
): VisualContext {
  const listeners = new Set<(event: BakingRLEvent) => void>();
  return {
    root: document.createElement("div"),
    package: {
      id: "com.example.mock",
      name: "Mock Package",
      enabled: true
    },
    exportName: "mock",
    item: {
      id: "item",
      package_id: "com.example.mock",
      export_name: "mock",
      name: "Mock",
      x: 0,
      y: 0,
      width: 320,
      height: 120,
      z_index: 1,
      visible: true,
      locked: false,
      opacity: 1,
      settings: {}
    },
    settings: {},
    mode: "editor",
    editor: {
      emit(eventName, payload) {
        for (const listener of listeners) listener({ Event: eventName, Data: payload } as BakingRLEvent);
      }
    },
    setActive() {},
    bus: {
      subscribe(_eventName, callback) {
        const listener = callback as (event: BakingRLEvent) => void;
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    },
    registry: {
      async get() {
        return null;
      }
    },
    components: {
      async load() {
        return {
          async mount() {}
        };
      }
    },
    services: {
      async call() {
        return null as never;
      }
    },
    assets: {
      url(ref) {
        return ref;
      }
    },
    diagnostics: consoleDiagnostics(),
    ...partial
  };
}

export function createMockServiceContext(
  partial: Partial<ServiceContext> = {}
): ServiceContext {
  const registryValues: Record<string, unknown> = {};
  return {
    bus: {
      subscribe() {
        return () => {};
      },
      emit() {}
    },
    registry: {
      get(key) {
        return (registryValues[key] ?? null) as never;
      },
      set(key, value) {
        registryValues[key] = value;
      }
    },
    storage: {
      async readText() {
        return "";
      },
      async writeText() {}
    },
    services: {
      async call() {
        return null as never;
      }
    },
    settings: {
      get() {
        return undefined;
      },
      all() {
        return {};
      }
    },
    diagnostics: consoleDiagnostics(),
    ...partial
  };
}

export function createMockConnectorContext(
  partial: Partial<ConnectorContext> = {}
): ConnectorContext {
  return {
    ...createMockServiceContext(partial),
    secrets: {
      get() {
        return undefined;
      },
      configured() {
        return false;
      }
    },
    async fetch() {
      return null;
    },
    websocket: {
      async connect() {
        return null;
      }
    },
    ...partial
  };
}

function consoleDiagnostics(): Diagnostics {
  return {
    log(message, data) {
      console.log(message, data);
    },
    warn(message, data) {
      console.warn(message, data);
    },
    error(message, data) {
      console.error(message, data);
    }
  };
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

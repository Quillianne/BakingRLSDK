import type { RlTelemetryEventName, RlTelemetryPayloadByEvent } from "./telemetry.js";

export const SDK_VERSION = "1.0.1";
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
  services: ServiceCaller;
  assets: AssetResolver;
  diagnostics: Diagnostics;
};

export type VisualEditorContext = {
  emit<TEvent extends string>(eventName: TEvent, payload?: BakingRLEventData<TEvent>): void;
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
  | "onStartup"
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
  trace(message: string, data?: unknown): void | Promise<void>;
  debug(message: string, data?: unknown): void | Promise<void>;
  log(message: string, data?: unknown): void | Promise<void>;
  info(message: string, data?: unknown): void | Promise<void>;
  warn(message: string, data?: unknown): void | Promise<void>;
  error(message: string, data?: unknown): void | Promise<void>;
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
  log(message: string, data?: unknown): void | Promise<void>;
  info(message: string, data?: unknown): void | Promise<void>;
  warn(message: string, data?: unknown): void | Promise<void>;
  error(message: string, data?: unknown): void | Promise<void>;
  report?(diagnostic: ExtensionDiagnostic): void | Promise<void>;
  clear?(code?: string): void | Promise<void>;
};

export type ExtensionSafeMode = {
  enabled: boolean;
  reason?: string;
};

export type ExtensionBus = {
  subscribe<TEvent extends string>(
    eventName: TEvent,
    callback: (event: BakingRLEvent<BakingRLEventData<TEvent>, TEvent>) => void | Promise<void>
  ): CleanupFn;
  emit<TEvent extends string>(eventName: TEvent, payload?: BakingRLEventData<TEvent>): void;
};

export type ExtensionRegistry = {
  get<TValue = unknown>(key: string): Promise<TValue | null>;
  set<TValue = unknown>(key: string, value: TValue): Promise<void>;
  entries<TValue = unknown>(): Promise<Record<string, TValue>>;
};

export type ExtensionSecretReader = {
  get(key: string): Promise<string | undefined>;
  configured(key: string): Promise<boolean>;
};

export type ExtensionSidecarController = {
  declared: string[];
  start(name: string): Promise<unknown>;
  stop(name: string): Promise<unknown>;
  restart(name: string): Promise<unknown>;
  call<TOutput = unknown>(name: string, method: string, params?: unknown): Promise<TOutput>;
};

export type ExtensionTelemetry = {
  event(name: string, properties?: unknown): Promise<unknown>;
};

export type ExtensionWebviewController = {
  declared: Record<string, ContributionWebview>;
  open(id: string, options?: unknown): Promise<unknown>;
  close(id: string): Promise<unknown>;
};

export type ExtensionOverlayController = {
  list<TOutput = unknown>(): Promise<TOutput>;
  refresh(): Promise<unknown>;
};

export type ExtensionContext = {
  id: string;
  packageId: string;
  extensionPath: string;
  storagePath: string;
  settings: SettingsReader & Record<string, unknown>;
  configuration: SettingsReader & Record<string, unknown>;
  extension?: {
    id: string;
    name: string;
    version: string;
    runtimeApi: RuntimeApiVersion | string;
  };
  mode?: ExtensionMode;
  subscriptions: ExtensionSubscription[];
  storage: PluginStorage;
  bus: ExtensionBus;
  registry: ExtensionRegistry;
  logger: ExtensionLogger;
  diagnostics: ExtensionDiagnostics;
  safeMode?: ExtensionSafeMode;
  secrets: ExtensionSecretReader;
  commands: ExtensionCommandRegistry;
  services: ExtensionServiceRegistry;
  views?: ExtensionViewRegistry;
  pages?: ExtensionPageRegistry;
  overlays: ExtensionOverlayController;
  webviews: ExtensionWebviewController;
  sidecars: ExtensionSidecarController;
  telemetry: ExtensionTelemetry;
  assets?: AssetResolver;
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

export type ExtensionServiceMethod = (input: unknown) => unknown | Promise<unknown>;

export type ExtensionServiceRegistry = {
  register(id: string, methods: Record<string, ExtensionServiceMethod>): ExtensionSubscription;
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

export type RuntimeSidecarProtocol = "jsonrpc-stdio";
export type RuntimeSidecarActivation = "manual" | "onActivation" | "onStartup";
export type RuntimeSidecarPlatform = "darwin" | "linux" | "win32";

export type RuntimeSidecar = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  platforms?: RuntimeSidecarPlatform[];
  protocol: RuntimeSidecarProtocol;
  activation: RuntimeSidecarActivation;
};

export type RuntimeDeclaration = {
  extensionHost: RuntimeExtensionHost;
  sidecars: Record<string, RuntimeSidecar>;
};

export type ContributionCommand = {
  title: string;
  category?: string;
  icon?: string;
};

export type ContributionService = {
  title?: string;
  methods?: string[];
  sidecar?: string;
  schema?: string;
};

export type ContributionVisual = {
  title?: string;
  description?: string;
  entry: string;
  defaultSize?: [number, number];
  settings?: string;
};

export type ContributionWebview = {
  title?: string;
  description?: string;
  entry?: string;
  path?: string;
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
  title?: string;
  description?: string;
  schema: string;
};

export type ContributionAsset = {
  path: string;
};

export type ContributionSchema = {
  path: string;
};

export type PluginManifestV3Contributes = {
  commands: Record<string, ContributionCommand>;
  services: Record<string, ContributionService>;
  visuals: Record<string, ContributionVisual>;
  views: Record<string, ContributionWebview>;
  pages: Record<string, ContributionPage>;
  overlays: Record<string, ContributionOverlay>;
  webviews: Record<string, ContributionWebview>;
  configuration: Record<string, ContributionConfiguration>;
  assets: Record<string, ContributionAsset>;
  schemas: Record<string, ContributionSchema>;
};

export type ExtensionCapability =
  | "commands"
  | "services"
  | "visuals"
  | "views"
  | "pages"
  | "overlays"
  | "webviews"
  | "configuration"
  | "assets"
  | "schemas"
  | "secrets"
  | "storage"
  | "network"
  | "sidecars";

export type PluginCapabilityDeclaration = Partial<Record<ExtensionCapability, boolean | string[]>>;

export type ManifestPermissionDeclaration = {
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

export type PluginManifestV3Capabilities = PluginCapabilityDeclaration & {
  permissions: ManifestPermissionDeclaration;
};

export type PluginManifestV3Activation = {
  events: ActivationEvent[];
};

export type PluginManifestV3 = {
  schema: "bakingrl.plugin/3";
  kind: "trusted";
  id: string;
  name: string;
  version: string;
  publisher?: string;
  author?: string;
  description?: string;
  license?: string;
  compatibility: ManifestCompatibility;
  activation: PluginManifestV3Activation;
  runtime: RuntimeDeclaration;
  contributes: PluginManifestV3Contributes;
  capabilities: PluginManifestV3Capabilities;
  settings?: string;
  diagnostics?: {
    enabled?: boolean;
    channel?: string;
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

export type ManifestCompatibility = {
  runtimeApi: string;
  sdk?: string;
};

export type ManifestVisualExport = {
  entry: string;
  defaultSize?: [number, number];
  settings?: string;
};

export type PluginDefinition = {
  id: string;
  name: string;
  version: string;
  visuals?: Record<string, () => Promise<unknown>>;
};

export function defineExtension<T extends ExtensionModule>(extension: T): T {
  return extension;
}

export function defineVisual<T extends VisualExport>(visual: T): T {
  return visual;
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

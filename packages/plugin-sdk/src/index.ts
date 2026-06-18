import type { RlTelemetryEventName, RlTelemetryPayloadByEvent } from "./telemetry.js";

export const SDK_VERSION = "2.2.0";
export const RUNTIME_API_VERSION = "2.2.0";

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

export type TelemetryHub = {
  subscribe<TEvent extends string>(
    eventName: TEvent,
    callback: (event: BakingRLEvent<BakingRLEventData<TEvent>, TEvent>) => void | Promise<void>
  ): CleanupFn;
  publish<TEvent extends string>(
    eventName: TEvent,
    payload?: BakingRLEventData<TEvent>
  ): void | Promise<unknown>;
  snapshot<TEvent extends string = string>():
    | BakingRLEvent<BakingRLEventData<TEvent>, TEvent>
    | null
    | Promise<BakingRLEvent<BakingRLEventData<TEvent>, TEvent> | null>;
  getSnapshot<TEvent extends string = string>():
    | BakingRLEvent<BakingRLEventData<TEvent>, TEvent>
    | null
    | Promise<BakingRLEvent<BakingRLEventData<TEvent>, TEvent> | null>;
};

export function isBakingRLEvent<TEvent extends string = string>(
  value: unknown,
  eventName?: TEvent
): value is BakingRLEvent<BakingRLEventData<TEvent>, TEvent> {
  if (!value || typeof value !== "object") return false;
  const frame = value as { Event?: unknown; Data?: unknown };
  if (typeof frame.Event !== "string") return false;
  if (eventName !== undefined && frame.Event !== eventName) return false;
  return "Data" in frame;
}

export type StateHub = {
  read<TValue = unknown>(key: string): Promise<TValue | null>;
  write<TValue = unknown>(key: string, value: TValue): Promise<unknown>;
  snapshot<TValue extends Record<string, unknown> = Record<string, unknown>>(): TValue | Promise<TValue>;
  getSnapshot<TValue extends Record<string, unknown> = Record<string, unknown>>(): TValue | Promise<TValue>;
};

export type ContextState = {
  get<TValue = unknown>(key: string): Promise<TValue | null>;
  set<TValue = unknown>(key: string, value: TValue): Promise<void>;
};

export type ConfigurationSecretState = {
  key: string;
  label: string;
  description?: string | null;
  required: boolean;
  configured: boolean;
};

export type ConfigurationState = {
  packageId: string;
  title: string;
  hasCustomPage: boolean;
  schema: unknown;
  values: Record<string, unknown>;
  secrets: ConfigurationSecretState[];
  secretStoreAvailable: boolean;
  secretStoreError?: string | null;
};

export type ConfigurationSettingsContext = {
  get(): Promise<Record<string, unknown>>;
  update(values: Record<string, unknown>): Promise<Record<string, unknown>>;
  save(values: Record<string, unknown>): Promise<Record<string, unknown>>;
  reset(): Promise<Record<string, unknown>>;
  subscribe(callback: (settings: Record<string, unknown>) => void | Promise<void>): CleanupFn;
};

export type ConfigurationSecretsContext = {
  configured(key: string): Promise<boolean>;
  set(key: string, value: string): Promise<ConfigurationState>;
  clear(key: string): Promise<ConfigurationState>;
};

export type ConfigurationContext = {
  packageId: string;
  settings: ConfigurationSettingsContext;
  secrets: ConfigurationSecretsContext;
};

export type RuntimeBus = {
  subscribe<TEvent extends string>(
    eventName: TEvent,
    callback: (event: BakingRLEvent<BakingRLEventData<TEvent>, TEvent>) => void
  ): CleanupFn;
};

export type BackendBus = RuntimeBus & {
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

export type ExtensionMode = "development" | "production" | "test";

export type ExtensionKind = "extensionHost";

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

export type WebviewSettingsController = {
  get(): Promise<Record<string, unknown>>;
  save(values: Record<string, unknown>): Promise<Record<string, unknown>>;
  subscribe(callback: (settings: Record<string, unknown>) => void | Promise<void>): CleanupFn;
};

export type WebviewContext = {
  root: HTMLElement;
  packageId: string;
  webviewId: string;
  settings: WebviewSettingsController;
  configuration?: ConfigurationContext;
  telemetryHub: TelemetryHub;
  dimensions: {
    width: number;
    height: number;
  };
  mode: "runtime";
};

export type PluginDescriptor = {
  id: string;
  name: string;
  version: string;
  author?: string | null;
  bakingrlApi: BakingRLCompatibleApiVersion | null;
  enabled: boolean;
  active: boolean;
  dependencies: PluginDependency[];
};

export type ExtensionPluginController = {
  list(): Promise<PluginDescriptor[]>;
};

export type ExtensionPointDescriptor = ContributionExtensionPoint & {
  packageId: string;
  reference: ExtensionPointTarget;
};

export type ExtensionContributionDescriptor = ContributionContribution & {
  packageId: string;
  reference: string;
};

export type ExtensionPointFilter = {
  packageId?: string;
};

export type ExtensionContributionFilter = {
  target?: ExtensionPointTarget;
};

export type ExtensionContributionController = {
  points(filter?: ExtensionPointFilter): Promise<ExtensionPointDescriptor[]>;
  contributions(target?: ExtensionPointTarget | ExtensionContributionFilter): Promise<ExtensionContributionDescriptor[]>;
};

export type ResourceDescriptor = ContributionResource & {
  packageId: string;
  reference: string;
  public: boolean;
};

export type ResourceFilter = {
  packageId?: string;
  type?: string;
  visibility?: ResourceVisibility;
};

export type ExtensionResourceController = {
  list(filter?: ResourceFilter): Promise<ResourceDescriptor[]>;
  read(ref: string, path?: string): Promise<Uint8Array>;
  readText(ref: string, path?: string): Promise<string>;
  readJson<TValue = unknown>(ref: string, path?: string): Promise<TValue>;
};

export type ExtensionContext = {
  id: string;
  packageId: string;
  extensionPath: string;
  storagePath: string;
  settings: SettingsReader & Record<string, unknown>;
  state: ContextState;
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
  telemetryHub: TelemetryHub;
  stateHub: StateHub;
  registry: ExtensionRegistry;
  logger: ExtensionLogger;
  diagnostics: ExtensionDiagnostics;
  safeMode?: ExtensionSafeMode;
  secrets: ExtensionSecretReader;
  commands: ExtensionCommandRegistry;
  services: ExtensionServiceRegistry;
  webviews: ExtensionWebviewController;
  plugins: ExtensionPluginController;
  extensions: ExtensionContributionController;
  resources: ExtensionResourceController;
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

export type RuntimeSidecarProtocol = "jsonrpc-stdio";
export type RuntimeSidecarActivation = "manual" | "onEnable" | "onStartup";
export type RuntimeSidecarPlatform =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64"
  | "windows-x64"
  | (string & {});

export type RuntimeNodeDeclaration = {
  entry: string;
};

export type RuntimeSidecar = {
  id: string;
  bin: string;
  args?: string[];
  env?: Record<string, string>;
  platforms?: RuntimeSidecarPlatform[];
  protocol: RuntimeSidecarProtocol;
  activation?: RuntimeSidecarActivation;
  healthCheck?: RuntimeSidecarHealthCheck;
};

export type RuntimeSidecarHealthCheck = {
  method: string;
  intervalMs?: number;
  timeoutMs?: number;
};

export type RuntimeDeclaration = {
  node?: RuntimeNodeDeclaration;
  sidecars?: RuntimeSidecar[];
};

export type RuntimeRef = "node" | `sidecar:${string}`;
export type BakingRLCompatibleApiVersion = `2.2.${number}`;
export type ExtensionPointTarget = `${string}/${string}`;
export type ResourceVisibility = "public" | "private";

export type PluginDependency = {
  packageId: string;
  version?: string;
  optional?: boolean;
};

export type ContributionCommand = {
  id: string;
  title?: string;
  category?: string;
  icon?: string;
};

export type ContributionService = {
  id: string;
  runtime?: RuntimeRef;
  methods?: string[];
  schema?: string;
};

export type ContributionAsset = {
  path: string;
};

export type ContributionSchema = {
  path: string;
};

export type ContributionSettings = {
  schema?: string;
  ui?: string;
};

export type ContributionExtensionPoint = {
  id: string;
  version?: string;
  title?: string;
  description?: string;
  schema?: string;
  service?: string;
};

export type ContributionContribution = {
  id: string;
  target: ExtensionPointTarget;
  kind?: string;
  title?: string;
  description?: string;
  dataSchema?: string;
  service?: string;
  resources?: string[];
  metadata?: Record<string, unknown>;
};

export type ContributionResource = {
  id: string;
  path?: string;
  paths?: string[];
  type?: string;
  visibility?: ResourceVisibility;
  metadata?: Record<string, unknown>;
};

export type ContributionWebview = {
  id: string;
  entry: string;
  title?: string;
  kind?: "tool" | "settings" | "panel";
  defaultSize?: [number, number];
};

export type PluginManifestV4Contributes = {
  settings?: ContributionSettings;
  services?: ContributionService[];
  commands?: ContributionCommand[];
  extensionPoints?: ContributionExtensionPoint[];
  contributions?: ContributionContribution[];
  resources?: ContributionResource[];
  webviews?: ContributionWebview[];
};

export type PluginManifestV4 = {
  schemaVersion: "bakingrl.plugin/4";
  id: string;
  name: string;
  version: string;
  bakingrlApi: BakingRLCompatibleApiVersion;
  dependencies?: PluginDependency[];
  runtime?: RuntimeDeclaration;
  contributes?: PluginManifestV4Contributes;
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

export type WebviewExport = {
  mount(context: WebviewContext): void | CleanupFn | Promise<void | CleanupFn>;
};

export type PluginDefinition = {
  id: string;
  name: string;
  version: string;
};

export function defineExtension<T extends ExtensionModule>(extension: T): T {
  return extension;
}

export function defineWebview<T extends WebviewExport>(webview: T): T {
  return webview;
}

export function createExtensionTarget(packageId: string, extensionPointId: string): ExtensionPointTarget {
  return `${packageId}/${extensionPointId}` as ExtensionPointTarget;
}

export function parseExtensionTarget(target: string): { packageId: string; extensionPointId: string } | null {
  const slashIndex = target.indexOf("/");
  if (slashIndex <= 0 || slashIndex !== target.lastIndexOf("/") || slashIndex === target.length - 1) {
    return null;
  }
  return {
    packageId: target.slice(0, slashIndex),
    extensionPointId: target.slice(slashIndex + 1)
  };
}

export function createResourceRef(packageId: string, resourceId: string): string {
  return `${packageId}/${resourceId}`;
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

function createRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

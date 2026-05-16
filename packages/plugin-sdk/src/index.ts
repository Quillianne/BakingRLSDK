import type { RlTelemetryEventName, RlTelemetryPayloadByEvent } from "./telemetry.js";

export const SDK_VERSION = "0.4.0";
export const RUNTIME_API_VERSION = "0.4.0";
export const SUPPORTED_RUNTIME_API_RANGE = ">=0.4.0 <0.5.0";

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

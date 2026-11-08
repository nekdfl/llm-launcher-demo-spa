// Перехват сетевых вызовов SPA: `fetch` к `/auth`, `/accounts`,
// `/orchestrator` и `EventSource` потока логов обслуживаются в браузере.
// Всё прочее (шрифты и т. п.) уходит в настоящий fetch.

export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  form: FormData | null;
}

export class HttpError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

/** Ошибка в форме оркестратора: `{"detail": ...}`. */
export const fail = (status: number, detail: unknown): never => {
  throw new HttpError(status, detail);
};

type Params = Record<string, string>;
type Handler = (req: MockRequest, params: Params) => unknown | Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" +
      path.replace(/:([a-z_]+)/g, (_, key: string) => {
        keys.push(key);
        return "([^/]+)";
      }) +
      "/?$"
  );
  routes.push({ method, pattern, keys, handler });
}

/** Тело ответа, которое не JSON: текст лога, WAV синтеза, 204. */
export class RawResponse {
  constructor(
    readonly body: BodyInit | null,
    readonly status = 200,
    readonly contentType = "text/plain; charset=utf-8"
  ) {}
}

export const noContent = () => new RawResponse(null, 204);

const MOCK_PREFIXES = ["/auth/", "/accounts/", "/orchestrator/"];

function latency(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 230));
}

async function dispatch(method: string, rawPath: string, init: RequestInit | undefined): Promise<Response> {
  const url = new URL(rawPath, "http://mock");
  let body: unknown = null;
  let form: FormData | null = null;
  if (init?.body instanceof FormData) form = init.body;
  else if (typeof init?.body === "string" && init.body) body = JSON.parse(init.body);

  const path = url.pathname.replace(/^\/orchestrator\/api/, "");
  const match = routes
    .filter((r) => r.method === method)
    .map((r) => ({ r, m: r.pattern.exec(path) }))
    .find((x) => x.m);

  await latency();

  if (!match) {
    console.error(`[reference-mock] нет обработчика: ${method} ${rawPath}`);
    return jsonResponse({ detail: `reference-mock: нет обработчика ${method} ${url.pathname}` }, 501);
  }

  const params: Params = {};
  match.r.keys.forEach((key, i) => (params[key] = decodeURIComponent(match.m![i + 1])));

  try {
    const result = await match.r.handler({ method, path, query: url.searchParams, body, form }, params);
    if (result instanceof RawResponse) {
      return new Response(result.body, {
        status: result.status,
        headers: result.body === null ? {} : { "Content-Type": result.contentType },
      });
    }
    return result === undefined ? new Response(null, { status: 204 }) : jsonResponse(result, 200);
  } catch (error) {
    if (error instanceof HttpError) return jsonResponse({ detail: error.detail }, error.status);
    console.error("[reference-mock] сбой обработчика", method, rawPath, error);
    return jsonResponse({ detail: String(error) }, 500);
  }
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(data === undefined ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// --- поток логов ---------------------------------------------------------

type LogListener = (line: string) => void;
const logListeners = new Map<string, Set<LogListener>>();

export function publishLogLine(inferenceId: string, line: string): void {
  logListeners.get(inferenceId)?.forEach((listener) => listener(line));
}

let initialLogLines: (inferenceId: string) => string[] = () => [];

export function setInitialLogLines(provider: (inferenceId: string) => string[]): void {
  initialLogLines = provider;
}

/** EventSource потока логов: сначала хвост журнала, затем новые строки. */
class MockEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly url: string;
  readyState = 0;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private inferenceId: string;
  private listener: LogListener;

  constructor(url: string) {
    super();
    this.url = url;
    this.inferenceId = /\/inferences\/([^/]+)\/logs\/stream/.exec(url)?.[1] ?? "";
    this.listener = (line) => this.emit(line);
    setTimeout(() => {
      if (this.readyState === 2) return;
      this.readyState = 1;
      this.onopen?.(new Event("open"));
      initialLogLines(this.inferenceId).forEach((line) => this.emit(line));
      if (!logListeners.has(this.inferenceId)) logListeners.set(this.inferenceId, new Set());
      logListeners.get(this.inferenceId)!.add(this.listener);
    }, 200);
  }

  private emit(line: string): void {
    const event = new MessageEvent("message", { data: line });
    this.onmessage?.(event);
    this.dispatchEvent(event);
  }

  close(): void {
    this.readyState = 2;
    logListeners.get(this.inferenceId)?.delete(this.listener);
  }
}

export function installMockServer(): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (MOCK_PREFIXES.some((prefix) => raw.startsWith(prefix))) {
      return dispatch((init?.method ?? "GET").toUpperCase(), raw, init);
    }
    return realFetch(input, init);
  };
  window.EventSource = MockEventSource as unknown as typeof EventSource;
}

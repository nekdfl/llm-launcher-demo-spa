// Обработчики HTTP-контракта, который использует SPA (`src/api/*.ts`).
// Сообщения об ошибках повторяют тексты оркестратора.
import type {
  DownloadStats,
  EngineExtension,
  Inference,
  InferenceRun,
  ModelDetailResponse,
  ModelEntity,
  ModelSearchResult,
  Profile,
  RepoSyncState,
  SystemUser,
} from "../src/api/types";
import { fail, noContent, RawResponse, route, setInitialLogLines, type MockRequest } from "./server";
import { db, GiB, index, isoNow, nextId, uuid, type DownloadState } from "./state";
import {
  currentThroughput,
  gpuStatus,
  hostLoadNow,
  historySeries,
  logLine,
  startProcess,
  stopProcess,
  wavTone,
} from "./clock";

const body = <T>(req: MockRequest) => (req.body ?? {}) as T;
const num = (value: string) => Number(value);

function notFound(what: string): never {
  return fail(404, `${what} не найден`);
}

function mustInference(id: string): Inference {
  return index.inference(id) ?? notFound(`inference ${id}`);
}
function mustModel(id: number): ModelEntity {
  return index.model(id) ?? fail(404, `модель ${id} не найдена`);
}
function mustProfile(id: number): Profile {
  return index.profile(id) ?? notFound(`профиль ${id}`);
}

const withValidity = <T extends { model_id: number }>(item: T) => ({
  ...item,
  model_validity: index.model(item.model_id)?.validity ?? { usable: false, reason: "модель не найдена" },
});

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function freePort(): number {
  const { port_range_start, port_range_end } = db.settings.resources;
  const used = new Set(db.inferences.map((i) => i.port));
  for (let port = port_range_start; port <= port_range_end; port += 1) if (!used.has(port)) return port;
  return fail(409, `нет свободных портов в диапазоне ${port_range_start}-${port_range_end}`);
}

// --- auth & accounts -----------------------------------------------------

route("POST", "/auth/token", (req) => {
  const { username, password } = body<{ username?: string; password?: string }>(req);
  if (!username || !password) fail(401, "No active account found with the given credentials");
  return { access: `mock-access.${username}`, refresh: `mock-refresh.${username}` };
});
route("POST", "/auth/token/refresh", () => ({ access: `mock-access.${Date.now()}` }));

route("GET", "/accounts/users", () => db.users);
route("POST", "/accounts/users", (req) => {
  const { username, role } = body<{ username: string; password: string; role: SystemUser["role"] }>(req);
  if (db.users.some((u) => u.username === username)) fail(400, { username: ["A user with that username already exists."] });
  const user: SystemUser = { id: nextId(db.users), username, role, is_active: true };
  db.users.push(user);
  return user;
});
route("PATCH", "/accounts/users/:id", (req, p) => {
  const user = db.users.find((u) => u.id === num(p.id)) ?? notFound("пользователь");
  const { role, is_active } = body<Partial<SystemUser>>(req);
  if (role !== undefined) user.role = role;
  if (is_active !== undefined) user.is_active = is_active;
  return user;
});
route("DELETE", "/accounts/users/:id", (_, p) => {
  db.users.splice(db.users.findIndex((u) => u.id === num(p.id)), 1);
  return undefined;
});

// --- inferences ----------------------------------------------------------

route("GET", "/inferences", () => db.inferences.map(withValidity));
route("GET", "/inferences/:id", (_, p) => withValidity(mustInference(p.id)));
route("POST", "/inferences", (req) => {
  const input = body<Partial<Inference> & { name: string; profile_id: number }>(req);
  const profile = mustProfile(input.profile_id);
  const slug = slugify(input.name);
  if (db.inferences.some((i) => i.slug === slug)) fail(409, `inference со slug '${slug}' уже существует`);
  if (input.port && db.inferences.some((i) => i.port === input.port))
    fail(409, `порт ${input.port} уже занят другим inference (уникален независимо от состояния)`);
  const inference: Inference = {
    id: uuid(),
    slug,
    name: input.name,
    profile_id: profile.id,
    model_id: input.model_id ?? profile.model_id,
    engine_installation_id: input.engine_installation_id ?? 0,
    gpu_ids: input.gpu_ids?.length ? input.gpu_ids : [...profile.gpu_ids],
    port: input.port ?? profile.port ?? freePort(),
    structural_fields: input.structural_fields ?? { ...profile.structural_fields },
    cli_options: input.cli_options ?? profile.cli_options,
    system_prompt: input.system_prompt ?? profile.system_prompt,
    autostart: input.autostart ?? false,
    reasoning: input.reasoning ?? profile.reasoning,
    input_modalities: input.input_modalities ?? profile.input_modalities,
    trace: input.trace ?? false,
    extensions: profile.extensions ?? {},
    last_started_at: null,
    last_run_peak_vram_bytes: null,
    last_run_peak_ram_bytes: null,
  };
  db.inferences.push(inference);
  db.processes.set(inference.id, {
    status: "stopped", readyAt: null, stoppingUntil: null, pid: 0,
    gpuIds: [...inference.gpu_ids], tokensIn: 0, tokensOut: 0, busyUntil: 0,
  });
  const plugin = index.plugin(index.engine(inference.engine_installation_id)?.plugin_id ?? 0);
  db.routerModels[inference.id] = {
    id: inference.id,
    slug,
    task: plugin?.tasks[0] ?? "text-generation",
    input_modalities: inference.input_modalities,
    output_modalities: plugin?.tasks[0] === "text-to-speech" ? ["speech"] : ["text"],
  };
  db.runs[inference.id] = [];
  db.logs[inference.id] = [];
  return withValidity(inference);
});
route("PATCH", "/inferences/:id", (req, p) => {
  const inference = mustInference(p.id);
  const patch = body<Partial<Inference>>(req);
  if (patch.slug && db.inferences.some((i) => i !== inference && i.slug === patch.slug))
    fail(409, `inference со slug '${patch.slug}' уже существует`);
  if (patch.port && db.inferences.some((i) => i !== inference && i.port === patch.port))
    fail(409, `порт ${patch.port} уже занят другим inference`);
  Object.assign(inference, patch);
  return withValidity(inference);
});
route("DELETE", "/inferences/:id", (_, p) => {
  const inference = mustInference(p.id);
  if (db.processes.get(inference.id)?.status !== "stopped" && db.processes.get(inference.id)?.status !== "failed")
    fail(409, `inference ${inference.id} запущен — сначала остановите его`);
  db.inferences.splice(db.inferences.indexOf(inference), 1);
  db.processes.delete(inference.id);
  return undefined;
});

route("POST", "/inferences/stop-all", () => ({
  units: db.inferences
    .filter((i) => ["running", "warming", "unresponsive"].includes(db.processes.get(i.id)!.status))
    .map((i) => {
      stopProcess(i);
      return { unit: `llm-${i.id}.service`, inference_id: i.id, outcome: "stopped", detail: null };
    }),
}));
route("POST", "/inferences/:id/start", (req, p) => {
  const inference = mustInference(p.id);
  const override = (req.body as { gpu_ids?: number[] } | null)?.gpu_ids;
  return startProcess(inference, override);
});
route("POST", "/inferences/:id/stop", (_, p) => {
  stopProcess(mustInference(p.id));
  return { status: "stopping" };
});
route("GET", "/inferences/:id/status", (_, p) => {
  const status = db.processes.get(mustInference(p.id).id)!.status;
  const color = { stopped: "gray", warming: "yellow", running: "green", unresponsive: "red", failed: "red" }[status];
  return { status, color, gpu_considered_free: status === "stopped" || status === "failed" };
});
route("GET", "/inferences/:id/stop-progress", (_, p) => {
  const proc = db.processes.get(mustInference(p.id).id)!;
  return { progress: proc.stoppingUntil !== null ? "in_progress" : "stopped" };
});
route("GET", "/inferences/:id/logs", (req, p) => {
  const lines = num(req.query.get("lines") ?? "200");
  return { lines: (db.logs[mustInference(p.id).id] ?? []).slice(-lines) };
});
setInitialLogLines((id) => (db.logs[id] ?? []).slice(-100));

route("POST", "/inferences/:id/audio/speech", (req, p) => {
  const inference = mustInference(p.id);
  if (db.processes.get(inference.id)!.status !== "running") fail(502, "процесс inference не отвечает: Connection refused");
  const { input } = body<{ input: string }>(req);
  logLine(inference, `POST /v1/audio/speech 200 — ${input.length} символов`);
  return new RawResponse(wavTone(Math.min(6, 0.6 + input.length / 25)), 200, "audio/wav");
});
route("POST", "/inferences/:id/audio/transcriptions", (req, p) => {
  const inference = mustInference(p.id);
  if (db.processes.get(inference.id)!.status !== "running") fail(502, "процесс inference не отвечает: Connection refused");
  const file = req.form?.get("file");
  const seconds = file instanceof File ? Math.max(1, Math.round(file.size / 32000)) : 3;
  logLine(inference, `POST /v1/audio/transcriptions 200 — ${seconds} с аудио`);
  return { text: "Проверка распознавания речи: это демонстрационная расшифровка загруженного файла.", usage: { seconds } };
});

route("GET", "/router-models/:id", (_, p) => db.routerModels[mustInference(p.id).id] ?? notFound("модель роутера"));

// --- history -------------------------------------------------------------

route("GET", "/history/runs", (req) => {
  const inferenceId = req.query.get("inference_id");
  const profileId = req.query.get("profile_id");
  const all = Object.values(db.runs).flat();
  const runs = inferenceId ? db.runs[inferenceId] ?? [] : all.filter((r) => r.profile_id === num(profileId ?? "0"));
  return [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at));
});
function mustRun(id: number): InferenceRun {
  return Object.values(db.runs).flat().find((r) => r.id === id) ?? fail(404, `запуск ${id} не найден`);
}
route("GET", "/history/runs/:id/log", (req, p) => {
  const run = mustRun(num(p.id));
  const lines = num(req.query.get("lines") ?? "200");
  const log = (db.logs[run.inference_id] ?? []).slice(-lines);
  return new RawResponse([`# журнал запуска #${run.id} (${run.started_at})`, ...log].join("\n"));
});
route("GET", "/history/runs/:id/trace", (_, p) => {
  const run = mustRun(num(p.id));
  const inference = index.inference(run.inference_id);
  if (!inference?.trace) return [];
  return [
    {
      at: run.started_at,
      request: { model: inference.slug, messages: [{ role: "user", content: "Кратко: что такое KV-кэш?" }], stream: false },
      response: { choices: [{ message: { role: "assistant", content: "Кэш ключей и значений внимания для уже обработанных токенов." } }], usage: { prompt_tokens: 18, completion_tokens: 14 } },
    },
  ];
});
route("GET", "/history/settings", () => db.settings.history);
route("PATCH", "/history/settings", (req) => Object.assign(db.settings.history, body(req)));

// --- models --------------------------------------------------------------

const referencesOf = (modelId: number) => [
  ...db.profiles.filter((p) => p.model_id === modelId).map((p) => ({ table: "profiles", id: p.id })),
  ...db.inferences.filter((i) => i.model_id === modelId).map((i) => ({ table: "inferences", id: i.id })),
];
const rejectReferenced = (modelId: number) => {
  const references = referencesOf(modelId);
  if (references.length) fail(409, { message: "нельзя удалить модель: есть ссылающиеся записи", references });
};

route("GET", "/models", () => db.models);
route("GET", "/models/:id", (_, p) => mustModel(num(p.id)));
route("PUT", "/models/:id/favorite", (req, p) => Object.assign(mustModel(num(p.id)), { favorite: body<{ favorite: boolean }>(req).favorite }));
route("PUT", "/models/:id/file-path", (req, p) => {
  const model = mustModel(num(p.id));
  const { file_path } = body<{ file_path: string }>(req);
  if (!file_path.startsWith("/")) fail(400, `файл '${file_path}' не найден`);
  if (db.models.some((m) => m !== model && m.file_path === file_path)) fail(409, `путь '${file_path}' уже занят другой моделью`);
  return Object.assign(model, { file_path, validity: { usable: true, reason: null } });
});
route("GET", "/models/:id/deletion-preview", (_, p) => {
  const model = mustModel(num(p.id));
  rejectReferenced(model.id);
  return { model_id: model.id, file_path: model.file_path, size_bytes: detailFor(model.ref).local_bytes };
});
route("DELETE", "/models/:id", (_, p) => {
  const model = mustModel(num(p.id));
  rejectReferenced(model.id);
  db.models.splice(db.models.indexOf(model), 1);
  const detail = db.modelDetails[model.ref];
  if (detail) {
    detail.files.forEach((f) => Object.assign(f, { downloaded: false, local_size: null }));
    detail.variants.forEach((v) => Object.assign(v, { downloaded: false, local_size: null }));
    detail.local_bytes = 0;
  }
  return undefined;
});
route("DELETE", "/models/:id/record", (_, p) => {
  const model = mustModel(num(p.id));
  rejectReferenced(model.id);
  db.models.splice(db.models.indexOf(model), 1);
  return undefined;
});
route("GET", "/models/:id/assistant-suggestions", (_, p) => {
  mustModel(num(p.id));
  const { assistant } = db.settings;
  if (!assistant.configured)
    return { available: false, reason: "помощник не настроен: не указаны модель или API-ключ", suggestions: [], warnings: [] };
  return {
    available: true,
    reason: null,
    suggestions: [
      { field: "cli_options", value: "--max-model-len 65536", reason: "карточка рекомендует контекст 64K для баланса скорости и памяти", quote: "We recommend a context length of 65,536 tokens" },
      { field: "reasoning", value: "true", reason: "модель поддерживает режим рассуждений", quote: "supports thinking mode" },
    ],
    warnings: [],
  };
});

route("GET", "/profile-formula", (req) => {
  const modelId = req.query.get("model_id") ?? "";
  const formula = db.formulas[modelId];
  if (formula) return formula;
  const model = mustModel(num(modelId));
  const weight = detailFor(model.ref).local_bytes || 8 * GiB;
  return {
    cli_options: "--ctx-size 32768 -ngl 99",
    model_weight_bytes: weight,
    kv_cache_bytes: Math.round(weight * 0.35),
    recommended_context_length: 32768,
    n_gpu_layers: "99",
    gpu_memory_utilization: 0.9,
    warnings: [],
  };
});

// Карточка репозитория: снимок стенда для скачанных моделей, для прочих
// результатов поиска — синтез по тегам (GGUF-кванты или safetensors-шарды).
function synthesizeDetail(ref: string): ModelDetailResponse {
  const result = allSearchResults().find((r) => r.id === ref);
  const tags = result?.tags ?? [];
  const gguf = tags.includes("gguf") || /gguf/i.test(ref);
  const base = 2 + (hash(ref) % 30);
  // Репозиторий, который уже скачивается, показывает файлы своей закачки.
  const queued = db.downloads.find((d) => d.model_ref === ref);
  const files = queued
    ? queued.files
    : gguf
    ? [
        { filename: "README.md", size: 14_210 },
        ...[["Q4_K_M", 0.6], ["Q5_K_M", 0.72], ["Q8_0", 1.06]].map(([q, k]) => ({
          filename: `${ref.split("/")[1].replace(/-GGUF$/i, "")}-${q}.gguf`,
          size: Math.round(base * (k as number) * GiB),
        })),
      ]
    : [
        { filename: "README.md", size: 9_860 },
        { filename: "config.json", size: 1_512 },
        { filename: "tokenizer.json", size: 11_422_654 },
        ...[1, 2, 3].map((n) => ({ filename: `model-0000${n}-of-00003.safetensors`, size: Math.round((base / 3) * GiB) })),
      ];
  const free = freeBytes();
  const downloadedFiles = new Set(
    db.downloads.filter((d) => d.model_ref === ref && d.status === "completed").flatMap((d) => d.file_names ?? [])
  );
  const fileDetails = files.map((f) => ({
    ...f,
    downloaded: downloadedFiles.has(f.filename),
    local_size: downloadedFiles.has(f.filename) ? f.size : null,
    disk_sufficient: f.size < free,
  }));
  const format = gguf ? "gguf" : "safetensors";
  const total = files.reduce((s, f) => s + f.size, 0);
  return {
    description: `# ${ref}\n\nДемонстрационная карточка: описание модели из репозитория провайдера.\n\n- Задача: ${result?.pipeline_tag ?? "—"}\n- Библиотека: ${result?.library_name ?? "—"}`,
    source_url: `https://huggingface.co/${ref}`,
    total_bytes: total,
    total_disk_sufficient: total < free,
    variants: gguf
      ? fileDetails.filter((f) => f.filename.endsWith(".gguf")).map((f) => ({
          filename: f.filename,
          quant_label: /-(Q\d[^.]*)\.gguf$/.exec(f.filename)?.[1] ?? "",
          size: f.size,
          downloaded: f.downloaded,
          local_size: f.local_size,
          disk_sufficient: f.disk_sufficient,
          estimated_vram_bytes: Math.round(f.size * 1.18),
        }))
      : [],
    features: [],
    files: fileDetails,
    local_bytes: fileDetails.reduce((s, f) => s + (f.local_size ?? 0), 0),
    repo_format: format,
    supporting_engines: db.engines
      .filter((e) => e.available && index.plugin(e.plugin_id)?.model_formats?.includes(format))
      .map((e) => ({ id: e.id, name: e.name })),
  };
}

function detailFor(ref: string): ModelDetailResponse {
  return (db.modelDetails[ref] ??= synthesizeDetail(ref));
}

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function allSearchResults(): ModelSearchResult[] {
  const seen = new Map<string, ModelSearchResult>();
  Object.values(db.searches).flat().forEach((r) => seen.set(r.id, r));
  return [...seen.values()];
}

route("GET", "/providers/:id/search", (req) => {
  const query = (req.query.get("query") ?? "").trim().toLowerCase();
  const tags = (req.query.get("tags") ?? "").split(",").filter(Boolean);
  const sort = req.query.get("sort") ?? "downloads";
  const results = (db.searches[query] ?? allSearchResults().filter((r) => r.id.toLowerCase().includes(query)))
    .filter((r) => tags.every((t) => r.tags.includes(t) || r.pipeline_tag === t || r.library_name === t));
  const key = sort === "likes" ? "likes" : sort === "downloads" ? "downloads" : null;
  return key ? [...results].sort((a, b) => b[key] - a[key]) : results;
});
route("GET", "/providers/:id/variants", (req) => detailFor(req.query.get("repo_id") ?? "").files.map(({ filename, size }) => ({ filename, size })));
route("GET", "/providers/:id/model-detail", (req) => detailFor(req.query.get("repo_id") ?? ""));
route("POST", "/providers/:id/model-detail/refresh", (req) => {
  const { repo_id, filename } = body<{ repo_id: string; filename: string }>(req);
  const file = detailFor(repo_id).files.find((f) => f.filename === filename) ?? fail(404, `файл '${filename}' не найден в репозитории`);
  return { started: true, download: enqueue(repo_id, [file], "update") };
});
route("GET", "/providers/:id/repo-sync", (req) => {
  const ref = req.query.get("repo_id") ?? "";
  return db.repoSyncs[ref] ?? { has_updates: false, content_verified: false, missing_count: 0, changed_count: 0, extra_count: 0, files: [] };
});
route("POST", "/providers/:id/repo-update", (req) => {
  const { repo_id, delete_extra } = body<{ repo_id: string; delete_extra: boolean }>(req);
  const report = db.repoSyncs[repo_id];
  const stale = report?.files.filter((f) => f.state === "changed" || f.state === "missing") ?? [];
  const extra = report?.files.filter((f) => f.state === "extra").map((f) => f.filename) ?? [];
  const download = stale.length ? enqueue(repo_id, stale.map((f) => ({ filename: f.filename, size: f.remote_size ?? 0 })), "update") : undefined;
  if (report) {
    report.files = report.files.filter((f) => !(delete_extra && f.state === "extra"));
    report.files.forEach((f) => f.state !== "extra" && (f.state = "same"));
    Object.assign(report, { has_updates: false, missing_count: 0, changed_count: 0, extra_count: delete_extra ? 0 : extra.length });
  }
  const state = db.syncStates.find((s) => s.model_ref === repo_id);
  if (state) Object.assign(state, { has_updates: false, missing_count: 0, changed_count: 0 });
  return { started: Boolean(download), deleted: delete_extra ? extra : [], kept_extra: delete_extra ? [] : extra, download };
});
route("POST", "/providers/:id/file-update", (req) => {
  const { repo_id, filename } = body<{ repo_id: string; filename: string }>(req);
  const file = detailFor(repo_id).files.find((f) => f.filename === filename) ?? fail(404, `файл '${filename}' не найден в репозитории`);
  enqueue(repo_id, [file], "update");
  return { started: true };
});
route("GET", "/model-sync/states", () => db.syncStates);
route("POST", "/model-sync/check-updates", () => {
  const refs = new Set(db.models.map((m) => m.ref));
  refs.forEach((ref) => {
    if (!db.syncStates.some((s) => s.model_ref === ref))
      db.syncStates.push({ provider_id: 1, model_ref: ref, checked_at: null, missing_count: 0, changed_count: 0, extra_count: 0, content_verified: false, check_error: null, has_updates: false, checking: false });
  });
  db.syncStates.forEach((s: RepoSyncState, n) => {
    s.checking = true;
    setTimeout(() => Object.assign(s, { checking: false, checked_at: isoNow() }), 1500 + n * 250);
  });
  return { started: true, states: db.syncStates };
});

// --- downloads -----------------------------------------------------------

const LIVE = ["queued", "active", "paused"];

function enqueue(ref: string, files: { filename: string; size: number }[], kind: "download" | "update"): DownloadState {
  const target = `${db.settings.downloads.models_dir}/huggingface/${ref}`;
  const existing = db.downloads.find((d) => d.target_dir === target && LIVE.includes(d.status));
  if (existing)
    fail(409, `в каталог ${target} уже идёт такая же задача ${ref} (id ${existing.id}, статус ${existing.status}) — дождитесь её завершения, поставьте её на паузу или отмените`);
  const record: DownloadState = {
    id: uuid(),
    provider_id: 1,
    model_ref: ref,
    target_dir: target,
    total_bytes: files.reduce((s, f) => s + f.size, 0),
    downloaded_bytes: 0,
    status: "queued",
    error_message: null,
    file_names: files.map((f) => f.filename),
    kind,
    speed: null,
    files,
    created_at: isoNow(),
  };
  db.downloads.push(record);
  return record;
}

const publicDownload = ({ speed, files, created_at, ...record }: DownloadState) => record;
function mustDownload(id: string): DownloadState {
  return db.downloads.find((d) => d.id === id) ?? fail(404, `закачка ${id} не найдена`);
}

function freeBytes(): number {
  const pending = db.downloads.filter((d) => LIVE.includes(d.status)).reduce((s, d) => s + (d.downloaded_bytes ?? 0), 0);
  return Math.max(0, 194_188_914_688 - pending);
}

route("GET", "/downloads", () => db.downloads.map(publicDownload));
route("POST", "/downloads", (req) => {
  const { model_ref, files } = body<{ model_ref: string; files: { filename: string; size: number }[] }>(req);
  const target = `${db.settings.downloads.models_dir}/huggingface/${model_ref}`;
  const detail = detailFor(model_ref);
  const wanted = new Set(files.map((f) => f.filename));
  if (detail.files.filter((f) => wanted.has(f.filename)).every((f) => f.downloaded))
    fail(409, `модель уже скачана в каталог ${target} — задача на скачивание не создана`);
  return publicDownload(enqueue(model_ref, files, "download"));
});
route("GET", "/downloads/stats", (): DownloadStats => {
  const active = db.downloads.filter((d) => d.status === "active");
  const pending = db.downloads.filter((d) => d.status === "active" || d.status === "queued");
  const remaining = (list: DownloadState[]) => list.reduce((s, d) => s + Math.max(0, (d.total_bytes ?? 0) - (d.downloaded_bytes ?? 0)), 0);
  const speed = active.reduce((s, d) => s + (d.speed ?? 0), 0) || null;
  const eta = (bytes: number) => (speed ? Math.round(bytes / speed) : null);
  return {
    active_count: pending.length,
    completed_count: db.downloads.filter((d) => d.status === "completed").length,
    models_count: db.models.length,
    free_bytes: freeBytes(),
    remaining_bytes: remaining(pending),
    speed_bytes_per_sec: speed,
    downloading_count: active.length,
    eta_active_seconds: eta(remaining(active)),
    eta_all_seconds: eta(remaining(pending)),
    active_etas: Object.fromEntries(active.map((d) => [d.id, d.speed ? Math.round(((d.total_bytes ?? 0) - (d.downloaded_bytes ?? 0)) / d.speed) : null])),
  };
});
route("GET", "/downloads/settings", () => db.settings.downloads);
route("PATCH", "/downloads/settings", (req) => {
  const patch = body<{ models_dir?: string }>(req);
  const previous = db.settings.downloads.models_dir;
  Object.assign(db.settings.downloads, patch);
  if (patch.models_dir && patch.models_dir !== previous)
    return { ...db.settings.downloads, previous_models_dir: previous, orphaned_models: db.models.filter((m) => m.file_path.startsWith(previous)).length };
  return db.settings.downloads;
});
route("POST", "/downloads/settings/relocate-models", (req) => {
  const { previous_models_dir } = body<{ previous_models_dir: string }>(req);
  const moved = db.models.filter((m) => m.file_path.startsWith(previous_models_dir));
  moved.forEach((m) => (m.file_path = db.settings.downloads.models_dir + m.file_path.slice(previous_models_dir.length)));
  return { moved, skipped: [] };
});
route("POST", "/downloads/restore-model", (req) => {
  const model = mustModel(body<{ model_id: number }>(req).model_id);
  const files = detailFor(model.ref).files.map(({ filename, size }) => ({ filename, size }));
  const download = enqueue(model.ref, files, "download");
  return { started: true, download: publicDownload(download) };
});
route("POST", "/downloads/reorder", (req) => {
  const order = body<{ ordered_ids: string[] }>(req).ordered_ids;
  db.downloads.sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
  });
  return db.downloads.map(publicDownload);
});
route("GET", "/downloads/:id", (_, p) => publicDownload(mustDownload(p.id)));
route("GET", "/downloads/:id/progress", (_, p) => {
  const d = mustDownload(p.id);
  return {
    downloaded_bytes: d.downloaded_bytes,
    total_bytes: d.total_bytes,
    percent: d.total_bytes ? ((d.downloaded_bytes ?? 0) / d.total_bytes) * 100 : null,
    speed_bytes_per_sec: d.speed,
  };
});
const transition = (from: string[], to: string, verb: string) => (_: MockRequest, p: Record<string, string>) => {
  const d = mustDownload(p.id);
  if (!from.includes(d.status)) fail(409, `нельзя ${verb} закачку в статусе ${d.status}`);
  if (to === "queued" && db.downloads.some((o) => o !== d && o.target_dir === d.target_dir && LIVE.includes(o.status)))
    fail(409, `в каталог ${d.target_dir} уже идёт такая же задача ${d.model_ref} — дождитесь её завершения, поставьте её на паузу или отмените`);
  d.status = to;
  d.speed = null;
  if (to === "queued") d.error_message = null;
  return publicDownload(d);
};
route("POST", "/downloads/:id/pause", transition(["queued", "active"], "paused", "приостановить"));
route("POST", "/downloads/:id/resume", transition(["paused", "failed", "cancelled"], "queued", "возобновить"));
route("POST", "/downloads/:id/cancel", transition(["queued", "active", "paused"], "cancelled", "отменить"));
route("DELETE", "/downloads/:id", (_, p) => {
  const d = mustDownload(p.id);
  if (d.status === "active") fail(409, "нельзя удалить идущую закачку — сначала поставьте её на паузу или отмените");
  db.downloads.splice(db.downloads.indexOf(d), 1);
  return undefined;
});

// --- profiles ------------------------------------------------------------

route("GET", "/profiles", () => db.profiles.map(withValidity));
route("GET", "/profiles/:id", (_, p) => withValidity(mustProfile(num(p.id))));
route("POST", "/profiles", (req) => {
  const input = body<Partial<Profile> & { name: string; model_id: number; engine_plugin_id: number }>(req);
  if (db.profiles.some((p) => p.name === input.name)) fail(409, `профиль с именем '${input.name}' уже существует`);
  const profile: Profile = {
    id: nextId(db.profiles),
    name: input.name,
    model_id: input.model_id,
    engine_plugin_id: input.engine_plugin_id,
    gpu_ids: input.gpu_ids ?? [],
    port: input.port ?? null,
    structural_fields: input.structural_fields ?? {},
    cli_options: input.cli_options ?? "",
    system_prompt: input.system_prompt ?? "",
    reasoning: input.reasoning ?? false,
    input_modalities: input.input_modalities ?? ["text"],
    plugin_version: input.plugin_version ?? index.plugin(input.engine_plugin_id)?.plugin_version ?? "",
    schema_hash: hash(JSON.stringify(input)).toString(16),
    origin_profile_id: null,
    needs_review: false,
    extensions: input.extensions ?? {},
  };
  db.profiles.push(profile);
  return withValidity(profile);
});
route("PATCH", "/profiles/:id", (req, p) => {
  const profile = mustProfile(num(p.id));
  const { schema_fields, ...patch } = body<Partial<Profile> & { schema_fields?: unknown }>(req);
  if (patch.name && db.profiles.some((o) => o !== profile && o.name === patch.name)) fail(409, `профиль с именем '${patch.name}' уже существует`);
  Object.assign(profile, patch, { needs_review: false });
  return withValidity(profile);
});
route("DELETE", "/profiles/:id", (_, p) => {
  const profile = mustProfile(num(p.id));
  const used = db.inferences.filter((i) => i.profile_id === profile.id);
  if (used.length) fail(409, `нельзя удалить профиль: на нём основаны inference ${used.map((i) => i.slug).join(", ")}`);
  db.profiles.splice(db.profiles.indexOf(profile), 1);
  return undefined;
});
route("POST", "/profiles/:id/copy", (req, p) => {
  const source = mustProfile(num(p.id));
  const { name } = body<{ name: string }>(req);
  if (db.profiles.some((o) => o.name === name)) fail(409, `профиль с именем '${name}' уже существует`);
  const copy: Profile = { ...structuredClone(source), id: nextId(db.profiles), name, origin_profile_id: source.id };
  db.profiles.push(copy);
  return withValidity(copy);
});

// --- engines, providers, plugins -----------------------------------------

route("GET", "/engine-installations", () => db.engines);
route("GET", "/engine-installations/:id", (_, p) => index.engine(num(p.id)) ?? fail(404, `установка ${p.id} не найдена`));
function versionCheck(installation: (typeof db.engines)[number]) {
  const paths = Object.values(installation.install_fields).filter((v): v is string => typeof v === "string");
  const broken = paths.find((v) => v.startsWith("/") && /missing|nonexistent|tmp\/none/.test(v)) ?? (paths.some((v) => v.trim() === "") ? "" : undefined);
  const plugin = index.plugin(installation.plugin_id);
  if (installation.name === "moss-tts" || broken !== undefined) {
    return {
      available: false,
      version: null,
      unavailable_reason: installation.name === "moss-tts" ? "проверка версии не прошла: python: No module named 'moss_tts'" : `исполняемый файл не найден: ${broken}`,
    };
  }
  return { available: true, version: installation.version ?? plugin?.plugin_version ?? "1.0.0", unavailable_reason: null };
}
route("POST", "/engine-installations", (req) => {
  const input = body<{ name: string; plugin_id: number; install_fields: Record<string, unknown> }>(req);
  if (db.engines.some((e) => e.name === input.name)) fail(409, `установка с именем '${input.name}' уже существует`);
  const installation = { id: nextId(db.engines), ...input, version: null, available: false, unavailable_reason: null };
  Object.assign(installation, versionCheck(installation));
  db.engines.push(installation);
  return installation;
});
route("PATCH", "/engine-installations/:id", (req, p) => {
  const installation = index.engine(num(p.id)) ?? fail(404, `установка ${p.id} не найдена`);
  const patch = body<{ name?: string }>(req);
  if (patch.name && db.engines.some((e) => e !== installation && e.name === patch.name)) fail(409, `установка с именем '${patch.name}' уже существует`);
  Object.assign(installation, patch);
  return Object.assign(installation, versionCheck(installation));
});
route("POST", "/engine-installations/:id/recheck", (_, p) => {
  const installation = index.engine(num(p.id)) ?? fail(404, `установка ${p.id} не найдена`);
  return Object.assign(installation, versionCheck(installation));
});
route("DELETE", "/engine-installations/:id", (_, p) => {
  const installation = index.engine(num(p.id)) ?? fail(404, `установка ${p.id} не найдена`);
  const used = db.inferences.filter((i) => i.engine_installation_id === installation.id);
  if (used.length) fail(409, `нельзя удалить установку: её используют inference ${used.map((i) => i.slug).join(", ")}`);
  db.engines.splice(db.engines.indexOf(installation), 1);
  return undefined;
});

route("GET", "/providers", () => db.providers);
route("GET", "/providers/:id", (_, p) => db.providers.find((x) => x.id === num(p.id)) ?? fail(404, `провайдер ${p.id} не найден`));
route("PATCH", "/providers/:id", (req, p) => {
  const provider = db.providers.find((x) => x.id === num(p.id)) ?? fail(404, `провайдер ${p.id} не найден`);
  provider.config = body<{ config: Record<string, unknown> }>(req).config;
  return provider;
});

route("GET", "/plugins", () => db.plugins);
route("GET", "/plugins/:id/schema", (_, p) => {
  const schema = db.schemas[p.id] ?? fail(404, `плагин ${p.id} не найден`);
  return { ...schema, extensions: db.extensions[p.id] ?? [] };
});
const togglePlugin = (enabled: boolean) => (_: MockRequest, p: Record<string, string>) => {
  const plugin = index.plugin(num(p.id)) ?? fail(404, `плагин ${p.id} не найден`);
  plugin.enabled = enabled;
  return plugin;
};
route("POST", "/plugins/:id/disable", togglePlugin(false));
route("POST", "/plugins/:id/enable", togglePlugin(true));
route("DELETE", "/plugins/:id", (_, p) => {
  const plugin = index.plugin(num(p.id)) ?? fail(404, `плагин ${p.id} не найден`);
  const used = db.engines.filter((e) => e.plugin_id === plugin.id);
  if (used.length) fail(409, `нельзя удалить плагин: есть установки ${used.map((e) => e.name).join(", ")}`);
  db.plugins.splice(db.plugins.indexOf(plugin), 1);
  return undefined;
});

async function checkArchive(form: FormData | null): Promise<File> {
  const archive = form?.get("archive");
  if (!(archive instanceof File)) return fail(400, "архив не передан");
  const digest = await crypto.subtle.digest("SHA-256", await archive.arrayBuffer());
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (String(form?.get("sha256") ?? "").trim().toLowerCase() !== hex) fail(400, "контрольная сумма SHA-256 архива не совпадает");
  return archive;
}

route("POST", "/plugins/install", async (req) => {
  await checkArchive(req.form);
  const name = String(req.form?.get("name") ?? "").trim();
  if (db.plugins.some((p) => p.name === name)) fail(400, `плагин уже установлен: ${name}`);
  const id = nextId(db.plugins);
  db.plugins.push({
    id, name, plugin_version: "0.1.0", contract_version: "1", plugin_type: "engine",
    path: `/home/demo/.local/share/llm-launcher/plugins/${name}`, status: "ok", error_detail: null,
    enabled: true, tasks: ["text-generation"], model_formats: ["gguf"],
  });
  db.schemas[id] = { install_schema: [], profile_schema: [], tasks: ["text-generation"], extensions_unsupported_reason: `плагин ${name} не поддерживает расширения`, extensions: [] };
  return { status: "installed", name };
});
route("GET", "/plugins/:id/extensions", (_, p) => db.extensions[p.id] ?? []);
route("POST", "/plugins/:id/extensions/install", async (req, p) => {
  const plugin = index.plugin(num(p.id)) ?? fail(404, `плагин ${p.id} не найден`);
  const reason = db.schemas[p.id]?.extensions_unsupported_reason;
  if (reason) fail(409, reason);
  const archive = await checkArchive(req.form);
  const list = (db.extensions[p.id] ??= []);
  const name = archive.name.replace(/\.(tar\.gz|tgz|zip)$/i, "");
  const extension: EngineExtension = {
    id: nextId(Object.values(db.extensions).flat()),
    plugin_id: plugin.id,
    name,
    version: "1.0.0",
    task: plugin.tasks[0] ?? "",
    path: `/home/demo/.local/share/llm-launcher/extensions/${plugin.name}/${name}`,
    status: "ok",
    error_detail: null,
    dictionaries: [{ name: "terms", path: "dictionaries/terms.tsv", description: "Словарь терминов" }],
    options: [],
  };
  list.push(extension);
  return extension;
});
route("POST", "/plugins/:id/extensions/rescan", (_, p) => db.extensions[p.id] ?? []);
route("DELETE", "/plugins/:id/extensions/:ext", (_, p) => {
  const list = db.extensions[p.id] ?? [];
  list.splice(list.findIndex((e) => e.id === num(p.ext)), 1);
  return undefined;
});

// --- router support ------------------------------------------------------

route("GET", "/api-keys", () => db.apiKeys);
route("POST", "/api-keys", (req) => {
  const input = body<{ owner_username: string; acl_inference_ids: string[]; expires_at: string | null }>(req);
  const owner = db.users.find((u) => u.username === input.owner_username) ?? fail(404, `пользователь ${input.owner_username} не найден`);
  const secret = `sk-ll-${uuid().replace(/-/g, "")}`;
  const record = {
    id: nextId(db.apiKeys),
    key_prefix: secret.slice(0, 10),
    owner_user_id: owner.id,
    owner_username: owner.username,
    acl_inference_ids: input.acl_inference_ids,
    created_at: isoNow(),
    expires_at: input.expires_at,
    revoked_at: null,
  };
  db.apiKeys.push(record);
  return { ...record, key: secret };
});
route("DELETE", "/api-keys/:id", (_, p) => {
  const key = db.apiKeys.find((k) => k.id === num(p.id)) ?? fail(404, `ключ ${p.id} не найден`);
  key.revoked_at = isoNow();
  return undefined;
});
route("DELETE", "/api-keys/:id/record", (_, p) => {
  const key = db.apiKeys.find((k) => k.id === num(p.id)) ?? fail(404, `ключ ${p.id} не найден`);
  if (!key.revoked_at && !(key.expires_at && key.expires_at < isoNow())) fail(409, "нельзя удалить ещё активный ключ — сначала отзовите его");
  db.apiKeys.splice(db.apiKeys.indexOf(key), 1);
  return undefined;
});
route("GET", "/request-log", (req) => db.requestLog.slice(0, num(req.query.get("limit") ?? "100")));
route("GET", "/request-log/settings", () => db.settings.request_log);
route("PATCH", "/request-log/settings", (req) => Object.assign(db.settings.request_log, body(req)));
route("GET", "/audit-log", (req) => db.auditLog.slice(0, num(req.query.get("limit") ?? "100")));
route("GET", "/audit-log/settings", () => db.settings.audit);
route("PATCH", "/audit-log/settings", (req) => Object.assign(db.settings.audit, body(req)));

route("GET", "/assistant/settings", () => db.settings.assistant);
route("PATCH", "/assistant/settings", (req) => {
  const { router_base_url, model, api_key } = body<{ router_base_url: string; model: string; api_key: string }>(req);
  const a = db.settings.assistant;
  Object.assign(a, { router_base_url, model, has_api_key: a.has_api_key || Boolean(api_key) });
  a.configured = Boolean(a.model && a.has_api_key);
  return { router_base_url: a.router_base_url, model: a.model, configured: a.configured };
});

// --- resources & metrics -------------------------------------------------

route("GET", "/resources/gpu-status", (req) => {
  const ids = (req.query.get("gpu_ids") ?? "").split(",").filter(Boolean).map(Number);
  const inferenceIds = (req.query.get("inference_ids") ?? "").split(",").filter(Boolean);
  return gpuStatus(ids, inferenceIds);
});
route("GET", "/resources/settings", () => db.settings.resources);
route("PATCH", "/resources/settings", (req) => {
  const patch = body<typeof db.settings.resources>(req);
  if (patch.port_range_start > patch.port_range_end) fail(400, "начало диапазона портов больше конца");
  return Object.assign(db.settings.resources, patch);
});
route("GET", "/resources/host-load", () => hostLoadNow());
route("GET", "/resources/numa-topology", () => db.numa);
route("GET", "/resources/hardware-info", () => ({
  ...db.hardware,
  gpus: gpuStatus(db.hardware.gpus?.map((g) => g.gpu_id) ?? [], []).map((g) => ({
    gpu_id: g.gpu_id,
    name: g.name ?? "",
    used_bytes: g.used_bytes ?? 0,
    total_bytes: g.total_bytes ?? 0,
    utilization_percent: g.utilization_percent ?? 0,
    temperature_c: g.temperature_c ?? 0,
  })),
}));
route("GET", "/resources/inference-throughput", (req) =>
  Object.fromEntries((req.query.get("inference_ids") ?? "").split(",").filter(Boolean).map((id) => [id, currentThroughput(id)]))
);
route("GET", "/metrics/host-load-history", (req) => historySeries("stand_load", req.query.get("range") ?? "1h", []));
route("GET", "/metrics/inference-throughput-history", (req) =>
  historySeries("throughput", req.query.get("range") ?? "1h", (req.query.get("inference_ids") ?? "").split(",").filter(Boolean))
);
route("GET", "/metrics/gpu-power-history", (req) => historySeries("gpu_power", req.query.get("range") ?? "1h", []));
route("GET", "/metrics/settings", () => db.settings.metrics);
route("PATCH", "/metrics/settings", (req) => Object.assign(db.settings.metrics, body(req)));

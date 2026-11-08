// Симуляция процессов во времени: прогрев и остановка inference, запросы к
// работающим моделям (tok/s, журнал запросов, строки лога), закачки и
// отсчёты метрик. История до загрузки страницы синтезируется
// детерминированно; после — копится из отсчётов симуляции.
import type {
  GpuPowerHistoryPoint,
  GpuStatusEntry,
  Inference,
  InferenceRun,
  StandLoadHistoryPoint,
  ThroughputHistoryPoint,
} from "../src/api/types";
import type { HostLoadSnapshot } from "../src/api/orchestrator";
import { fail, publishLogLine } from "./server";
import { db, GiB, index, isoNow, MiB, type DownloadState, type ProcessState } from "./state";

const SAMPLE_SECONDS = 5;
const MAX_POINTS = 720;
const HISTORY_SPAN_MS = 14 * 24 * 3600e3;

const proc = (id: string): ProcessState => db.processes.get(id)!;
const isLive = (p: ProcessState) => p.status === "running" || p.status === "warming" || p.status === "unresponsive";
const taskOf = (id: string) => db.routerModels[id]?.task ?? "text-generation";

function stamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}

export function logLine(inference: Inference, text: string, level = "INFO"): void {
  const line = `${stamp()}  ${level.padEnd(5)}  ${text}`;
  const log = (db.logs[inference.id] ??= []);
  log.push(line);
  if (log.length > 2000) log.splice(0, log.length - 2000);
  publishLogLine(inference.id, line);
}

/** Пик VRAM inference: из прошлого запуска, иначе по объёму весов. */
function vramOf(inference: Inference): number {
  if (inference.last_run_peak_vram_bytes) return inference.last_run_peak_vram_bytes;
  const model = index.model(inference.model_id);
  const weights = model ? db.modelDetails[model.ref]?.local_bytes ?? 0 : 0;
  return Math.max(2 * GiB, Math.min(weights * 1.2, 22 * GiB * inference.gpu_ids.length));
}

let nextRunId = Math.max(0, ...Object.values(db.runs).flat().map((r) => r.id)) + 1;

export function startProcess(inference: Inference, overrideGpuIds?: number[]): { unit: string; warnings: string[] } {
  const model = index.model(inference.model_id);
  const installation = index.engine(inference.engine_installation_id);
  if (model && !model.validity.usable) fail(409, `модель недоступна: ${model.validity.reason} (${model.file_path})`);
  if (installation && !installation.available) fail(409, `установка недоступна: ${installation.unavailable_reason}`);
  const p = proc(inference.id);
  if (isLive(p)) fail(409, `inference ${inference.id} уже запущен`);
  const plugin = installation ? index.plugin(installation.plugin_id) : undefined;
  if (plugin && plugin.status !== "ok") fail(409, `плагин ${plugin.id} не загружен: статус ${plugin.status}`);
  if (plugin && !plugin.enabled) fail(409, `плагин ${plugin.id} отключён`);

  const now = Date.now();
  Object.assign(p, {
    status: "warming",
    readyAt: now + 5000 + Math.random() * 4000,
    stoppingUntil: null,
    pid: db.nextPid(),
    gpuIds: overrideGpuIds ?? [...inference.gpu_ids],
    tokensIn: 0,
    tokensOut: 0,
    busyUntil: 0,
  });
  inference.last_started_at = isoNow();
  const run: InferenceRun = {
    id: nextRunId++,
    inference_id: inference.id,
    profile_id: inference.profile_id,
    engine_installation_id: inference.engine_installation_id,
    engine_installation_version: installation?.version ?? null,
    gpu_ids: p.gpuIds,
    port: inference.port,
    started_at: isoNow(),
    stopped_at: null,
    outcome: null,
    peak_vram_bytes: null,
    peak_ram_bytes: null,
    initiated_by: "admin",
    log_file_path: null,
  };
  (db.runs[inference.id] ??= []).unshift(run);
  logLine(inference, `starting ${installation?.name ?? "engine"} | model ${model?.file_path ?? "?"} | port ${inference.port} | gpus ${p.gpuIds.join(",")}`);
  return { unit: `llm-${inference.id}.service`, warnings: [] };
}

export function stopProcess(inference: Inference): void {
  const p = proc(inference.id);
  if (!isLive(p)) return;
  p.stoppingUntil = Date.now() + 2500;
  logLine(inference, "received SIGTERM, shutting down");
}

function finishRun(inference: Inference, outcome: InferenceRun["outcome"]): void {
  const run = db.runs[inference.id]?.find((r) => r.stopped_at === null);
  const vram = vramOf(inference);
  if (run) Object.assign(run, { stopped_at: isoNow(), outcome, peak_vram_bytes: vram, peak_ram_bytes: Math.round(vram * 0.4) });
  inference.last_run_peak_vram_bytes = vram;
  inference.last_run_peak_ram_bytes = Math.round(vram * 0.4);
}

export function currentThroughput(id: string): { tokens_in_per_sec: number; tokens_out_per_sec: number } {
  const p = db.processes.get(id);
  return { tokens_in_per_sec: p?.tokensIn ?? 0, tokens_out_per_sec: p?.tokensOut ?? 0 };
}

// --- GPU и хост ----------------------------------------------------------

function occupants(gpuId: number): { inference: Inference; p: ProcessState }[] {
  return db.inferences
    .map((inference) => ({ inference, p: proc(inference.id) }))
    .filter(({ p }) => p && isLive(p) && p.gpuIds.includes(gpuId));
}

function warmFraction(p: ProcessState): number {
  if (p.status !== "warming" || p.readyAt === null) return 1;
  return Math.min(1, Math.max(0.05, 1 - (p.readyAt - Date.now()) / 8000));
}

export function gpuStatus(ids: number[], inferenceIds: string[]): GpuStatusEntry[] {
  return db.gpuBaseline
    .filter((g) => ids.length === 0 || ids.includes(g.gpu_id))
    .map((base) => {
      const here = occupants(base.gpu_id);
      const total = base.total_bytes ?? 24 * GiB;
      const processes = here.map(({ inference, p }) => ({
        pid: p.pid,
        used_bytes: Math.round(Math.min(total * 0.96, vramOf(inference) / p.gpuIds.length) * warmFraction(p)),
      }));
      const busy = here.some(({ p }) => p.tokensIn + p.tokensOut > 0);
      const warming = here.some(({ p }) => p.status === "warming");
      const util = busy ? 62 + Math.random() * 35 : warming ? 15 + Math.random() * 25 : here.length ? Math.random() * 2 : 0;
      const limit = base.power_limit_watts ?? 250;
      const temp = Math.round(27 + util * 0.45 + (here.length ? 4 : 0));
      // Сверка как в gpu_reconciliation оркестратора: намерение — по
      // сохранённым картам переданных inference, без учёта их статуса.
      const intended = inferenceIds.filter((id) => index.inference(id)?.gpu_ids.includes(base.gpu_id));
      const used = 1_048_576 + processes.reduce((s, x) => s + x.used_bytes, 0);
      return {
        ...base,
        intended_inference_ids: intended,
        discrepancy: intended.length === 0 ? used > 0 : used === 0,
        used_bytes: used,
        utilization_percent: Math.round(util),
        temperature_c: temp,
        processes,
        graphics_clock_mhz: util > 5 ? 1695 + Math.round(Math.random() * 60) : 210,
        memory_clock_mhz: here.length ? 9751 : 405,
        fan_speed_percent: temp > 45 ? Math.min(100, Math.round((temp - 40) * 2.2)) : 0,
        power_draw_watts: Math.min(limit, Math.round((22 + (here.length ? 12 : 0) + util * 2.05) * 100) / 100),
        pcie_gen_current: util > 5 || warming ? base.pcie_gen_max : 1,
        pcie_rx_bytes_per_sec: warming ? Math.round(3.2 * GiB * Math.random()) : busy ? Math.round(40 * MiB * Math.random()) : 0,
        pcie_tx_bytes_per_sec: busy ? Math.round(12 * MiB * Math.random()) : 0,
      };
    });
}

export function hostLoadNow(): HostLoadSnapshot {
  const live = db.inferences.map((i) => proc(i.id)).filter((p) => p && isLive(p));
  const warming = live.filter((p) => p.status === "warming").length;
  const busy = live.filter((p) => p.tokensIn + p.tokensOut > 0).length;
  const downloading = db.downloads.filter((d) => d.status === "active").reduce((s, d) => s + (d.speed ?? 0), 0);
  const base = db.hostLoadBaseline;
  return {
    cpu_percent: Math.min(100, 6 + warming * 28 + busy * 9 + Math.random() * 6),
    ram_percent: Math.min(97, 38 + live.length * 9 + warming * 4 + Math.random()),
    disk_read_bytes_per_sec: warming * 1.1 * GiB * (0.7 + Math.random() * 0.3) + Math.random() * base.disk_read_bytes_per_sec,
    disk_write_bytes_per_sec: downloading + Math.random() * base.disk_write_bytes_per_sec,
    net_recv_bytes_per_sec: downloading * 1.02 + busy * 40_000 + Math.random() * 15_000,
    net_sent_bytes_per_sec: busy * 25_000 + Math.random() * 30_000,
  };
}

// --- история метрик --------------------------------------------------------

const liveStand: StandLoadHistoryPoint[] = [];
const liveThroughput: { at: number; perInference: Record<string, [number, number]> }[] = [];
const livePower: GpuPowerHistoryPoint[] = [];

/** Детерминированный шум [0, 1) — прошлое не меняется между запросами. */
function noise(seed: number, k: number): number {
  let h = (seed * 374761393 + k * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function seedOf(text: string): number {
  let h = 7;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Стенд был выключен ~3 суток назад на 2 часа — честный разрыв на графиках. */
const OUTAGE_FROM = db.bootedAt - 3 * 24 * 3600e3 - 2 * 3600e3;
const OUTAGE_TO = db.bootedAt - 3 * 24 * 3600e3;

const RANGE_MS: Record<string, number | null> = { "1h": 3600e3, "24h": 24 * 3600e3, "7d": 7 * 24 * 3600e3, all: null };

function synthThroughput(id: string, t: number): [number, number] {
  if (taskOf(id) !== "text-generation") return [0, 0];
  const s = seedOf(id);
  const slot = Math.floor(t / 90e3);
  // Рабочие часы активнее ночи; у каждой модели свой ритм.
  const hour = new Date(t).getUTCHours();
  const activity = hour >= 6 && hour <= 20 ? 0.8 : 0.95;
  if (noise(s, slot) < Math.min(0.97, activity + (s % 5) * 0.03)) return [0, 0];
  return [400 + noise(s + 1, slot) * 4200, 18 + noise(s + 2, slot) * 52];
}

function synthStand(t: number): Omit<StandLoadHistoryPoint, "at"> {
  const k = Math.floor(t / 60e3);
  const busy = noise(11, Math.floor(t / 90e3)) > 0.85 ? 1 : 0;
  return {
    cpu_percent: 6 + noise(1, k) * 10 + busy * 14,
    ram_percent: 58 + noise(2, Math.floor(k / 30)) * 12,
    disk_read_bytes_per_sec: noise(3, k) * 25 * MiB + (noise(4, Math.floor(k / 20)) > 0.97 ? 900 * MiB : 0),
    disk_write_bytes_per_sec: noise(5, k) * 9 * MiB,
    net_recv_bytes_per_sec: noise(6, k) * 60_000 + (noise(7, Math.floor(k / 15)) > 0.97 ? 55 * MiB : 0),
    net_sent_bytes_per_sec: noise(8, k) * 45_000,
  };
}

function synthPower(gpuId: number, t: number): number {
  const k = Math.floor(t / 90e3);
  const loaded = gpuId !== 0 || noise(20, Math.floor(k / 40)) > 0.6;
  const busy = noise(30 + gpuId, k) > 0.82;
  return (loaded ? 34 : 21) + (busy ? 120 + noise(40 + gpuId, k) * 110 : noise(50 + gpuId, k) * 6);
}

const avg = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;

/** Бакет истории — среднее отсчётов внутри него, как в хранилище метрик
 * оркестратора; синтетика усредняется по нескольким точкам бакета. */
function bucketAvg(t: number, stepMs: number, fn: (moment: number) => number): number {
  const n = Math.min(12, Math.max(1, Math.round(stepMs / 60e3)));
  return avg(Array.from({ length: n }, (_, i) => fn(t + (i * stepMs) / n)));
}

export function historySeries(series: "stand_load" | "throughput" | "gpu_power", range: string, inferenceIds: string[]) {
  const now = Date.now();
  const spanMs = RANGE_MS[range] ?? HISTORY_SPAN_MS;
  const start = now - spanMs;
  const stepSeconds = Math.max(SAMPLE_SECONDS, Math.floor(spanMs / 1000 / MAX_POINTS) + 1);
  const stepMs = stepSeconds * 1000;
  const ids = inferenceIds.length ? inferenceIds : db.inferences.map((i) => i.id);
  const gpuIds = db.gpuBaseline.map((g) => g.gpu_id);
  const points: unknown[] = [];

  for (let t = Math.ceil(start / stepMs) * stepMs; t <= now; t += stepMs) {
    const at = new Date(t).toISOString().replace("Z", "");
    const end = t + stepMs;
    if (end <= db.bootedAt) {
      if (t >= OUTAGE_FROM && t < OUTAGE_TO) continue;
      if (series === "stand_load") {
        const keys = Object.keys(synthStand(t)) as (keyof Omit<StandLoadHistoryPoint, "at">)[];
        points.push({ at, ...Object.fromEntries(keys.map((k) => [k, bucketAvg(t, stepMs, (m) => synthStand(m)[k])])) });
      } else if (series === "throughput") {
        const total = (i: 0 | 1) => bucketAvg(t, stepMs, (m) => ids.reduce((s, id) => s + synthThroughput(id, m)[i], 0));
        points.push({ at, tokens_in_per_sec: total(0), tokens_out_per_sec: total(1) });
      } else gpuIds.forEach((gpu_id) => points.push({ at, gpu_id, power_watts: bucketAvg(t, stepMs, (m) => synthPower(gpu_id, m)) }));
      continue;
    }
    const inBucket = (iso: string | number) => {
      const ms = typeof iso === "number" ? iso : Date.parse(iso + "Z");
      return ms >= t && ms < end;
    };
    if (series === "stand_load") {
      const bucket = liveStand.filter((p) => inBucket(p.at));
      if (!bucket.length) continue;
      const keys = Object.keys(bucket[0]).filter((k) => k !== "at") as (keyof Omit<StandLoadHistoryPoint, "at">)[];
      points.push({ at, ...Object.fromEntries(keys.map((k) => [k, avg(bucket.map((p) => p[k]))])) });
    } else if (series === "throughput") {
      const bucket = liveThroughput.filter((p) => inBucket(p.at));
      if (!bucket.length) continue;
      const total = (i: 0 | 1) => avg(bucket.map((p) => ids.reduce((s, id) => s + (p.perInference[id]?.[i] ?? 0), 0)));
      points.push({ at, tokens_in_per_sec: total(0), tokens_out_per_sec: total(1) } satisfies ThroughputHistoryPoint);
    } else {
      gpuIds.forEach((gpu_id) => {
        const bucket = livePower.filter((p) => p.gpu_id === gpu_id && inBucket(p.at));
        if (bucket.length) points.push({ at, gpu_id, power_watts: avg(bucket.map((p) => p.power_watts)) });
      });
    }
  }
  return { range, step_seconds: stepSeconds, points };
}

function sample(): void {
  const at = isoNow();
  liveStand.push({ at, ...hostLoadNow() });
  liveThroughput.push({
    at: Date.now(),
    perInference: Object.fromEntries(db.inferences.map((i) => [i.id, [proc(i.id).tokensIn, proc(i.id).tokensOut] as [number, number]])),
  });
  gpuStatus([], []).forEach((g) => livePower.push({ at, gpu_id: g.gpu_id, power_watts: g.power_draw_watts ?? 0 }));
}

// --- такт симуляции ------------------------------------------------------

let nextRequestId = Math.max(...db.requestLog.map((r) => r.id)) + 1;

function tickInference(inference: Inference, now: number): void {
  const p = proc(inference.id);
  if (p.stoppingUntil !== null) {
    p.tokensIn = 0;
    p.tokensOut = 0;
    if (now >= p.stoppingUntil) {
      Object.assign(p, { status: "stopped", stoppingUntil: null, pid: 0, readyAt: null });
      finishRun(inference, "stopped");
      logLine(inference, "process exited, GPU memory released");
    }
    return;
  }
  if (p.status === "warming" && p.readyAt !== null) {
    if (now >= p.readyAt) {
      Object.assign(p, { status: "running", readyAt: null });
      logLine(inference, `engine ready | listening on 0.0.0.0:${inference.port}`);
    } else {
      const pct = (warmFraction(p) * 100).toFixed(1);
      logLine(inference, `loading weights ${pct}% | ${(vramOf(inference) / GiB * warmFraction(p)).toFixed(1)} GiB/${(vramOf(inference) / GiB).toFixed(1)} GiB`);
    }
    return;
  }
  if (p.status !== "running") return;

  const task = taskOf(inference.id);
  if (p.busyUntil > now) {
    // Первый такт запроса — prefill (много входных токенов), дальше декодирование.
    const prefill = p.tokensIn === 1;
    p.tokensIn = prefill ? 1500 + Math.random() * 6000 : 0;
    p.tokensOut = prefill ? 0 : 28 + Math.random() * 45;
    return;
  }
  if (p.busyUntil !== 0) {
    const duration = 3000 + Math.random() * 9000;
    const tokensIn = Math.round(500 + Math.random() * 30000);
    const tokensOut = Math.round(duration / 1000 * 45);
    db.requestLog.unshift({
      id: nextRequestId++,
      api_key_id: Math.random() > 0.2 ? 16 : 17,
      inference_id: inference.id,
      duration_ms: Math.round(duration),
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      status_code: 200,
      started_at: isoNow(-duration),
    });
    db.requestLog.splice(db.settings.request_log.max_records);
    logLine(inference, `POST /v1/chat/completions 200 | prompt ${tokensIn} tok | completion ${tokensOut} tok | ${(duration / 1000).toFixed(1)} s`);
    p.busyUntil = 0;
    p.tokensIn = 0;
    p.tokensOut = 0;
    return;
  }
  if (task === "text-generation" && Math.random() < 0.07) {
    p.busyUntil = now + 3000 + Math.random() * 9000;
    p.tokensOut = 0;
    p.tokensIn = 1;
  } else if (Math.random() < 0.02) {
    logLine(inference, task === "text-generation" ? "GET /health 200" : "GET /v1/models 200");
  }
}

function registerDownloadedModel(d: DownloadState): void {
  const detail = db.modelDetails[d.model_ref];
  const names = new Set(d.file_names ?? []);
  if (detail) {
    detail.files.forEach((f) => names.has(f.filename) && Object.assign(f, { downloaded: true, local_size: f.size }));
    detail.variants.forEach((v) => names.has(v.filename) && Object.assign(v, { downloaded: true, local_size: v.size }));
    detail.local_bytes = detail.files.reduce((s, f) => s + (f.local_size ?? 0), 0);
  }
  if (d.kind === "update" || db.models.some((m) => m.ref === d.model_ref)) return;
  const format = detail?.repo_format ?? "safetensors";
  const gguf = (d.file_names ?? []).find((f) => f.endsWith(".gguf"));
  db.models.push({
    id: Math.max(0, ...db.models.map((m) => m.id)) + 1,
    provider_id: d.provider_id,
    ref: d.model_ref,
    file_path: gguf ? `${d.target_dir}/${gguf}` : d.target_dir,
    format,
    pipeline_tag: null,
    metadata: format === "gguf" ? { architecture: "qwen3moe", context_length: 262144, quantization: "Q2_K" } : { architecture: "Qwen3ForCausalLM", context_length: 131072, dtype: "bfloat16" },
    favorite: false,
    validity: { usable: true, reason: null },
  });
}

function tickDownloads(): void {
  const { max_concurrent_downloads, rate_limit_bytes_per_sec } = db.settings.downloads;
  for (const d of db.downloads) {
    if (d.status === "queued" && db.downloads.filter((x) => x.status === "active").length < max_concurrent_downloads) d.status = "active";
  }
  const active = db.downloads.filter((d) => d.status === "active");
  const budget = rate_limit_bytes_per_sec > 0 ? Math.min(rate_limit_bytes_per_sec, 70 * MiB) : 70 * MiB;
  for (const d of active) {
    const instant = (budget / active.length) * (0.85 + Math.random() * 0.3);
    d.speed = d.speed === null ? instant : d.speed * 0.7 + instant * 0.3;
    d.downloaded_bytes = Math.min(d.total_bytes ?? 0, (d.downloaded_bytes ?? 0) + Math.round(instant));
    if (d.downloaded_bytes >= (d.total_bytes ?? 0)) {
      d.status = "completed";
      d.speed = null;
      registerDownloadedModel(d);
    }
  }
}

let ticks = 0;
export function startClock(): void {
  setInterval(() => {
    const now = Date.now();
    db.inferences.forEach((inference) => db.processes.has(inference.id) && tickInference(inference, now));
    tickDownloads();
    if (++ticks % SAMPLE_SECONDS === 0) sample();
  }, 1000);
  sample();
}

/** WAV-ответ синтеза речи: короткая мелодия, чтобы плеер консоли было
 * что воспроизвести. PCM16, моно, 16 кГц. */
export function wavTone(seconds: number): Blob {
  const rate = 16000;
  const count = Math.round(seconds * rate);
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const text = (offset: number, s: string) => [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, count * 2, true);
  const notes = [220, 247, 262, 294, 330, 294, 262, 247];
  for (let i = 0; i < count; i += 1) {
    const t = i / rate;
    const note = notes[Math.floor(t / 0.25) % notes.length];
    const envelope = Math.sin(Math.PI * ((t % 0.25) / 0.25));
    view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * note * t) * envelope * 9000), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

import type { Inference } from "../types";

/** Полная запись inference для тестов: набор полей держится здесь, чтобы
 * новое поле контракта не приходилось дописывать в каждый тест. */
export function inferenceEntry(overrides: Partial<Inference> = {}): Inference {
  return {
    id: "inf-1",
    slug: "inf-1",
    name: "Test",
    profile_id: 1,
    model_id: 1,
    engine_installation_id: 1,
    gpu_ids: [],
    port: 8080,
    structural_fields: {},
    cli_options: "",
    system_prompt: "",
    autostart: false,
    reasoning: false,
    input_modalities: ["text"],
    trace: false,
    last_started_at: null,
    last_run_peak_vram_bytes: null,
    last_run_peak_ram_bytes: null,
    ...overrides,
  };
}

import type { PluginRecord, Profile } from "../types";

/** Полная запись профиля для тестов: набор полей держится здесь, чтобы
 * новое поле контракта не приходилось дописывать в каждый тест. */
export function profileEntry(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 1,
    name: "profile-1",
    model_id: 1,
    plugin_id: 1,
    gpu_ids: [],
    port: 8090,
    structural_fields: {},
    cli_options: "",
    system_prompt: "",
    extensions: {},
    plugin_version: "1.0.0",
    schema_hash: "x",
    origin_profile_id: null,
    needs_review: false,
    ...overrides,
  };
}

/** Engine-плагин — вариант движка — для тестов. */
export function pluginEntry(overrides: Partial<PluginRecord> = {}): PluginRecord {
  return {
    id: 1,
    name: "llama-cpp",
    plugin_version: "0.1.0",
    contract_version: "1",
    plugin_type: "engine",
    path: "/plugins/llama-cpp",
    status: "ok",
    error_detail: null,
    enabled: true,
    tasks: ["text-generation"],
    install_fields: { llama_server_path: "/opt/llama-server" },
    engine_version: "1.0.0",
    available: true,
    unavailable_reason: null,
    ...overrides,
  };
}

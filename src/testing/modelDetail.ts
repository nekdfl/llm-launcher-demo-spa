import type { DownloadRecord, ModelDetailResponse, ModelFileDetail } from "../api/types";

/** Файл репозитория для тестов карточки: по умолчанию не скачан. */
export function fileDetail(filename: string, size: number, overrides: Partial<ModelFileDetail> = {}): ModelFileDetail {
  return { filename, size, downloaded: false, local_size: null, disk_sufficient: true, ...overrides };
}

/** Ответ `model-detail` для тестов: GGUF-репозиторий из одного кванта, не скачан. */
export function modelDetail(overrides: Partial<ModelDetailResponse> = {}): ModelDetailResponse {
  const files = overrides.files ?? [fileDetail("model.Q4_K_M.gguf", 25_700_000_000)];
  return {
    description: "Пример описания модели",
    source_url: null,
    total_bytes: files.reduce((sum, file) => sum + file.size, 0),
    total_disk_sufficient: true,
    features: [],
    variants: [
      {
        filename: "model.Q4_K_M.gguf",
        quant_label: "Q4_K_M",
        size: 25_700_000_000,
        downloaded: false,
        local_size: null,
        disk_sufficient: true,
        estimated_vram_bytes: 25_700_000_000,
      },
    ],
    local_bytes: files.reduce((sum, file) => sum + (file.local_size ? Math.min(file.local_size, file.size) : 0), 0),
    repo_format: "gguf",
    supporting_engines: [],
    ...overrides,
    files,
  };
}

export function downloadTask(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    id: "d1",
    provider_id: 1,
    model_ref: "org/model",
    target_dir: "/models/huggingface/org/model",
    total_bytes: 100,
    downloaded_bytes: 40,
    status: "active",
    error_message: null,
    file_names: null,
    ...overrides,
  };
}

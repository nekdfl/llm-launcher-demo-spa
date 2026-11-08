import type { GpuStatusEntry } from "../types";

/** Карточка GPU несёт полную телеметрию карты, поэтому тестам нужен не
 * объект из четырёх полей, а запись со всеми: фабрика держит набор в одном
 * месте, чтобы добавление поля не разъезжалось по тестам. */
export function gpuStatusEntry(overrides: Partial<GpuStatusEntry> = {}): GpuStatusEntry {
  return {
    gpu_id: 0,
    intended_inference_ids: [],
    discrepancy: false,
    used_bytes: 1000,
    total_bytes: 24000,
    utilization_percent: 10,
    temperature_c: 40,
    processes: [],
    name: "NVIDIA GeForce RTX 3090",
    pcie_gen_current: 1,
    pcie_gen_max: 3,
    pcie_width_current: 16,
    pcie_width_max: 16,
    graphics_clock_mhz: 210,
    memory_clock_mhz: 405,
    fan_speed_percent: 0,
    power_draw_watts: 12.76,
    power_limit_watts: 350,
    pcie_rx_bytes_per_sec: 2 * 1024 * 1024,
    pcie_tx_bytes_per_sec: 6 * 1024 * 1024,
    ...overrides,
  };
}

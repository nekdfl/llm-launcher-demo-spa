import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { gpuStatusEntry } from "../api/__fixtures__/gpuStatus";
import { GpuCard } from "./GpuCard";

function renderCard(overrides = {}) {
  return render(
    <MemoryRouter>
      <GpuCard entry={gpuStatusEntry(overrides)} inferences={[]} />
    </MemoryRouter>
  );
}

describe("GpuCard: телеметрия карты", () => {
  it("показывает наименование, PCIe, rx/tx, частоты, вентилятор и мощность", () => {
    renderCard();

    expect(screen.getByTestId("gpu-name-0")).toHaveTextContent("NVIDIA GeForce RTX 3090");
    expect(screen.getByTestId("gpu-throughput-0")).toHaveTextContent("2 MB/s / 6 MB/s");
    expect(screen.getByTestId("gpu-clocks-0")).toHaveTextContent("210 / 405 MHz");
    expect(screen.getByTestId("gpu-fan-0")).toHaveTextContent("0 %");
    expect(screen.getByTestId("gpu-power-0")).toHaveTextContent("13 / 350 W");
  });

  it("просадка PCIe видна как просадка: текущее значение рядом с максимальным", () => {
    renderCard({ pcie_gen_current: 1, pcie_gen_max: 3, pcie_width_current: 1, pcie_width_max: 16 });

    const pcie = screen.getByTestId("gpu-pcie-0");
    expect(pcie).toHaveTextContent("gen1 / gen3");
    expect(pcie).toHaveTextContent("x1 / x16");
  });

  it("не сообщённое поле помечено как «нет данных», а не показано нулём", () => {
    renderCard({ fan_speed_percent: null, power_limit_watts: null, pcie_rx_bytes_per_sec: null });

    expect(screen.getByTestId("gpu-fan-0")).toHaveTextContent("н/д");
    expect(screen.getByTestId("gpu-fan-0")).not.toHaveTextContent("0 %");
    expect(screen.getByTestId("gpu-power-0")).toHaveTextContent("н/д");
    expect(screen.getByTestId("gpu-throughput-0")).toHaveTextContent("н/д");
  });

  it("законный ноль остаётся нулём", () => {
    renderCard({ fan_speed_percent: 0, pcie_rx_bytes_per_sec: 0 });

    expect(screen.getByTestId("gpu-fan-0")).toHaveTextContent("0 %");
    expect(screen.getByTestId("gpu-throughput-0")).toHaveTextContent("0 B/s");
  });
});

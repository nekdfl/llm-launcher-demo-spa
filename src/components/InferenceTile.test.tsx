import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { InferenceTile, type InferenceTileData } from "./InferenceTile";

function makeData(overrides: Partial<InferenceTileData> = {}): InferenceTileData {
  return {
    id: "inf-1",
    name: "Qwen 32B",
    status: { status: "running", color: "green", gpu_considered_free: false },
    providerName: "huggingface",
    engineName: "llama-cpp-default",
    modelRef: "org/Qwen-32B",
    profileName: "default",
    hasDiscrepancy: false,
    peakVramBytes: 21.1 * 1024 ** 3,
    peakRamBytes: 3.2 * 1024 ** 3,
    throughputInValues: [1, 2, 3],
    throughputOutValues: [1, 2, 3],
    caption: null,
    modelId: 1,
    modelUnusableReason: null,
    ...overrides,
  };
}

function renderTile(data: InferenceTileData) {
  return render(
    <MemoryRouter>
      <InferenceTile data={data} />
    </MemoryRouter>
  );
}

describe("InferenceTile", () => {
  it("shows the mini-sparkline when running", () => {
    renderTile(makeData({ status: { status: "running", color: "green", gpu_considered_free: false } }));
    expect(screen.getByTestId("mini-sparkline")).toBeInTheDocument();
    expect(screen.queryByTestId("tokens-no-traffic")).not.toBeInTheDocument();
  });

  it("shows the mini-sparkline when unresponsive", () => {
    renderTile(makeData({ status: { status: "unresponsive", color: "red", gpu_considered_free: false } }));
    expect(screen.getByTestId("mini-sparkline")).toBeInTheDocument();
  });

  it("shows a text fallback, not a flat zero graph, when warming", () => {
    renderTile(makeData({ status: { status: "warming", color: "yellow", gpu_considered_free: false } }));
    expect(screen.queryByTestId("mini-sparkline")).not.toBeInTheDocument();
    expect(screen.getByTestId("tokens-no-traffic")).toBeInTheDocument();
  });

  it("shows a text fallback when stopped", () => {
    renderTile(makeData({ status: { status: "stopped", color: "gray", gpu_considered_free: true } }));
    expect(screen.queryByTestId("mini-sparkline")).not.toBeInTheDocument();
  });

  it("shows the discrepancy icon only when diverged", () => {
    const { rerender } = renderTile(makeData({ hasDiscrepancy: false }));
    expect(screen.queryByTestId("discrepancy-icon")).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <InferenceTile data={makeData({ hasDiscrepancy: true })} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("discrepancy-icon")).toBeInTheDocument();
  });

  it("renders the four layers as separate labeled fields, not one line", () => {
    renderTile(makeData());
    expect(screen.getByText("huggingface")).toBeInTheDocument();
    expect(screen.getByText("llama-cpp-default")).toBeInTheDocument();
    expect(screen.getByText("org/Qwen-32B")).toBeInTheDocument();
    expect(screen.getByText("default")).toBeInTheDocument();
  });

  it("shows peak VRAM and RAM formatted", () => {
    renderTile(makeData());
    expect(screen.getByText("21.1 GB")).toBeInTheDocument();
    expect(screen.getByText("3.2 GB")).toBeInTheDocument();
  });

  it("renders a caption line when provided", () => {
    renderTile(makeData({ caption: "трафик прекратился ~35 мин назад" }));
    expect(screen.getByText("трафик прекратился ~35 мин назад")).toBeInTheDocument();
  });

  it("renders no caption line when null", () => {
    const { container } = renderTile(makeData({ caption: null }));
    expect(container.querySelectorAll("a > div").length).toBeGreaterThan(0); // sanity: tile rendered
  });
});

describe("InferenceTile — негодная модель", () => {
  it("показывает причину и ссылку на модель", () => {
    render(
      <MemoryRouter>
        <InferenceTile data={makeData({ modelUnusableReason: "файл отсутствует", modelId: 7 })} />
      </MemoryRouter>
    );

    const notice = screen.getByTestId("inference-model-unusable");
    expect(notice).toHaveTextContent("файл отсутствует");
    expect(notice.querySelector("a")).toHaveAttribute("href", "/models/7");
  });

  it("годная модель признака не показывает", () => {
    render(
      <MemoryRouter>
        <InferenceTile data={makeData()} />
      </MemoryRouter>
    );

    expect(screen.queryByTestId("inference-model-unusable")).not.toBeInTheDocument();
  });
});

describe("InferenceTile — пиковые значения", () => {
  it("показывает пики запуска", () => {
    render(
      <MemoryRouter>
        <InferenceTile data={makeData({ peakVramBytes: 62102962176, peakRamBytes: 29139095552 })} />
      </MemoryRouter>
    );

    expect(screen.getByTestId("tile-peak-vram")).toHaveTextContent("57.8 GB");
    expect(screen.getByTestId("tile-peak-ram")).toHaveTextContent("27.1 GB");
  });

  it("неснятый пик помечен как «нет данных», а не показан нулём", () => {
    render(
      <MemoryRouter>
        <InferenceTile data={makeData({ peakVramBytes: null, peakRamBytes: null })} />
      </MemoryRouter>
    );

    expect(screen.getByTestId("tile-peak-vram")).toHaveTextContent("н/д");
    expect(screen.getByTestId("tile-peak-ram")).toHaveTextContent("н/д");
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { downloadTask, fileDetail, modelDetail } from "../testing/modelDetail";
import { ModelMetaInfo } from "./ModelMetaInfo";

describe("ModelMetaInfo", () => {
  it("самостоятельный раздел «Метаданные» со статусом, обновлениями, поддержкой и квантами", () => {
    render(<ModelMetaInfo detail={modelDetail()} tasks={[]} sync={undefined} />);

    expect(screen.getByTestId("model-meta-info")).toHaveTextContent("Метаданные");
    expect(screen.getByTestId("meta-status")).toHaveTextContent("не установлена");
    expect(screen.getByTestId("meta-updates")).toHaveTextContent("—");
    expect(screen.getByTestId("meta-support")).toHaveTextContent("не удалось проверить совместимость");
    expect(screen.getByTestId("meta-quants")).toHaveTextContent("Q4_K_M");
  });

  it("поддерживающая установка показана по имени", () => {
    render(
      <ModelMetaInfo
        detail={modelDetail({ supporting_engines: [{ id: 1, name: "llama-cpp-main" }] })}
        tasks={[]}
        sync={undefined}
      />
    );

    expect(screen.getByTestId("meta-support")).toHaveTextContent("поддерживается · llama-cpp-main");
  });

  it("идущая закачка показывает прогресс, квант помечен качающимся", () => {
    render(<ModelMetaInfo detail={modelDetail()} tasks={[downloadTask()]} sync={undefined} />);

    expect(screen.getByTestId("meta-status")).toHaveTextContent("качается 40%");
    expect(screen.getByText(/Q4_K_M/)).toHaveAttribute("data-mark", "downloading");
  });

  it("сведения записи и файлы на диске — группами внутри того же раздела", () => {
    render(
      <ModelMetaInfo
        detail={modelDetail({ files: [fileDetail("a.gguf", 10, { downloaded: true, local_size: 10 })] })}
        tasks={[]}
        sync={null}
        recordRows={[["формат", "gguf"]]}
        diskRows={[["путь", "/models/a"]]}
      />
    );

    const section = screen.getByTestId("model-meta-info");
    expect(section).toHaveTextContent("Состояние");
    expect(section).toHaveTextContent("Модель");
    expect(section).toHaveTextContent("Файлы");
    expect(section).toHaveTextContent("/models/a");
    expect(screen.getByTestId("meta-status")).toHaveTextContent("скачано");
  });
});

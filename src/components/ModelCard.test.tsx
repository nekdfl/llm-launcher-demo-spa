import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { downloadTask, fileDetail, modelDetail } from "../testing/modelDetail";
import { ModelCard } from "./ModelCard";

const DETAIL = modelDetail();
const noop = () => {};
const card = (props: Partial<Parameters<typeof ModelCard>[0]> = {}) => (
  <ModelCard detail={DETAIL} tasks={[]} onDownloadFiles={noop} onUpdateFile={noop} {...props} />
);

describe("ModelCard", () => {
  it("самостоятельный раздел «Карточка модели»: описание, суммарный объём, файлы", () => {
    render(card());

    expect(screen.getByTestId("model-card")).toHaveTextContent("Карточка модели");
    expect(screen.getByText("Пример описания модели")).toBeInTheDocument();
    expect(screen.getByText(/Суммарный занимаемый объём/)).toBeInTheDocument();
    expect(screen.getByTestId("file-row-model.Q4_K_M.gguf")).toBeInTheDocument();
    expect(screen.queryByText("Закрыть")).not.toBeInTheDocument();
    expect(screen.queryByText(/VRAM/)).not.toBeInTheDocument();
  });

  it("shows a source link to the provider's model page when source_url is set", () => {
    const detail = { ...DETAIL, source_url: "https://huggingface.co/org/model" };
    render(card({ detail }));

    const link = screen.getByRole("link", { name: "https://huggingface.co/org/model" });
    expect(link).toHaveAttribute("href", "https://huggingface.co/org/model");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByTestId("model-source-url")).toBeInTheDocument();
  });

  it("omits the source link when source_url is null", () => {
    render(card());

    expect(screen.queryByTestId("model-source-url")).not.toBeInTheDocument();
  });

  it("shows a loading state", () => {
    render(card({ detail: null, loading: true }));

    expect(screen.getByTestId("detail-loading")).toHaveTextContent("Обновляю данные…");
    expect(screen.queryByTestId("detail-unavailable")).not.toBeInTheDocument();
  });

  it("пока идёт загрузка, «Нет данных» не показывается даже без деталей", () => {
    render(card({ detail: null, loading: true }));

    expect(screen.queryByText("Нет данных")).not.toBeInTheDocument();
    expect(screen.getByTestId("detail-loading").querySelector(".animate-spin")).not.toBeNull();
  });

  it("после ошибки — «Нет данных» и «Повторить»", async () => {
    const onRetry = vi.fn();
    render(card({ detail: null, onRetry }));

    expect(screen.getByTestId("detail-unavailable")).toHaveTextContent("Нет данных");
    await userEvent.click(screen.getByTestId("detail-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("uses a custom testId when given", () => {
    render(card({ testId: "model-detail-panel" }));

    expect(screen.getByTestId("model-detail-panel")).toBeInTheDocument();
  });

  it("renders Markdown as formatted elements, not raw markup text", () => {
    const detail = { ...DETAIL, description: "# Заголовок\n\nтекст и [ссылка](https://example.com)" };
    const { container } = render(card({ detail }));

    // Link becomes an <a>, not literal "[ссылка](...)" text.
    const link = screen.getByRole("link", { name: "ссылка" });
    expect(link).toHaveAttribute("href", "https://example.com");
    // Heading text present without the leading "#".
    expect(screen.getByText("Заголовок")).toBeInTheDocument();
    expect(container.textContent).not.toContain("# Заголовок");
    expect(container.textContent).not.toContain("[ссылка]");
  });

  it("sanitizes dangerous HTML from the README (no script executed/rendered)", () => {
    const detail = {
      ...DETAIL,
      description: "безопасно <script>window.__xss=1</script> <img src=x onerror=\"window.__xss=1\" />",
    };
    const { container } = render(card({ detail }));

    expect(container.querySelector("script")).toBeNull();
    const img = container.querySelector("img");
    if (img) expect(img.getAttribute("onerror")).toBeNull();
    expect(screen.getByText(/безопасно/)).toBeInTheDocument();
  });

  it("does not wrap the description in its own scroll area", () => {
    const { container } = render(card());

    expect(container.querySelector(".overflow-y-auto")).toBeNull();
    expect(container.querySelector(".max-h-40")).toBeNull();
  });
});

describe("ModelCard — список файлов в узком окне", () => {
  it("список файлов лежит в контейнере с горизонтальной прокруткой", () => {
    const { container } = render(card());

    const scroller = container.querySelector("[data-testid='files-table-scroll']");
    expect(scroller).not.toBeNull();
    expect(scroller!.className).toContain("overflow-x-auto");
    expect(scroller!.querySelector("table")).not.toBeNull();
  });
});

describe("ModelCard — «Скачать» у суммарного объёма и действия файлов", () => {
  const partial = modelDetail({
    files: [
      fileDetail("model.Q4_K_M.gguf", 10, { downloaded: true, local_size: 10 }),
      fileDetail("model.Q8_0.gguf", 20),
      fileDetail("README.md", 1),
    ],
  });

  it("одна «Скачать» ставит на закачку все нескачанные файлы", async () => {
    const onDownloadFiles = vi.fn();
    render(card({ detail: partial, onDownloadFiles }));

    await userEvent.click(screen.getByTestId("download-full-repo"));

    expect(onDownloadFiles).toHaveBeenCalledWith([partial.files[1], partial.files[2]]);
    expect(screen.getAllByTestId("download-full-repo")).toHaveLength(1);
  });

  it("у нескачанного файла — «Скачать» одного файла, у скачанного — пометка", async () => {
    const onDownloadFiles = vi.fn();
    render(card({ detail: partial, onDownloadFiles }));

    expect(screen.getByTestId("file-row-model.Q4_K_M.gguf")).toHaveTextContent("скачано");
    await userEvent.click(screen.getByTestId("download-file-README.md"));

    expect(onDownloadFiles).toHaveBeenCalledWith([partial.files[2]]);
  });

  it("изменённый в репозитории файл предлагает «Обновить»", async () => {
    const onUpdateFile = vi.fn();
    render(
      card({
        detail: partial,
        onUpdateFile,
        sync: {
          has_updates: true,
          content_verified: true,
          missing_count: 0,
          changed_count: 1,
          extra_count: 0,
          files: [{ filename: "model.Q4_K_M.gguf", state: "changed", remote_size: 11, local_size: 10, content_verified: true }],
        },
      })
    );

    await userEvent.click(screen.getByTestId("update-file-model.Q4_K_M.gguf"));

    expect(onUpdateFile).toHaveBeenCalledWith("model.Q4_K_M.gguf");
  });

  it("модель в очереди — вместо «Скачать» её состояние, у файлов кнопок нет", () => {
    render(card({ detail: partial, tasks: [downloadTask({ status: "queued" })] }));

    expect(screen.queryByTestId("download-full-repo")).not.toBeInTheDocument();
    expect(screen.getByTestId("repo-task-state")).toHaveTextContent("в очереди");
    expect(screen.queryByTestId("download-file-README.md")).not.toBeInTheDocument();
    expect(screen.getByTestId("file-row-README.md")).toHaveTextContent("в очереди");
  });

  it("скачанная модель «Скачать» не предлагает", () => {
    render(card({ detail: modelDetail({ files: [fileDetail("a.gguf", 1, { downloaded: true, local_size: 1 })] }) }));

    expect(screen.queryByTestId("download-full-repo")).not.toBeInTheDocument();
  });

  it("репозиторий без GGUF скачивается так же — по списку файлов", () => {
    render(
      card({
        detail: modelDetail({
          repo_format: null,
          variants: [],
          files: [fileDetail("qwen3_8_27b.ninfer", 20), fileDetail("LICENSE", 1)],
        }),
      })
    );

    expect(screen.getByTestId("download-full-repo")).toBeInTheDocument();
    expect(screen.getByTestId("download-file-qwen3_8_27b.ninfer")).toBeInTheDocument();
  });

  it("пустой репозиторий — сообщение, без «Скачать»", () => {
    render(card({ detail: modelDetail({ files: [] }) }));

    expect(screen.getByText("В репозитории нет файлов.")).toBeInTheDocument();
    expect(screen.queryByTestId("download-full-repo")).not.toBeInTheDocument();
  });
});

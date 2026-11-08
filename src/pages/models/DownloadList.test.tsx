import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadList } from "./ModelDownloadsPage";
import { orchestratorApi } from "../../api/orchestrator";
import { fileDetail, modelDetail } from "../../testing/modelDetail";

vi.mock("../../api/orchestrator", () => ({
  orchestratorApi: {
    getDownloadStats: vi.fn().mockResolvedValue({
      active_count: 0,
      completed_count: 0,
      models_count: 0,
      free_bytes: 0,
      remaining_bytes: 0,
      speed_bytes_per_sec: null,
      eta_active_seconds: null,
      eta_all_seconds: null,
      active_etas: {},
    }),
    getDownloadProgress: vi.fn(),
    cancelDownload: vi.fn(),
    deleteDownload: vi.fn(),
    pauseDownload: vi.fn(),
    resumeDownload: vi.fn(),
    getModelDetail: vi.fn(),
    createDownload: vi.fn(),
    refreshModelVariant: vi.fn(),
    getRepoSync: vi.fn(),
    reorderDownloads: vi.fn(),
  },
}));

const mockedDelete = vi.mocked(orchestratorApi.deleteDownload);
const mockedCancel = vi.mocked(orchestratorApi.cancelDownload);
const mockedPause = vi.mocked(orchestratorApi.pauseDownload);
const mockedResume = vi.mocked(orchestratorApi.resumeDownload);
const mockedProgress = vi.mocked(orchestratorApi.getDownloadProgress);
const mockedModelDetail = vi.mocked(orchestratorApi.getModelDetail);

beforeEach(() => {
  mockedDelete.mockReset().mockResolvedValue(undefined);
  mockedCancel.mockReset().mockResolvedValue(terminalDownload("cancelled"));
  mockedPause.mockReset().mockResolvedValue({ ...terminalDownload("completed"), status: "paused" });
  mockedResume.mockReset().mockResolvedValue({ ...terminalDownload("completed"), status: "queued" });
  mockedProgress.mockReset().mockResolvedValue({ downloaded_bytes: 0, total_bytes: 1000, percent: 0 });
  mockedModelDetail.mockReset().mockResolvedValue(
    modelDetail({
      description: "описание",
      files: [fileDetail("model.gguf", 1000)],
      variants: [
        {
          filename: "model.gguf",
          quant_label: "Q4_K_M",
          size: 1000,
          downloaded: false,
          local_size: null,
          disk_sufficient: true,
          estimated_vram_bytes: 2000,
        },
      ],
    })
  );
});

function terminalDownload(status: "completed" | "cancelled" | "paused", id = "dl-1") {
  return {
    id,
    provider_id: 1,
    // Репозиторий свой у каждой задачи: плитка — на репозиторий, и
    // задачи одного репозитория показываются одной плиткой.
    model_ref: id === "dl-1" ? "org/model" : `org/${id}`,
    target_dir: "/models/org/model",
    status,
    downloaded_bytes: 1024,
    total_bytes: 1024,
    error_message: status === "paused" ? "boom" : null,
    file_names: null as string[] | null,
  };
}

describe("DownloadList — delete button for terminal downloads (was missing entirely)", () => {
  it("shows 'Скрыть' for a completed download and calls deleteDownload (keeps files)", async () => {
    const onChanged = vi.fn();
    render(<DownloadList downloads={[terminalDownload("completed")]} onChanged={onChanged} />);

    expect(screen.getByText("Скрыть")).toBeInTheDocument();
    expect(screen.queryByText("Удалить запись")).not.toBeInTheDocument();
    expect(screen.queryByText("Отменить")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByText("Скрыть"));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith("dl-1"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("shows 'Отменить', not 'Удалить запись', for an active download", async () => {
    render(
      <DownloadList
        downloads={[{ ...terminalDownload("completed"), status: "active", downloaded_bytes: 100, total_bytes: 1000 }]}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByText("Отменить")).toBeInTheDocument();
    expect(screen.queryByText("Удалить запись")).not.toBeInTheDocument();
  });

  it("shows 'Удалить запись' for failed and cancelled downloads too", () => {
    render(
      <DownloadList
        downloads={[
          terminalDownload("paused", "dl-failed"),
          terminalDownload("cancelled", "dl-cancelled"),
        ]}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getAllByText("Удалить запись")).toHaveLength(2);
  });

  it("для остановленной ошибкой задачи показывает «Возобновить» и «Удалить запись»", async () => {
    const onChanged = vi.fn();
    render(<DownloadList downloads={[terminalDownload("paused", "dl-error")]} onChanged={onChanged} />);

    await userEvent.click(screen.getByText("Возобновить"));

    await waitFor(() => expect(mockedResume).toHaveBeenCalledWith("dl-error"));
    expect(screen.getByText("Удалить запись")).toBeInTheDocument();
    expect(screen.queryByText("Повторить")).not.toBeInTheDocument();
    expect(screen.queryByText("Пауза")).not.toBeInTheDocument();
  });

});

describe("DownloadList — reorder queued downloads by drag and drop", () => {
  const mockedReorder = vi.mocked(orchestratorApi.reorderDownloads);

  function queued(id: string) {
    return {
      ...terminalDownload("completed", id),
      status: "queued",
      downloaded_bytes: 0,
      total_bytes: 1000,
    };
  }

  it("активные (загрузка и очередь) перетаскиваются, пауза и терминальные — нет", () => {
    render(
      <DownloadList
        downloads={[
          queued("q1"),
          { ...queued("p1"), status: "paused" as const },
          { ...queued("a1"), status: "active" as const },
          terminalDownload("completed", "c1"),
        ]}
        onChanged={vi.fn()}
      />
    );
    // Three draggable wrappers (active + queued + paused), not the completed one.
    expect(screen.getAllByTestId("download-row-draggable")).toHaveLength(2);  // пауза не перетаскивается
  });

  it("dragging an active row onto a queued one reorders them", async () => {
    mockedReorder.mockResolvedValue([]);
    const onChanged = vi.fn();
    render(
      <DownloadList downloads={[{ ...queued("a1"), status: "active" as const }, queued("q1")]} onChanged={onChanged} />
    );

    const rows = screen.getAllByTestId("download-row-draggable");
    fireEvent.dragStart(rows[1]); // queued
    fireEvent.drop(rows[0]); // onto active

    await waitFor(() => expect(mockedReorder).toHaveBeenCalledWith(["q1", "a1"]));
  });

  it("паузу перетащить нельзя — порядок активных не меняется", async () => {
    mockedReorder.mockResolvedValue([]);
    render(<DownloadList downloads={[queued("q1"), { ...queued("p1"), status: "paused" as const }]} onChanged={vi.fn()} />);

    const draggable = screen.getAllByTestId("download-row-draggable");

    expect(draggable).toHaveLength(1);  // только ожидающая очереди
  });

  it("dragging one queued row onto another calls reorderDownloads with the new order", async () => {
    mockedReorder.mockResolvedValue([]);
    const onChanged = vi.fn();
    render(<DownloadList downloads={[queued("q1"), queued("q2")]} onChanged={onChanged} />);

    const rows = screen.getAllByTestId("download-row-draggable");
    fireEvent.dragStart(rows[0]);
    fireEvent.drop(rows[1]);

    await waitFor(() => expect(mockedReorder).toHaveBeenCalledWith(["q2", "q1"]));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});

describe("DownloadList — pause and resume", () => {
  it("shows 'Пауза' for an active download and calls pauseDownload", async () => {
    const onChanged = vi.fn();
    render(
      <DownloadList
        downloads={[{ ...terminalDownload("completed"), status: "active", downloaded_bytes: 100, total_bytes: 1000 }]}
        onChanged={onChanged}
      />
    );

    expect(screen.getByText("Пауза")).toBeInTheDocument();
    expect(screen.queryByText("Продолжить")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByText("Пауза"));

    await waitFor(() => expect(mockedPause).toHaveBeenCalledWith("dl-1"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("shows 'Пауза' for a queued download and calls pauseDownload (download-pause-queued)", async () => {
    const onChanged = vi.fn();
    render(
      <DownloadList
        downloads={[{ ...terminalDownload("completed"), status: "queued", downloaded_bytes: 0, total_bytes: 1000 }]}
        onChanged={onChanged}
      />
    );

    expect(screen.getByText("Пауза")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByText("Пауза"));

    await waitFor(() => expect(mockedPause).toHaveBeenCalledWith("dl-1"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("у паузы — «Возобновить» без «Паузы» и «Отменить», вызывает resumeDownload", async () => {
    const onChanged = vi.fn();
    render(
      <DownloadList
        downloads={[{ ...terminalDownload("completed"), status: "paused", downloaded_bytes: 500, total_bytes: 1000 }]}
        onChanged={onChanged}
      />
    );

    expect(screen.getByText("Возобновить")).toBeInTheDocument();
    expect(screen.queryByText("Пауза")).not.toBeInTheDocument();
    expect(screen.queryByText("Удалить запись")).not.toBeInTheDocument();
    expect(screen.queryByText("Отменить")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByText("Возобновить"));

    await waitFor(() => expect(mockedResume).toHaveBeenCalledWith("dl-1"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("does not poll progress for a paused download", async () => {
    vi.useFakeTimers();
    try {
      render(
        <DownloadList
          downloads={[{ ...terminalDownload("completed"), status: "paused", downloaded_bytes: 500, total_bytes: 1000 }]}
          onChanged={vi.fn()}
        />
      );

      await vi.advanceTimersByTimeAsync(10_000);

      expect(mockedProgress).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DownloadList — progress precision and speed", () => {
  it("renders percent with two decimals (visible movement on a large model)", () => {
    render(
      <DownloadList
        downloads={[{ ...terminalDownload("completed"), status: "active", downloaded_bytes: 399, total_bytes: 10000 }]}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByText(/3\.99%/)).toBeInTheDocument();
  });

  it("shows the current download speed once bytes grow between two polls", async () => {
    vi.useFakeTimers();
    try {
      mockedProgress
        .mockResolvedValueOnce({ downloaded_bytes: 1_000_000, total_bytes: 100_000_000, percent: 1 })
        .mockResolvedValueOnce({ downloaded_bytes: 5_000_000, total_bytes: 100_000_000, percent: 5 });
      render(
        <DownloadList
          downloads={[{ ...terminalDownload("completed"), status: "active", downloaded_bytes: 0, total_bytes: 100_000_000 }]}
          onChanged={vi.fn()}
        />
      );

      await vi.advanceTimersByTimeAsync(2000); // tick 1: first sample, no speed yet
      await vi.advanceTimersByTimeAsync(2000); // tick 2: speed = (5M-1M)/2s

      expect(screen.getByText(/\/s/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("берёт скорость, измеренную воркером, и держит её, пока новое значение не пришло", async () => {
    vi.useFakeTimers();
    try {
      mockedProgress
        .mockReset()
        .mockResolvedValueOnce({ downloaded_bytes: 1_000_000, total_bytes: 100_000_000, percent: 1, speed_bytes_per_sec: 2 * 1024 * 1024 })
        .mockRejectedValueOnce(new Error("503"))
        .mockResolvedValue({ downloaded_bytes: 5_000_000, total_bytes: 100_000_000, percent: 5, speed_bytes_per_sec: null });
      render(
        <DownloadList
          downloads={[{ ...terminalDownload("completed"), status: "active", downloaded_bytes: 0, total_bytes: 100_000_000 }]}
          onChanged={vi.fn()}
        />
      );

      // Первый же опрос показывает скорость воркера — без ожидания второго.
      await vi.advanceTimersByTimeAsync(2000);
      expect(screen.getByText(/2(\.0)? MB\/s/)).toBeInTheDocument();

      // Сбой опроса и ответ без скорости — значение остаётся на месте.
      await vi.advanceTimersByTimeAsync(2000);
      expect(screen.getByText(/2(\.0)? MB\/s/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not show speed for a non-active (paused) download", () => {
    render(
      <DownloadList
        downloads={[{ ...terminalDownload("completed"), status: "paused", downloaded_bytes: 500, total_bytes: 1000 }]}
        onChanged={vi.fn()}
      />
    );

    expect(screen.queryByText(/\/s/)).not.toBeInTheDocument();
  });
});

describe("DownloadList — клик открывает карточку модели", () => {
  it("клик по строке загрузки открывает карточку модели (getModelDetail)", async () => {
    render(
      <DownloadList
        downloads={[{ ...terminalDownload("completed"), status: "active", downloaded_bytes: 100, total_bytes: 1000 }]}
        onChanged={vi.fn()}
      />
    );

    expect(screen.queryByTestId("model-card")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("download-row-toggle"));

    await waitFor(() => expect(mockedModelDetail).toHaveBeenCalledWith(1, "org/model"));
    const card = await screen.findByTestId("model-card");
    expect(within(within(card).getByTestId("files-table-scroll")).getByText("model.gguf")).toBeInTheDocument();
    expect(screen.getByTestId("launch-variants")).toHaveTextContent("Q4_K_M");
  });

  it("карточка не показана, пока по строке не кликнули (строка компактна)", () => {
    render(
      <DownloadList
        downloads={[{ ...terminalDownload("completed"), status: "active", downloaded_bytes: 100, total_bytes: 1000 }]}
        onChanged={vi.fn()}
      />
    );

    expect(screen.queryByTestId("model-card")).not.toBeInTheDocument();
  });
});

describe("DownloadList — status icon, drag handle, description toggle (download-tile-icons-handle-collapse)", () => {
  function row(status: string) {
    return { ...terminalDownload("completed"), status, downloaded_bytes: 100, total_bytes: 1000 };
  }

  it("shows a disk icon for a completed download", () => {
    render(<DownloadList downloads={[terminalDownload("completed")]} onChanged={vi.fn()} />);

    expect(screen.getByTestId("download-status-icon")).toHaveTextContent("hard_drive");
  });

  it("shows a network icon for an active download", () => {
    render(<DownloadList downloads={[row("active")]} onChanged={vi.fn()} />);

    expect(screen.getByTestId("download-status-icon")).toHaveTextContent("cloud_download");
  });

  it("shows the ETA on an active download from activeEtas", () => {
    render(<DownloadList downloads={[{ ...row("active"), id: "dl-1" }]} onChanged={vi.fn()} activeEtas={{ "dl-1": 125 }} />);

    expect(screen.getByTestId("download-eta")).toHaveTextContent("ETA");
    expect(screen.getByTestId("download-eta")).toHaveTextContent(/2м/);
  });

  it("shows no ETA for a non-active download", () => {
    render(<DownloadList downloads={[terminalDownload("completed", "dl-1")]} onChanged={vi.fn()} activeEtas={{ "dl-1": 125 }} />);

    expect(screen.queryByTestId("download-eta")).not.toBeInTheDocument();
  });

  it("shows a network icon for a queued download", () => {
    render(<DownloadList downloads={[{ ...row("queued"), downloaded_bytes: 0 }]} onChanged={vi.fn()} />);

    expect(screen.getByTestId("download-status-icon")).toHaveTextContent("cloud_download");
  });

  it("shows a network icon for a paused download", () => {
    render(<DownloadList downloads={[{ ...row("paused"), downloaded_bytes: 500 }]} onChanged={vi.fn()} />);

    expect(screen.getByTestId("download-status-icon")).toHaveTextContent("cloud_download");
  });

  it("ручка перетаскивания — у активных задач, не у паузы и терминальных", () => {
    render(
      <DownloadList
        downloads={[
          { ...row("active"), id: "a1", model_ref: "org/a1" },
          { ...row("queued"), id: "q1", model_ref: "org/q1", downloaded_bytes: 0 },
          { ...row("paused"), id: "p1", model_ref: "org/p1", downloaded_bytes: 500 },
          terminalDownload("completed", "c1"),
        ]}
        onChanged={vi.fn()}
      />
    );

    // Ручка у загрузки и очереди, не у паузы и не у завершённой.
    expect(screen.getAllByTestId("download-drag-handle")).toHaveLength(2);
  });

  it("shows 'Удалить запись' (not 'Скрыть') for failed and cancelled downloads", () => {
    render(
      <DownloadList
        downloads={[
          terminalDownload("paused", "f1"),
          terminalDownload("cancelled", "x1"),
        ]}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getAllByText("Удалить запись")).toHaveLength(2);
    expect(screen.queryByText("Скрыть")).not.toBeInTheDocument();
  });

  it("collapses the description by default and toggles it with the chevron", async () => {
    render(<DownloadList downloads={[row("active")]} onChanged={vi.fn()} />);

    const toggle = screen.getByTestId("download-description-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("chevron_right");
    expect(screen.queryByTestId("model-card")).not.toBeInTheDocument();

    await userEvent.click(toggle);

    expect(await screen.findByTestId("model-card")).toBeInTheDocument();
    expect(screen.getByTestId("download-description-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("download-description-toggle")).toHaveTextContent("expand_more");

    await userEvent.click(screen.getByTestId("download-description-toggle"));
    expect(screen.queryByTestId("model-card")).not.toBeInTheDocument();
  });
});

describe("DownloadList — distinguishes a single-file download from a whole-repo download", () => {
  it("appends the filename for a single-file download", () => {
    render(
      <DownloadList downloads={[{ ...terminalDownload("completed"), file_names: ["model.Q4_K_M.gguf"] }]} onChanged={vi.fn()} />
    );

    expect(screen.getByText(/org\/model-model\.Q4_K_M\.gguf/)).toBeInTheDocument();
  });

  it("shows only model_ref for a whole-repo download (several files)", () => {
    render(
      <DownloadList
        downloads={[{ ...terminalDownload("completed"), file_names: ["config.json", "model.safetensors"] }]}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByText("org/model")).toBeInTheDocument();
  });

  it("shows only model_ref when file_names is null (download predating this feature)", () => {
    render(<DownloadList downloads={[terminalDownload("completed")]} onChanged={vi.fn()} />);

    expect(screen.getByText("org/model")).toBeInTheDocument();
  });
});

describe("DownloadList — карточка не предлагает повторную закачку (download-duplicate-guard)", () => {
  const activeVariantDownload = {
    ...terminalDownload("completed"),
    status: "active",
    downloaded_bytes: 100,
    total_bytes: 1000,
    file_names: ["model.gguf"] as string[] | null,
  };

  it("пока закачка модели не завершена, «Скачать» не предлагается ни модели, ни файлу", async () => {
    render(<DownloadList downloads={[activeVariantDownload]} onChanged={vi.fn()} />);

    await userEvent.click(screen.getByTestId("download-row-toggle"));
    await screen.findByTestId("model-card");

    await waitFor(() => expect(screen.getByTestId("file-row-model.gguf")).toHaveTextContent("качается"));
    expect(screen.queryByTestId("download-file-model.gguf")).not.toBeInTheDocument();
    expect(screen.queryByTestId("download-full-repo")).not.toBeInTheDocument();
    expect(vi.mocked(orchestratorApi.createDownload)).not.toHaveBeenCalled();
  });

  it("после завершившейся закачки файл снова можно скачать", async () => {
    render(<DownloadList downloads={[{ ...activeVariantDownload, status: "cancelled" }]} onChanged={vi.fn()} />);

    await userEvent.click(screen.getByTestId("download-row-toggle"));
    await screen.findByTestId("model-card");

    expect(await screen.findByTestId("download-file-model.gguf")).toBeEnabled();
  });
});

describe("DownloadList — плитка умещается в ширину окна", () => {
  const LONG_REF =
    "mradermacher/Mistral-Nemo-2407-12B-Instruct-Long-Repository-Name-GGUF";

  it("длинное имя репозитория сжимается и усекается, величины прогресса не выдавливаются", () => {
    const { container } = render(
      <DownloadList
        downloads={[
          {
            ...terminalDownload("completed"),
            model_ref: LONG_REF,
            status: "active",
            downloaded_bytes: 5_000_000_000,
            total_bytes: 20_000_000_000,
          },
        ]}
        onChanged={() => {}}
        activeEtas={{}}
      />
    );

    // Заголовок плитки переносится, а не выдавливает содержимое.
    const header = container.querySelector(".flex.flex-wrap.justify-between");
    expect(header).not.toBeNull();

    // Имя может сжиматься (min-w-0) и усекается, полное — в title.
    const nameCell = header!.querySelector("div.min-w-0 [title]") ?? header!.querySelector("div[title]");
    expect(nameCell).not.toBeNull();
    expect(nameCell!.getAttribute("title")).toContain(LONG_REF);
    expect(nameCell!.querySelector(".truncate")).not.toBeNull();
  });
});

describe("DownloadList — кнопки и порядок по статусу", () => {
  const row = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
    ...terminalDownload("completed"),
    id,
    status,
    error_message: null,
    ...extra,
  });

  it("у загружающейся и ожидающей — «Пауза» и «Отменить»", () => {
    render(
      <DownloadList
        downloads={[
          { ...row("a", "active"), model_ref: "org/a" },
          { ...row("q", "queued"), model_ref: "org/q" },
        ]}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getAllByText("Пауза")).toHaveLength(2);
    expect(screen.getAllByText("Отменить")).toHaveLength(2);
    expect(screen.queryByText("Возобновить")).not.toBeInTheDocument();
  });

  it("у паузы без ошибки — только «Возобновить»", () => {
    render(<DownloadList downloads={[row("p", "paused")]} onChanged={vi.fn()} />);

    expect(screen.getByText("Возобновить")).toBeInTheDocument();
    expect(screen.queryByText("Пауза")).not.toBeInTheDocument();
    expect(screen.queryByText("Удалить запись")).not.toBeInTheDocument();
  });

  it("пауза с ошибкой показывает значок ошибки и сообщение", () => {
    render(<DownloadList downloads={[row("e", "paused", { error_message: "сеть оборвалась" })]} onChanged={vi.fn()} />);

    expect(screen.getByTestId("download-status-icon")).toHaveTextContent("error");
    expect(screen.getByText("сеть оборвалась")).toBeInTheDocument();
    expect(screen.getByText("Удалить запись")).toBeInTheDocument();
  });

  it("имя задачи обновления помечено -update", () => {
    render(
      <DownloadList
        downloads={[
          row("u1", "queued", { kind: "update", model_ref: "org/multi", file_names: ["a.bin", "b.bin"] }),
          row("u2", "queued", { kind: "update", model_ref: "org/single", file_names: ["a.bin"] }),
        ]}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByText("org/multi-update")).toBeInTheDocument();
    expect(screen.getByText("org/single-update-a.bin")).toBeInTheDocument();
  });
});

describe("DownloadList — плитка на репозиторий", () => {
  const task = (id: string, extra: Record<string, unknown> = {}) => ({
    ...terminalDownload("completed", id),
    model_ref: "org/multi",
    status: "active",
    downloaded_bytes: 100,
    total_bytes: 1000,
    ...extra,
  });

  it("несколько закачек одного репозитория дают одну плитку с суммарным ходом", () => {
    render(<DownloadList downloads={[task("d1"), task("d2", { downloaded_bytes: 300 })]} onChanged={vi.fn()} />);

    expect(screen.getAllByText("org/multi")).toHaveLength(1);
    expect(screen.getAllByTestId("download-model-tile")).toHaveLength(1);
    // 400 из 2000 байт — 20%, а не два отдельных прогресса.
    expect(screen.getByText(/20\.00%/)).toBeInTheDocument();
    expect(screen.getByText(/задач: 2/)).toBeInTheDocument();
  });

  it("пауза на сгруппированной плитке останавливает закачки группы", async () => {
    const onChanged = vi.fn();
    render(<DownloadList downloads={[task("d1"), task("d2")]} onChanged={onChanged} />);

    await userEvent.click(screen.getByText("Пауза"));

    await waitFor(() => expect(mockedPause).toHaveBeenCalledTimes(2));
    expect(mockedPause).toHaveBeenCalledWith("d1");
    expect(mockedPause).toHaveBeenCalledWith("d2");
  });
});

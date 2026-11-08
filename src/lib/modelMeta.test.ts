import { describe, expect, it } from "vitest";
import type { RepoSyncReport } from "../api/types";
import { downloadTask, fileDetail, modelDetail } from "../testing/modelDetail";
import {
  downloadStatus,
  fileAction,
  modelTasks,
  repoAction,
  supportInfo,
  unfinishedTask,
  updatesLabel,
  variantMarks,
} from "./modelMeta";

const SYNC: RepoSyncReport = {
  has_updates: false,
  content_verified: true,
  missing_count: 0,
  changed_count: 0,
  extra_count: 0,
  files: [],
};

describe("downloadStatus", () => {
  it("активная закачка — «качается N%»", () => {
    expect(downloadStatus(modelDetail(), [downloadTask({ downloaded_bytes: 40, total_bytes: 100 })]).label).toBe(
      "качается 40%"
    );
  });

  it("приостановленная — «на паузе N%», ждущая — «в очереди»", () => {
    expect(downloadStatus(modelDetail(), [downloadTask({ status: "paused" })]).label).toBe("на паузе 40%");
    expect(downloadStatus(modelDetail(), [downloadTask({ status: "queued" })]).label).toBe("в очереди");
  });

  it("все файлы на диске — «скачано»", () => {
    const detail = modelDetail({ files: [fileDetail("a.gguf", 10, { downloaded: true, local_size: 10 })] });
    expect(downloadStatus(detail, []).label).toBe("скачано");
  });

  it("часть файлов на диске — «скачано частично N%»", () => {
    const detail = modelDetail({
      files: [fileDetail("a.gguf", 6, { downloaded: true, local_size: 6 }), fileDetail("b.gguf", 18)],
    });
    expect(downloadStatus(detail, []).label).toBe("скачано частично 25%");
  });

  it("на диске пусто, закачка уже была — «не скачано»", () => {
    expect(downloadStatus(modelDetail(), [downloadTask({ status: "cancelled" })]).label).toBe("не скачано");
  });

  it("на диске пусто и закачек не было — «не установлена»", () => {
    expect(downloadStatus(modelDetail(), []).label).toBe("не установлена");
  });
});

describe("updatesLabel", () => {
  const complete = modelDetail({ files: [fileDetail("a.gguf", 10, { downloaded: true, local_size: 10 })] });
  const partial = modelDetail({
    files: [fileDetail("a.gguf", 10, { downloaded: true, local_size: 10 }), fileDetail("b.gguf", 10)],
  });

  it("нескачанная модель — «—»", () => {
    expect(updatesLabel(modelDetail(), SYNC).label).toBe("—");
  });

  it("изменённый файл — «есть обновления», без расхождений — «актуально»", () => {
    expect(updatesLabel(complete, { ...SYNC, changed_count: 1 }).label).toBe("есть обновления");
    expect(updatesLabel(complete, SYNC).label).toBe("актуально");
  });

  it("у частично скачанной недостающие файлы — не обновление", () => {
    expect(updatesLabel(partial, { ...SYNC, missing_count: 1 }).label).toBe("актуально");
    expect(updatesLabel(complete, { ...SYNC, missing_count: 1 }).label).toBe("есть обновления");
  });

  it("сверка идёт или не удалась", () => {
    expect(updatesLabel(complete, undefined).label).toBe("проверяется…");
    expect(updatesLabel(complete, null).label).toBe("не удалось проверить");
  });
});

describe("supportInfo", () => {
  it("есть установка под формат — поддерживается с её именем", () => {
    expect(supportInfo(modelDetail({ supporting_engines: [{ id: 1, name: "llama-main" }] }))).toEqual({
      supported: true,
      engines: ["llama-main"],
    });
  });

  it("нет установки — не поддерживается", () => {
    expect(supportInfo(modelDetail()).supported).toBe(false);
  });
});

describe("variantMarks", () => {
  it("помечает скачанный, качающийся и нескачанный кванты", () => {
    const detail = modelDetail({
      variants: [
        { filename: "a.gguf", quant_label: "Q4_K_M", size: 1, downloaded: true, local_size: 1, disk_sufficient: true, estimated_vram_bytes: 1 },
        { filename: "b.gguf", quant_label: "Q5_K_M", size: 1, downloaded: false, local_size: null, disk_sufficient: true, estimated_vram_bytes: 1 },
        { filename: "c.gguf", quant_label: "Q8_0", size: 1, downloaded: false, local_size: null, disk_sufficient: true, estimated_vram_bytes: 1 },
      ],
    });
    expect(variantMarks(detail, [downloadTask({ file_names: ["b.gguf"] })])).toEqual([
      { label: "Q4_K_M", mark: "downloaded" },
      { label: "Q5_K_M", mark: "downloading" },
      { label: "Q8_0", mark: "absent" },
    ]);
  });
});

describe("fileAction", () => {
  const absent = fileDetail("a.gguf", 10);
  const present = fileDetail("a.gguf", 10, { downloaded: true, local_size: 10 });

  it("нескачанный файл без закачки — «Скачать»", () => {
    expect(fileAction(absent, undefined, undefined)).toEqual({ kind: "download" });
  });

  it("скачанный совпадающий — «скачано», изменённый — «Обновить»", () => {
    expect(fileAction(present, undefined, "same")).toEqual({ kind: "downloaded" });
    expect(fileAction(present, undefined, "changed")).toEqual({ kind: "update" });
  });

  it("при незавершённой закачке у нескачанного файла — её состояние, без «Скачать»", () => {
    expect(fileAction(absent, downloadTask({ status: "queued" }), undefined)).toEqual({ kind: "task", label: "в очереди" });
    expect(fileAction(present, downloadTask({ status: "queued" }), "same")).toEqual({ kind: "downloaded" });
  });
});

describe("repoAction", () => {
  it("«Скачать» берёт все нескачанные файлы", () => {
    const detail = modelDetail({
      files: [fileDetail("a.gguf", 1, { downloaded: true, local_size: 1 }), fileDetail("b.gguf", 2), fileDetail("README.md", 3)],
    });
    const action = repoAction(detail, undefined);
    expect(action.kind).toBe("download");
    expect(action.kind === "download" && action.files.map((file) => file.filename)).toEqual(["b.gguf", "README.md"]);
  });

  it("незавершённая закачка — её состояние; всё скачано или пусто — ничего", () => {
    expect(repoAction(modelDetail(), downloadTask({ status: "queued" }))).toEqual({ kind: "task", label: "в очереди" });
    expect(repoAction(modelDetail({ files: [fileDetail("a", 1, { downloaded: true, local_size: 1 })] }), undefined)).toEqual({
      kind: "none",
    });
    expect(repoAction(modelDetail({ files: [] }), undefined)).toEqual({ kind: "none" });
  });
});

describe("modelTasks / unfinishedTask", () => {
  it("берёт задачи именно этой модели и предпочитает активную", () => {
    const tasks = [
      downloadTask({ id: "q", status: "queued" }),
      downloadTask({ id: "a", status: "active" }),
      downloadTask({ id: "x", model_ref: "other/model" }),
      downloadTask({ id: "p", provider_id: 2 }),
    ];
    const mine = modelTasks(tasks, 1, "org/model");
    expect(mine.map((task) => task.id)).toEqual(["q", "a"]);
    expect(unfinishedTask(mine)?.id).toBe("a");
  });
});

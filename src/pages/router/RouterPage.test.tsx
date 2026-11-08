import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouterPage } from "./RouterPage";
import { orchestratorApi } from "../../api/orchestrator";
import { inferenceEntry } from "../../api/__fixtures__/inference";

vi.mock("../../api/orchestrator", () => ({
  orchestratorApi: {
    listApiKeys: vi.fn(),
    listRequestLog: vi.fn(),
    listInferences: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
  },
}));

const mockedListApiKeys = vi.mocked(orchestratorApi.listApiKeys);
const mockedListRequestLog = vi.mocked(orchestratorApi.listRequestLog);
const mockedListInferences = vi.mocked(orchestratorApi.listInferences);
const mockedCreateApiKey = vi.mocked(orchestratorApi.createApiKey);
const mockedRevokeApiKey = vi.mocked(orchestratorApi.revokeApiKey);
const mockedDeleteApiKey = vi.mocked(orchestratorApi.deleteApiKey);

const ACTIVE_KEY = {
  id: 5,
  key_prefix: "llm-xyz98765",
  owner_user_id: 1,
  owner_username: "admin",
  acl_inference_ids: [],
  created_at: "2026-10-06T00:00:00Z",
  expires_at: null,
  revoked_at: null,
};

const INFERENCES = [
  inferenceEntry({ id: "inf-1", slug: "model-a", name: "Model A", port: 20000 }),
  inferenceEntry({ id: "inf-2", slug: "model-b", name: "Model B", profile_id: 2, model_id: 2, port: 20001 }),
];

beforeEach(() => {
  mockedListApiKeys.mockReset().mockResolvedValue([]);
  mockedListRequestLog.mockReset().mockResolvedValue([]);
  mockedListInferences.mockReset().mockResolvedValue(INFERENCES);
  mockedRevokeApiKey.mockReset().mockResolvedValue(undefined);
  mockedDeleteApiKey.mockReset().mockResolvedValue(undefined);
  mockedCreateApiKey.mockReset().mockResolvedValue({
    id: 1,
    key_prefix: "llm-abcd1234",
    owner_user_id: 0,
    owner_username: "admin",
    acl_inference_ids: [],
    created_at: "2026-10-06T00:00:00Z",
    expires_at: null,
    revoked_at: null,
    key: "llm-raw-key",
  });
});

describe("RouterPage — создание API-ключа (ACL + срок действия)", () => {
  it("открывает форму и показывает чекбоксы по всем inference", async () => {
    render(<RouterPage />);

    await userEvent.click(await screen.findByText("Создать ключ"));

    expect(await screen.findByText("Model A")).toBeInTheDocument();
    expect(screen.getByText("Model B")).toBeInTheDocument();
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).not.toBeChecked();
    }
  });

  it("без отмеченных чекбоксов отправляет пустой ACL (доступ ко всем)", async () => {
    render(<RouterPage />);

    await userEvent.click(await screen.findByText("Создать ключ"));
    await screen.findByText("Model A");
    await userEvent.click(screen.getByText("Создать", { selector: "button" }));

    await waitFor(() => expect(mockedCreateApiKey).toHaveBeenCalledWith("admin", [], null));
  });

  it("отмеченный чекбокс попадает в ACL запроса", async () => {
    render(<RouterPage />);

    await userEvent.click(await screen.findByText("Создать ключ"));
    const modelACheckbox = (await screen.findByText("Model A")).closest("label")!.querySelector("input")!;
    await userEvent.click(modelACheckbox);
    await userEvent.click(screen.getByText("Создать", { selector: "button" }));

    await waitFor(() => expect(mockedCreateApiKey).toHaveBeenCalledWith("admin", ["inf-1"], null));
  });

  it("без выбранной даты подпись говорит «без ограничения»", async () => {
    render(<RouterPage />);

    await userEvent.click(await screen.findByText("Создать ключ"));

    expect(await screen.findByTestId("expiry-date-label")).toHaveTextContent("без ограничения");
  });

  it("выбор даты обновляет человекочитаемую подпись и уходит в запрос", async () => {
    render(<RouterPage />);

    await userEvent.click(await screen.findByText("Создать ключ"));
    const dateInput = await screen.findByTestId("expiry-date-input");
    await userEvent.type(dateInput, "2026-02-22");

    expect(screen.getByTestId("expiry-date-label")).toHaveTextContent("22 февраля 2026 года");

    await userEvent.click(screen.getByText("Создать", { selector: "button" }));

    await waitFor(() => expect(mockedCreateApiKey).toHaveBeenCalledWith("admin", [], "2026-02-22T00:00:00"));
  });
});

describe("RouterPage — отзыв ключа (подтверждение + исчезает из списка)", () => {
  it("клик «Отозвать» открывает диалог подтверждения, не отзывая сразу", async () => {
    mockedListApiKeys.mockResolvedValue([ACTIVE_KEY]);
    render(<RouterPage />);

    await userEvent.click(await screen.findByText("Отозвать"));

    expect(await screen.findByText("Вы действительно хотите отозвать ключ?")).toBeInTheDocument();
    expect(mockedRevokeApiKey).not.toHaveBeenCalled();
  });

  it("«Отмена» закрывает диалог без отзыва", async () => {
    mockedListApiKeys.mockResolvedValue([ACTIVE_KEY]);
    render(<RouterPage />);

    await userEvent.click(await screen.findByText("Отозвать"));
    await screen.findByText("Вы действительно хотите отозвать ключ?");
    await userEvent.click(screen.getByText("Отмена"));

    expect(mockedRevokeApiKey).not.toHaveBeenCalled();
    expect(screen.getByText("Отозвать")).toBeInTheDocument();
  });

  it("«Да, отозвать» вызывает revokeApiKey — ключ остаётся в списке со статусом «отозван»", async () => {
    mockedListApiKeys.mockResolvedValueOnce([ACTIVE_KEY]).mockResolvedValue([{ ...ACTIVE_KEY, revoked_at: "2026-10-06T10:00:00Z" }]);
    render(<RouterPage />);

    await userEvent.click(await screen.findByText("Отозвать"));
    await screen.findByText("Вы действительно хотите отозвать ключ?");
    await userEvent.click(screen.getByText("Да, отозвать"));

    await waitFor(() => expect(mockedRevokeApiKey).toHaveBeenCalledWith(5));
    await waitFor(() => expect(screen.queryByText("Отозвать")).not.toBeInTheDocument());
    expect(await screen.findByText("отозван")).toBeInTheDocument();
    expect(screen.getByText("Удалить")).toBeInTheDocument();
  });

  it("уже отозванный ключ показывается в списке со статусом «отозван», без кнопки «Отозвать»", async () => {
    mockedListApiKeys.mockResolvedValue([{ ...ACTIVE_KEY, revoked_at: "2026-10-05T00:00:00Z" }]);
    render(<RouterPage />);

    expect(await screen.findByText("отозван")).toBeInTheDocument();
    expect(screen.queryByText("Отозвать")).not.toBeInTheDocument();
    expect(screen.getByText("Удалить")).toBeInTheDocument();
  });
});

describe("RouterPage — удаление ключа (только для уже отозванных)", () => {
  const REVOKED_KEY = { ...ACTIVE_KEY, revoked_at: "2026-10-05T00:00:00Z" };

  it("активный ключ не показывает кнопку «Удалить»", async () => {
    mockedListApiKeys.mockResolvedValue([ACTIVE_KEY]);
    render(<RouterPage />);

    await screen.findByText("Отозвать");
    expect(screen.queryByText("Удалить")).not.toBeInTheDocument();
  });

  it("клик «Удалить» открывает диалог подтверждения, не удаляя сразу", async () => {
    mockedListApiKeys.mockResolvedValue([REVOKED_KEY]);
    render(<RouterPage />);

    await userEvent.click(await screen.findByText("Удалить"));

    expect(await screen.findByText("Удалить ключ безвозвратно?")).toBeInTheDocument();
    expect(mockedDeleteApiKey).not.toHaveBeenCalled();
  });

  it("«Отмена» закрывает диалог без удаления", async () => {
    mockedListApiKeys.mockResolvedValue([REVOKED_KEY]);
    render(<RouterPage />);

    await userEvent.click(await screen.findByText("Удалить"));
    await screen.findByText("Удалить ключ безвозвратно?");
    await userEvent.click(screen.getByText("Отмена"));

    expect(mockedDeleteApiKey).not.toHaveBeenCalled();
    expect(screen.getByText("Удалить")).toBeInTheDocument();
  });

  it("«Да, удалить» вызывает deleteApiKey и убирает ключ из списка", async () => {
    mockedListApiKeys.mockResolvedValueOnce([REVOKED_KEY]).mockResolvedValue([]);
    render(<RouterPage />);

    await userEvent.click(await screen.findByText("Удалить"));
    await screen.findByText("Удалить ключ безвозвратно?");
    await userEvent.click(screen.getByText("Да, удалить"));

    await waitFor(() => expect(mockedDeleteApiKey).toHaveBeenCalledWith(5));
    await waitFor(() => expect(screen.queryByText("Удалить")).not.toBeInTheDocument());
    expect(screen.getByText("Ключей пока нет.")).toBeInTheDocument();
  });
});

describe("RouterPage — модалка «Ключ создан»: отображение и копирование", () => {
  it("показывает значение ключа в модалке после создания", async () => {
    render(<RouterPage />);

    await userEvent.click(await screen.findByText("Создать ключ"));
    await screen.findByText("Model A");
    await userEvent.click(screen.getByText("Создать", { selector: "button" }));

    expect(await screen.findByText("llm-raw-key")).toBeInTheDocument();
  });

  it("кнопка копирования пишет значение ключа в буфер обмена", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<RouterPage />);
    await userEvent.click(await screen.findByText("Создать ключ"));
    await screen.findByText("Model A");
    await userEvent.click(screen.getByText("Создать", { selector: "button" }));
    await screen.findByText("llm-raw-key");

    await userEvent.click(screen.getByTestId("copy-key-button"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("llm-raw-key"));
    expect(await screen.findByText("Скопировано")).toBeInTheDocument();
  });

  it("без navigator.clipboard (plain HTTP) копирует через execCommand-фоллбек", async () => {
    // На стенде navigator.clipboard отсутствует (не undefined.writeText, а
    // весь clipboard undefined) при обращении по http:// на LAN IP — именно
    // это роняло кнопку копирования с "Cannot read properties of undefined
    // (reading 'writeText')" до фикса.
    Object.assign(navigator, { clipboard: undefined });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.assign(document, { execCommand });

    render(<RouterPage />);
    await userEvent.click(await screen.findByText("Создать ключ"));
    await screen.findByText("Model A");
    await userEvent.click(screen.getByText("Создать", { selector: "button" }));
    await screen.findByText("llm-raw-key");

    await userEvent.click(screen.getByTestId("copy-key-button"));

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
    expect(await screen.findByText("Скопировано")).toBeInTheDocument();
    expect(screen.queryByText(/Cannot read properties/)).not.toBeInTheDocument();
  });

  it("если execCommand отклонён браузером, ошибка видна внутри модалки «Ключ создан»", async () => {
    Object.assign(navigator, { clipboard: undefined });
    const execCommand = vi.fn().mockReturnValue(false);
    Object.assign(document, { execCommand });

    render(<RouterPage />);
    await userEvent.click(await screen.findByText("Создать ключ"));
    await screen.findByText("Model A");
    await userEvent.click(screen.getByText("Создать", { selector: "button" }));
    await screen.findByText("llm-raw-key");

    await userEvent.click(screen.getByTestId("copy-key-button"));

    const modal = await screen.findByTestId("created-key-modal");
    expect(await within(modal).findByText(/не удалось скопировать/i)).toBeInTheDocument();
  });
});

describe("RouterPage — журнал запросов", () => {
  it("время запроса рендерится из started_at, не «Invalid Date»", async () => {
    mockedListRequestLog.mockResolvedValue([
      {
        id: 1,
        api_key_id: 1,
        inference_id: "inf-1",
        started_at: "2026-10-06T09:17:19.622204",
        duration_ms: 218,
        tokens_in: 11,
        tokens_out: 10,
        status_code: 200,
      },
    ]);
    render(<RouterPage />);

    await screen.findByText("inf-1");
    expect(screen.queryByText("Invalid Date")).not.toBeInTheDocument();
  });
});

describe("RouterPage — ошибка создания ключа видна внутри модалки", () => {
  it("ошибка показывается внутри формы создания, а не только за её тёмным фоном", async () => {
    mockedCreateApiKey.mockRejectedValue(new Error("API error 401"));
    render(<RouterPage />);

    await userEvent.click(await screen.findByText("Создать ключ"));
    await screen.findByText("Model A");
    await userEvent.click(screen.getByText("Создать", { selector: "button" }));

    const modal = await screen.findByTestId("create-key-modal");
    // Not just present somewhere on the page (there's also a top-level
    // banner, now hidden behind the modal's own backdrop) — specifically
    // visible inside the still-open create-key modal itself.
    expect(modal).not.toHaveAttribute("hidden");
    expect(await within(modal).findByText("API error 401")).toBeInTheDocument();
  });
});

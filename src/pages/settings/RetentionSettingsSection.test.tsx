import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetentionSettingsSection } from "./RetentionSettingsSection";
import { orchestratorApi } from "../../api/orchestrator";

vi.mock("../../api/orchestrator", () => ({
  orchestratorApi: {
    getHistorySettings: vi.fn(),
    updateHistorySettings: vi.fn(),
    getRequestLogSettings: vi.fn(),
    updateRequestLogSettings: vi.fn(),
    getAuditSettings: vi.fn(),
    updateAuditSettings: vi.fn(),
    getMetricsSettings: vi.fn(),
    updateMetricsSettings: vi.fn(),
  },
}));

const mockedGetHistory = vi.mocked(orchestratorApi.getHistorySettings);
const mockedUpdateHistory = vi.mocked(orchestratorApi.updateHistorySettings);
const mockedGetRequestLog = vi.mocked(orchestratorApi.getRequestLogSettings);
const mockedUpdateRequestLog = vi.mocked(orchestratorApi.updateRequestLogSettings);
const mockedGetAudit = vi.mocked(orchestratorApi.getAuditSettings);
const mockedUpdateAudit = vi.mocked(orchestratorApi.updateAuditSettings);
const mockedGetMetrics = vi.mocked(orchestratorApi.getMetricsSettings);
const mockedUpdateMetrics = vi.mocked(orchestratorApi.updateMetricsSettings);
const METRICS_SETTINGS = { raw_retention_hours: 6, aggregate_retention_days: 30 };
const HISTORY_SETTINGS = {
  max_records_per_profile: 50,
  max_total_log_bytes: 1000000,
  max_log_age_days: 30,
  max_log_files: 50,
};

beforeEach(() => {
  mockedGetHistory.mockReset().mockResolvedValue(HISTORY_SETTINGS);
  mockedUpdateHistory.mockReset().mockResolvedValue(HISTORY_SETTINGS);
  mockedGetRequestLog.mockReset().mockResolvedValue({ max_records: 1000 });
  mockedUpdateRequestLog.mockReset().mockResolvedValue({ max_records: 1000 });
  mockedGetAudit.mockReset().mockResolvedValue({ max_records: 20000 });
  mockedUpdateAudit.mockReset().mockResolvedValue({ max_records: 20000 });
  mockedGetMetrics.mockReset().mockResolvedValue(METRICS_SETTINGS);
  mockedUpdateMetrics.mockReset().mockResolvedValue(METRICS_SETTINGS);
});

describe("RetentionSettingsSection (was never built — spec task 4.4 left undone)", () => {
  it("loads and displays all three retention policies", async () => {
    render(<RetentionSettingsSection />);

    await waitFor(() => expect(screen.getByDisplayValue("50")).toBeInTheDocument());
    expect(screen.getByDisplayValue("1000000")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1000")).toBeInTheDocument();
    expect(screen.getByDisplayValue("20000")).toBeInTheDocument();
  });

  it("показывает действующую политику хранения метрик", async () => {
    render(<RetentionSettingsSection />);

    await waitFor(() => expect(screen.getByTestId("metrics-raw-retention")).toHaveValue("6"));
    expect(screen.getByTestId("metrics-aggregate-retention")).toHaveValue("30");
  });

  it("сохраняет политику хранения метрик вместе с остальными", async () => {
    render(<RetentionSettingsSection />);
    await waitFor(() => expect(screen.getByTestId("metrics-raw-retention")).toHaveValue("6"));

    const user = userEvent.setup();
    const rawInput = screen.getByTestId("metrics-raw-retention");
    await user.clear(rawInput);
    await user.type(rawInput, "12");
    await user.click(screen.getByText("Сохранить"));

    await waitFor(() =>
      expect(mockedUpdateMetrics).toHaveBeenCalledWith({ raw_retention_hours: 12, aggregate_retention_days: 30 })
    );
  });

  it("saving sends all three updates with edited values", async () => {
    render(<RetentionSettingsSection />);
    await waitFor(() => expect(screen.getByDisplayValue("50")).toBeInTheDocument());

    const user = userEvent.setup();
    const historyInput = screen.getByDisplayValue("50");
    await user.clear(historyInput);
    await user.type(historyInput, "75");

    await user.click(screen.getByText("Сохранить"));

    await waitFor(() => expect(mockedUpdateHistory).toHaveBeenCalledWith({ max_records_per_profile: 75, max_total_log_bytes: 1000000 }));
    expect(mockedUpdateRequestLog).toHaveBeenCalledWith(1000);
    expect(mockedUpdateAudit).toHaveBeenCalledWith(20000);
    expect(await screen.findByText("Сохранено")).toBeInTheDocument();
  });
});

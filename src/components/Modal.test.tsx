import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("is hidden via the [hidden] attribute when closed (UI-BEHAVIOR §2)", () => {
    render(<Modal open={false} onClose={() => {}} title="Установить плагин" testId="modal" />);
    const container = screen.getByTestId("modal");
    expect(container).toHaveAttribute("hidden");
  });

  it("shows content when open", () => {
    render(
      <Modal open={true} onClose={() => {}} title="Сохранить как" testId="modal">
        <input data-testid="modal-content" />
      </Modal>
    );
    expect(screen.getByTestId("modal")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("modal-content")).toBeInTheDocument();
  });

  it("uses the danger tone for destructive confirmations", () => {
    render(<Modal open={true} onClose={() => {}} title="Удалить?" tone="danger" testId="modal" />);
    expect(screen.getByText("Удалить?").className).toContain("text-danger");
  });
});

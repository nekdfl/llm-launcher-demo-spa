import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Layout } from "./Layout";

vi.mock("../api/auth", () => ({ logout: vi.fn() }));

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Layout />
    </MemoryRouter>
  );
}

describe("Layout — сворачивание бокового меню", () => {
  it("по умолчанию развёрнуто: видны подписи разделов", () => {
    renderLayout();
    expect(screen.getByText("Модели")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "false");
  });

  it("клик сворачивает: подписи исчезают, иконки остаются", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByTestId("sidebar-toggle"));

    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
    expect(screen.queryByText("Модели")).not.toBeInTheDocument();
    // иконка раздела всё ещё на месте (ссылка сохраняется)
    expect(screen.getByRole("link", { name: "Модели" })).toBeInTheDocument();
  });

  it("повторный клик разворачивает обратно", async () => {
    const user = userEvent.setup();
    renderLayout();
    const toggle = screen.getByTestId("sidebar-toggle");

    await user.click(toggle);
    await user.click(toggle);

    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByText("Модели")).toBeInTheDocument();
  });

  it("состояние запоминается: сохранённое 'свёрнуто' применяется при старте", () => {
    localStorage.setItem("sidebar-collapsed", "1");
    renderLayout();
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
  });

  it("сворачивание пишется в localStorage", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByTestId("sidebar-toggle"));

    expect(localStorage.getItem("sidebar-collapsed")).toBe("1");
  });

  it("активный раздел выделен и в свёрнутом виде", async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByTestId("sidebar-toggle"));

    const dashboard = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboard.className).toContain("border-primary");
  });
});

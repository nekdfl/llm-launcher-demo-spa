import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ListCard, PageHeader, StatusBadge } from "./ui";

describe("ListCard", () => {
  it("renders as a link when `to` is given", () => {
    render(
      <MemoryRouter>
        <ListCard to="/profiles/1" accent="primary" title="qwen3-32b" meta="model · engine" badge={{ tone: "primary", label: "1 inference" }} />
      </MemoryRouter>
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/profiles/1");
    expect(screen.getByText("qwen3-32b")).toBeInTheDocument();
    expect(screen.getByText("1 inference")).toBeInTheDocument();
  });

  it("renders as a plain div when `to` is absent (некликабельный provider)", () => {
    render(
      <MemoryRouter>
        <ListCard accent="neutral" title="локальный каталог" />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("локальный каталог")).toBeInTheDocument();
  });

  it("applies the warn accent color inline", () => {
    render(
      <MemoryRouter>
        <ListCard accent="warn" title="needs review" />
      </MemoryRouter>
    );
    expect(screen.getByText("needs review").closest(".bg-surface-container-low")).toHaveStyle({ boxShadow: "inset 4px 0 0 0 #f1c100" });
  });
});

describe("StatusBadge", () => {
  it("renders the tone class", () => {
    render(<StatusBadge tone="danger">недоступна</StatusBadge>);
    expect(screen.getByText("недоступна").className).toContain("text-danger");
  });
});

describe("PageHeader", () => {
  it("shows a back link when backTo is given", () => {
    render(
      <MemoryRouter>
        <PageHeader backTo="/profiles" backLabel="Профили" title="Создание профиля" />
      </MemoryRouter>
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/profiles");
    expect(screen.getByText("Создание профиля")).toBeInTheDocument();
  });
});

describe("ListCard — действие внутри карточки-ссылки", () => {
  it("нажатие действия не открывает страницу карточки", async () => {
    const onAction = vi.fn();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <ListCard
                to="/models/1"
                accent="primary"
                title="org/model"
                action={
                  <button type="button" onClick={onAction} data-testid="card-action">
                    Обновить
                  </button>
                }
              />
            }
          />
          <Route path="/models/1" element={<div data-testid="model-page">страница модели</div>} />
        </Routes>
      </MemoryRouter>
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId("card-action"));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("model-page")).not.toBeInTheDocument();
  });

  it("клик по самой карточке по-прежнему ведёт на страницу", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ListCard to="/models/1" accent="primary" title="org/model" />} />
          <Route path="/models/1" element={<div data-testid="model-page">страница модели</div>} />
        </Routes>
      </MemoryRouter>
    );

    const user = userEvent.setup();
    await user.click(screen.getByText("org/model"));

    expect(await screen.findByTestId("model-page")).toBeInTheDocument();
  });
});

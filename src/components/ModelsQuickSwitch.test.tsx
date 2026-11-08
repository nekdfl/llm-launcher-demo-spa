import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ModelsQuickSwitch } from "./ModelsQuickSwitch";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/models/*" element={<ModelsQuickSwitch />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ModelsQuickSwitch", () => {
  it("показывает три кнопки с адресами страниц раздела", () => {
    renderAt("/models/search");

    expect(screen.getByText("Загрузка")).toHaveAttribute("href", "/models/downloads");
    expect(screen.getByText("Поиск")).toHaveAttribute("href", "/models/search");
    expect(screen.getByText("Скачанные")).toHaveAttribute("href", "/models/downloaded");
  });

  it("располагает кнопки в порядке «поиск, загрузка, скачанные»", () => {
    renderAt("/models/search");

    const labels = screen
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual(["Поиск", "Загрузка", "Скачанные"]);
  });

  it("помечает кнопку текущей страницы активной", () => {
    renderAt("/models/downloads");

    expect(screen.getByTestId("quick-switch-downloads")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("quick-switch-search")).not.toHaveAttribute("aria-current");
  });
});

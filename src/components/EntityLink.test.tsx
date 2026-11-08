import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { EntityLink } from "./EntityLink";

describe("EntityLink", () => {
  it("ведёт на страницу связанной сущности", () => {
    render(
      <MemoryRouter>
        <EntityLink label="Модель" name="org/Qwen-32B" to="/models/7" testId="model-link" />
      </MemoryRouter>
    );

    expect(screen.getByText("Модель")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "org/Qwen-32B" });
    expect(link).toHaveAttribute("href", "/models/7");
  });

  it("отсутствующая сущность показана пометкой без ссылки", () => {
    render(
      <MemoryRouter>
        <EntityLink label="Профиль" name={null} to={null} testId="profile-link" />
      </MemoryRouter>
    );

    expect(screen.getByTestId("profile-link-missing")).toHaveTextContent("не найдена");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("строка связи видна и без сущности", () => {
    render(
      <MemoryRouter>
        <EntityLink label="Модель" name={undefined} to="/models/1" testId="model-link" />
      </MemoryRouter>
    );

    expect(screen.getByText("Модель")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

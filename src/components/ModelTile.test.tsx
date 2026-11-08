import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ModelTile } from "./ModelTile";

function renderTile(props: Parameters<typeof ModelTile>[0]) {
  return render(
    <MemoryRouter>
      <ModelTile {...props} />
    </MemoryRouter>
  );
}

describe("ModelTile", () => {
  it("перечисляет кванты одной строкой в полученном порядке", () => {
    renderTile({ repoId: "org/repo", quants: ["IQ2_XS", "IQ3_S", "IQ3_XXS", "Q2_0"] });

    expect(screen.getByTestId("launch-variants")).toHaveTextContent("IQ2_XS IQ3_S IQ3_XXS Q2_0");
  });

  it("projector выводится отдельной группой после квантов", () => {
    renderTile({ repoId: "org/repo", quants: ["IQ3_XXS", "Q2_0"], features: ["mmproj"] });

    expect(screen.getByTestId("launch-variants")).toHaveTextContent("IQ3_XXS Q2_0 +mmproj");
  });

  it("репозиторий без квантов показывает только группу особенностей", () => {
    renderTile({ repoId: "org/repo", quants: [], features: ["mmproj"] });

    expect(screen.getByTestId("launch-variants")).toHaveTextContent("+mmproj");
  });

  it("без вариантов строка не рендерится", () => {
    renderTile({ repoId: "org/repo" });

    expect(screen.queryByTestId("launch-variants")).not.toBeInTheDocument();
  });

  it("полный перечень остаётся в подсказке усечённой строки", () => {
    renderTile({ repoId: "org/repo", quants: ["IQ2_XS", "IQ3_S"] });

    const line = screen.getByTestId("launch-variants");
    expect(line).toHaveAttribute("title", "IQ2_XS IQ3_S");
    expect(line.className).toContain("truncate");
  });

  it("действие раздела показывается вместо бейджа и не открывает ссылку", () => {
    renderTile({
      repoId: "org/repo",
      to: "/models/1",
      badge: { tone: "primary", label: "бейдж" },
      action: <button type="button">Обновить</button>,
    });

    expect(screen.getByTestId("model-tile-action")).toHaveTextContent("Обновить");
    expect(screen.queryByText("бейдж")).not.toBeInTheDocument();
  });
});

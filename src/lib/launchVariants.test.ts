import { describe, expect, it } from "vitest";
import { buildLaunchVariantsLine } from "./launchVariants";

describe("buildLaunchVariantsLine", () => {
  it("перечисляет кванты через пробел в полученном порядке", () => {
    expect(buildLaunchVariantsLine(["IQ2_XS", "IQ3_S", "IQ3_XXS", "Q2_0"]).text).toBe(
      "IQ2_XS IQ3_S IQ3_XXS Q2_0"
    );
  });

  it("единственный вариант — своя метка", () => {
    expect(buildLaunchVariantsLine(["IQ3_XXS"]).text).toBe("IQ3_XXS");
  });

  it("особенности идут отдельной группой после квантов", () => {
    expect(buildLaunchVariantsLine(["IQ3_XXS", "Q2_0"], ["mmproj"]).text).toBe("IQ3_XXS Q2_0 +mmproj");
  });

  it("без квантов показывает только группу особенностей", () => {
    expect(buildLaunchVariantsLine([], ["mmproj"]).text).toBe("+mmproj");
  });

  it("без особенностей признака группы нет", () => {
    expect(buildLaunchVariantsLine(["Q4_K_M"]).text).toBe("Q4_K_M");
  });

  it("повторы одного кванта не удваивают метку", () => {
    expect(buildLaunchVariantsLine(["IQ3_XXS", "IQ3_XXS"]).text).toBe("IQ3_XXS");
  });

  it("состав неизвестен — строка пуста", () => {
    expect(buildLaunchVariantsLine([]).text).toBe("");
  });
});

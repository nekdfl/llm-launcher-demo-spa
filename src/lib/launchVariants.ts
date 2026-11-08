/** Доступные варианты запуска модели одной строкой.
 *
 * Кванты взаимоисключающи — из них выбирают один, поэтому они идут
 * перечнем через пробел. Особенности применимы **вместе** с любым
 * квантом (projector движок получает через `--mmproj` дополнительно к
 * `-m`), поэтому они следуют за перечнем отдельной группой с префиксом
 * `+`: в одном ряду с квантами они читались бы как «или квант, или
 * projector», что неверно.
 *
 * Функция ничего не знает про шарды и имена файлов — варианты приходят
 * уже сгруппированными (оркестратор группирует их тем же правилом, что
 * применяет при регистрации). */
export interface LaunchVariantsLine {
  /** Пусто, когда состав вариантов неизвестен: строку в этом случае не
   * показывают вовсе — пустая строка утверждала бы «вариантов нет». */
  text: string;
  quants: string[];
  features: string[];
}

export function buildLaunchVariantsLine(quants: string[], features: string[] = []): LaunchVariantsLine {
  // Порядок приходит от оркестратора и устойчив; здесь только убираем
  // повторы, которые дают несколько записей одного кванта.
  const uniqueQuants = [...new Set(quants.filter((label) => label.length > 0))];
  const uniqueFeatures = [...new Set(features.filter((label) => label.length > 0))];
  const tokens = [...uniqueQuants, ...uniqueFeatures.map((label) => `+${label}`)];
  return { text: tokens.join(" "), quants: uniqueQuants, features: uniqueFeatures };
}

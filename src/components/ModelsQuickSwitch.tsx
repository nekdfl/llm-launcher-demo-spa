import { Link, useLocation } from "react-router-dom";

const PAGES = [
  { label: "Поиск", to: "/models/search" },
  { label: "Загрузка", to: "/models/downloads" },
  { label: "Скачанные", to: "/models/downloaded" },
];

/** Быстрый переход управления моделями: три страницы раздела. Запросов не
 * делает — только ссылки, поэтому его можно ставить куда угодно. Активная
 * страница определяется по адресу. */
export function ModelsQuickSwitch() {
  const { pathname } = useLocation();

  return (
    <div className="flex gap-2 mb-6" data-testid="models-quick-switch">
      {PAGES.map((page) => {
        const active = pathname === page.to;
        return (
          <Link
            key={page.to}
            to={page.to}
            aria-current={active ? "page" : undefined}
            data-testid={`quick-switch-${page.to.split("/").pop()}`}
            className={`px-4 py-2 border font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest ${
              active
                ? "border-primary text-primary bg-primary/10"
                : "border-neutral-800 text-neutral-400 hover:border-primary hover:text-primary"
            }`}
          >
            {page.label}
          </Link>
        );
      })}
    </div>
  );
}

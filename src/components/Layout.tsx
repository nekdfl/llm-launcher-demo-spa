import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { logout } from "../api/auth";

const NAV_ITEMS = [
  { to: "/", icon: "dashboard", label: "Dashboard" },
  { to: "/models", icon: "database", label: "Модели" },
  { to: "/profiles", icon: "tune", label: "Профили" },
  { to: "/engines", icon: "memory", label: "Движки" },
  { to: "/providers", icon: "cloud", label: "Провайдеры" },
  { to: "/plugins", icon: "extension", label: "Плагины" },
  { to: "/router", icon: "alt_route", label: "Роутер" },
  { to: "/settings", icon: "settings", label: "Настройки" },
];

const NAV_LINK_BASE =
  "flex items-center gap-4 px-4 py-3 font-['Space_Grotesk'] text-sm font-medium uppercase transition-all";
const NAV_LINK_ACTIVE = "text-primary bg-neutral-900 border-l-4 border-primary";
const NAV_LINK_INACTIVE = "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200";

const COLLAPSE_STORAGE_KEY = "sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mirrors reference/dashboard/code.html and reference/inference_detail/code.html's
 * shared header/sidebar/footer chrome. The sidebar collapses to an icon-only
 * rail (spa-navigation-sidebar) to free width on small screens; the choice is
 * remembered in localStorage. */
export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* storage unavailable (private mode) — state still applies this session */
    }
  }, [collapsed]);

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  // One source of truth for the rail width so aside, main and footer never
  // drift apart.
  const asideWidth = collapsed ? "w-16" : "w-56";
  const contentOffset = collapsed ? "ml-16" : "ml-56";
  const footerOffset = collapsed ? "left-16" : "left-56";

  return (
    <>
      <header className="bg-neutral-950 flex justify-between items-center w-full px-6 py-3 fixed top-0 z-50">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCollapsed((value) => !value)}
            className="flex items-center text-neutral-400 hover:text-primary"
            title={collapsed ? "Развернуть меню" : "Свернуть меню"}
            aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
            aria-expanded={!collapsed}
            data-testid="sidebar-toggle"
          >
            <span className="material-symbols-outlined">{collapsed ? "menu" : "menu_open"}</span>
          </button>
          <span className="text-xl font-bold tracking-tighter text-primary font-['Space_Grotesk'] uppercase">
            LLM_LAUNCHER
          </span>
        </div>
        <button className="flex items-center gap-2" onClick={handleLogout} title="Выйти">
          <span className="material-symbols-outlined text-primary p-1">account_circle</span>
          <span className="font-['Space_Grotesk'] text-xs uppercase text-neutral-400">admin</span>
        </button>
      </header>

      <aside
        className={`bg-neutral-950 fixed left-0 top-0 h-full flex flex-col z-40 pt-16 transition-all ${asideWidth}`}
        data-testid="sidebar"
        data-collapsed={collapsed ? "true" : "false"}
      >
        <nav className="flex-grow py-4 px-3 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={`${NAV_LINK_BASE} ${collapsed ? "justify-center px-0" : ""} ${active ? NAV_LINK_ACTIVE : NAV_LINK_INACTIVE}`}
              >
                <span className="material-symbols-outlined text-lg" aria-hidden="true">
                  {item.icon}
                </span>
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className={`pt-16 pb-16 px-8 min-h-screen transition-all ${contentOffset}`}>
        <Outlet />
      </main>

      <footer
        className={`bg-neutral-950 fixed bottom-0 right-0 flex justify-between items-center px-8 py-2 z-30 transition-all ${footerOffset}`}
      >
        <div className="font-['Inter'] text-[10px] tracking-widest uppercase text-neutral-600">llm-launcher</div>
      </footer>
    </>
  );
}

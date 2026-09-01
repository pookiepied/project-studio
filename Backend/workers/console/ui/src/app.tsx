import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { api } from "./lib/api";
import { useLive } from "./lib/useLive";
import { applyTheme, readTheme, watchSystem, type Theme } from "./lib/theme";
import { Header, type PageId } from "./components/chrome";
import { OverviewPage } from "./pages/overview";
import { ActivityPage } from "./pages/activity";
import { HealthPage } from "./pages/health";
import { PeoplePage } from "./pages/people";

const TITLES: Record<PageId, string> = {
  overview: "Overview",
  activity: "Activity",
  health: "Health",
  people: "People",
};

/** The hash is the whole router. Four pages do not need a routing library. */
function pageFromHash(): PageId {
  const id = window.location.hash.replace(/^#\/?/, "");
  return id === "activity" || id === "health" || id === "people" ? id : "overview";
}

export function App() {
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [theme, setTheme] = useState<Theme>(readTheme);

  const session = useLive(() => api.session(), null, []);
  // The header dot is the one thing on every page, so it polls on its own.
  const health = useLive(() => api.health(), 60_000, []);

  useEffect(() => {
    applyTheme(theme);
    return watchSystem(() => applyTheme(theme));
  }, [theme]);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (next: PageId) => {
    window.location.hash = next === "overview" ? "" : `/${next}`;
    setPage(next);
  };

  return (
    /**
     * The measure is capped well short of the viewport on purpose.
     *
     * A control plane that fills a 27-inch display reads as an operations
     * centre — something you brace for before opening. Held at a narrow column
     * it reads as a page, and the density stays the same whatever the window is
     * doing. The window is not the layout.
     */
    <div className="mx-auto min-h-dvh w-full max-w-[46rem] px-5 py-8 sm:px-6">
      <Header
        title={TITLES[page]}
        email={session.data?.email ?? null}
        status={health.data?.status ?? null}
        theme={theme}
        onTheme={setTheme}
        page={page}
        onPage={navigate}
      />

      <main>
        <AnimatePresence mode="wait" initial={false}>
          {page === "overview" ? (
            <OverviewPage key="overview" onNavigate={navigate} />
          ) : page === "activity" ? (
            <ActivityPage key="activity" />
          ) : page === "health" ? (
            <HealthPage key="health" />
          ) : (
            <PeoplePage key="people" />
          )}
        </AnimatePresence>
      </main>

      <footer className="text-caption mt-10 text-muted-foreground">
        pookiepied · control plane
      </footer>
    </div>
  );
}

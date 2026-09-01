import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { api } from "./lib/api";
import { cn } from "./lib/cn";
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

/** Reading width for the pages that read; table width for the pages that tabulate. */
const MEASURE: Record<PageId, string> = {
  overview: "max-w-[46rem]",
  activity: "max-w-[68rem]",
  health: "max-w-[62rem]",
  people: "max-w-[52rem]",
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
     *
     * The cap is per page, though, because that argument is about proportion
     * and not about a number. Overview and People are prose and short rows and
     * belong at reading width. Activity is a log with seven columns and Health
     * nests a detail bag inside a check inside a service; at 46rem both were
     * being folded into a column narrower than their content, which is the
     * same mistake in the other direction. They get room, and still stop well
     * short of the window.
     */
    <div className={cn("mx-auto min-h-dvh w-full px-5 py-8 sm:px-6", MEASURE[page])}>
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

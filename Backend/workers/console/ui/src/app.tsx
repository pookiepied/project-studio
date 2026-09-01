import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { api } from "./lib/api";
import { cn } from "./lib/cn";
import { useLive } from "./lib/useLive";
import { applyTheme, readTheme, watchSystem, type Theme } from "./lib/theme";
import { PageHeader, TopBar, type PageId } from "./components/chrome";
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
     * One frame, not two.
     *
     * The previous attempt drew a ringed, rounded shell and then filled it with
     * ringed, rounded panels — two borders of the same weight and radius saying
     * the same thing, one inside the other. That reads as chrome nested in
     * chrome, and it is what made a page of content look like a page of boxes.
     *
     * So the shell keeps the rounding and loses the ring, the interior takes the
     * sunken tone, and the panels are the *lighter* surface sitting on it. The
     * separation is now a tonal step rather than a second outline: panels read
     * as objects resting on a table, and nothing on screen is framed twice.
     */
    <div className="min-h-dvh bg-canvas sm:p-6 lg:p-8">
      <div
        className={cn(
          "mx-auto flex min-h-dvh w-full max-w-[88rem] flex-col overflow-hidden",
          "bg-surface-sunken sm:min-h-0 sm:rounded-[28px] sm:shadow-lifted",
        )}
      >
        <TopBar
          page={page}
          onPage={navigate}
          email={session.data?.email ?? null}
          theme={theme}
          onTheme={setTheme}
        />

        <PageHeader title={TITLES[page]} status={health.data?.status ?? null} />

        <main className="flex-1 px-4 pb-8 sm:px-7">
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

        <footer className="text-caption px-4 pb-6 text-muted-foreground sm:px-7">
          pookiepied · control plane
        </footer>
      </div>
    </div>
  );
}

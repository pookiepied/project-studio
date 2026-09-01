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
     * A shell resting on a canvas, rather than a column of content in a window.
     *
     * The measure is still capped — a control plane that runs edge to edge on a
     * 27-inch display reads as an operations centre, something you brace for
     * before opening. What changed is what the cap produces: a bounded column of
     * text became a bounded *object*, with an inside and an edge, which is what
     * lets a grid of panels sit in it without any of them touching the window.
     *
     * The cap is one number again rather than one per page. It was four numbers
     * because the pages disagreed about how wide their content was; now they
     * share a grid, and a shell that resized when you changed tab would be the
     * window jumping under the cursor for no reason the reader can see.
     */
    <div className="min-h-dvh bg-canvas p-0 sm:p-5 lg:p-7">
      <div
        className={cn(
          "mx-auto flex min-h-dvh w-full max-w-[84rem] flex-col overflow-hidden",
          "bg-background sm:min-h-0 sm:rounded-3xl sm:ring-1 sm:ring-hairline sm:shadow-lifted",
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

        <main className="flex-1 px-4 pb-6 sm:px-5">
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

        <footer className="text-caption border-t border-hairline px-4 py-3 text-muted-foreground sm:px-5">
          pookiepied · control plane
        </footer>
      </div>
    </div>
  );
}

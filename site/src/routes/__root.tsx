import { HeadContent, Outlet, Scripts, createRootRoute, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { recordPageView } from "~/server/analytics";
import appCss from "~/styles/app.css?url";

// Client-side analytics beacon: records one page view per client-side route
// change. Runs only in the browser (useEffect never fires on the server). It is
// intentionally light and silent — it never blocks rendering and its errors are
// swallowed so it can never break navigation.
const VISITOR_KEY = "rmp_visitor_id";
function AnalyticsBeacon() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    if (typeof window === "undefined") return;
    let visitorId: string;
    try {
      visitorId = localStorage.getItem(VISITOR_KEY) || "";
      if (!visitorId) {
        visitorId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : "anon-" + Math.random().toString(36).slice(2);
        localStorage.setItem(VISITOR_KEY, visitorId);
      }
    } catch {
      visitorId = "anon-" + Math.random().toString(36).slice(2);
    }
    recordPageView({
      data: {
        path: path || "/",
        visitorId,
        referrer: typeof document !== "undefined" ? document.referrer || null : null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent || null : null,
      },
    }).catch(() => {});
  }, [path]);
  return null;
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Ranch Manager Pro — Ranch & Farm Management Software" },
      {
        name: "description",
        content:
          "Centralized ranch and farm management for livestock, pasture, hay & feed, equipment, fuel, registrations and insurance — for operations of every size.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  notFoundComponent: () => <div>Page not found</div>,
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <AnalyticsBeacon />
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

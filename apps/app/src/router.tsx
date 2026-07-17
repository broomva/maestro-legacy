import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AccountPage } from "./components/account/account-page";
import { PaneErrorFallback } from "./components/error-boundary";
import { HistoryPage } from "./components/history/history-page";
import { KnowledgePage } from "./components/knowledge/knowledge-page";
import { SettingsPage } from "./components/settings/settings-page";
import { ShellLayout } from "./routes/app";
import { FileRoute } from "./routes/file";
import { MissionHome } from "./routes/home";
import { KitchenSink } from "./routes/kitchen-sink";
import { SessionView } from "./routes/session";

// Code-based routing (no generated route tree) keeps routing explicit + lint-clean. The product views
// map 1:1 to /, /knowledge, /history, /settings, /account (production-notes §1); they are CHILDREN of a
// pathless shell LAYOUT route so they share one Shell + one SSE connection (BRO-1824). Each view sets an
// `errorComponent` so a crashed view falls back to a calm plain-voice pane WITHIN the shell — the
// sidebar + header stay (the done.check: a thrown render error in one pane never blanks the shell).

const rootRoute = createRootRoute({ component: () => <Outlet /> });

/** The shell layout — pathless, so every product view renders inside the same chrome + live stream. */
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: ShellLayout,
});

// `const P` preserves the path LITERAL through createRoute so TanStack's typed `<Link to>` union keeps
// every view path (a plain `string` param would erase them → `to="/account"` would not typecheck).
const view = <const P extends string>(path: P, component: () => ReactNode, label: string) =>
  createRoute({
    getParentRoute: () => shellRoute,
    path,
    component,
    errorComponent: () => <PaneErrorFallback label={label} />,
  });

const boardRoute = view("/", MissionHome, "The board");
// The chat surface (BRO-1826 M4) — a session rendered as a thread (+ side-panel mirror). A path param
// carries the session/node id; `view` takes only static paths, so this route is spelled out. Same
// pane-scoped errorComponent as the others (a crashed chat falls back within the shell).
const sessionRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/session/$sessionId",
  component: SessionView,
  errorComponent: () => <PaneErrorFallback label="This session" />,
});
// The file surface (BRO-1890 FID-4) — a workspace file rendered as a document. A `$` splat param carries
// the node's workspace-relative PATH (paths nest, so a catch-all, not a flat `$fileId`). Pane-scoped
// errorComponent like the others (a crashed file view falls back within the shell).
const fileRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/file/$",
  component: FileRoute,
  errorComponent: () => <PaneErrorFallback label="This file" />,
});
const knowledgeRoute = view("/knowledge", KnowledgePage, "Knowledge");
const historyRoute = view("/history", HistoryPage, "History");
const settingsRoute = view("/settings", SettingsPage, "Settings");
const accountRoute = view("/account", AccountPage, "Account");

// Test-fixture route (BRO-1824 done-check): routing.pw.ts proves at RUNTIME that a crashed view falls
// back within the shell (chrome survives) — React 19 SSR rethrows boundary errors, so the client catch
// is only observable in a real browser. INERT BY DEFAULT: it throws ONLY when explicitly triggered with
// `?crash` (the test navigates to /__crash-probe?crash=1), so mere navigation in a real build never
// errors — no accidental prod error / console noise (P20 BRO-1824). A child of the shell, so its
// errorComponent renders inside the shell's Outlet.
const CrashProbe = (): ReactNode => {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("crash")) {
    throw new Error("crash probe (BRO-1824 test trigger)");
  }
  return null;
};
const crashRoute = view("/__crash-probe", CrashProbe, "This view");

// /kitchen-sink — the M1 primitive gallery (every variant/state). A developer surface, OUTSIDE the shell.
const kitchenSinkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/kitchen-sink",
  component: KitchenSink,
});

const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([
    boardRoute,
    sessionRoute,
    fileRoute,
    knowledgeRoute,
    historyRoute,
    settingsRoute,
    accountRoute,
    crashRoute,
  ]),
  kitchenSinkRoute,
]);

export const router = createRouter({
  routeTree,
  // Whole-app backstop — fires if the shell LAYOUT itself crashes (it has no errorComponent of its own),
  // so the copy must NOT claim the rest of the app is fine (`scope="shell"`); per-view crashes hit their
  // own pane-scoped errorComponent above, where the shell survives.
  defaultErrorComponent: () => <PaneErrorFallback scope="shell" />,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

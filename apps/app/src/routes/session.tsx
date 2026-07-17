// Session route (BRO-1826 M4, slice B) — the chat surface. A session renders work; it never owns it
// (CLAUDE.md §What Maestro is: "Chat is a projection"). This route drives ONE `useBvChat` and paints it
// into TWO surfaces — the thread (the 768px conversation column with the composer) and a side panel (a
// read-only mirror of the same transcript). Same session, same reducer, two projections: the M4 verify.
//
// The transport is the real `RuntimeChatTransport` bound to the path session id, UNLESS `?fixture=1`
// selects the recorded `FixtureChatTransport` (the demo/test seam, inert in production — mirrors the
// router's `?crash` probe). The shell layout owns the SSE stream + chrome; this is just its child view.

import { Composer } from "@maestro/ui";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useStore } from "zustand";
import { ChatFeed } from "@/chat/chat-feed";
import {
  FixtureChatTransport,
  FixtureErrorChatTransport,
  fixtureMode,
  fixtureRequested,
  fixtureStepMs,
} from "@/chat/fixture-transport";
import { type ChatTransport, RuntimeChatTransport } from "@/chat/transport";
import { useBvChat } from "@/chat/use-bv-chat";
import { GateQueue } from "@/components/gate/gate-queue";
import { postIntent } from "@/intents/client";
import { maestroStore, selectGateQueue } from "@/store";

/** The chat surface for ONE session. Split out from the param-reading route so it can be KEYED by
 *  sessionId (P20 slice-B MAJOR): a `$sessionId` change fully remounts this, giving the new session a
 *  fresh `useBvChat` while the prior instance's unmount cleanup aborts its in-flight turn — session A's
 *  stream can never bleed into session B's transcript. */
function SessionChat({ sessionId, dock = false }: { sessionId: string; dock?: boolean }) {
  // Bind the transport once per mount. Fixture mode is a demo/test seam (query-triggered), inert
  // otherwise — production streams over the real F10 endpoint.
  const transport = useMemo<ChatTransport>(() => {
    if (!fixtureRequested()) return new RuntimeChatTransport({ sessionId });
    return fixtureMode() === "error"
      ? new FixtureErrorChatTransport(fixtureStepMs())
      : new FixtureChatTransport(fixtureStepMs());
  }, [sessionId]);

  const { messages, status, busy, sendMessage, stop } = useBvChat({ transport });

  // The gate queue is the ORCHESTRATOR's — it holds every open gate (all review/blocked leaves), so it
  // docks at the orchestrator session foot only (the prototype's MccMaestroChat; a fresh worker session
  // shows just its composer). Read the STABLE server slice + derive in useMemo — deriving inline returns
  // a fresh array every render and thrashes useSyncExternalStore (the FID-2 getSnapshot lesson).
  // Only the orchestrator subscribes to the (high-churn) server-truth slice — a worker session selects a
  // constant `null`, so its SSE-driven mutations never re-render this view (correctness P20 nit).
  const isOrchestrator = sessionId === "orchestrator";
  const server = useStore(maestroStore, (s) => (isOrchestrator ? s.server : null));
  const gateItems = useMemo(() => (server ? selectGateQueue(server) : []), [server]);

  return (
    <div className="flex h-full min-h-0" data-testid={dock ? "orchestrator-dock" : "session-view"}>
      {/* The thread — the conversation column. The feed grows and scrolls; the composer sits in a
          bottom footer, both centered to the canon 768px measure (the DS class centers the feed; the
          footer matches). The gate queue (rung 2) stacks above the composer at the orchestrator's foot —
          the disclosure-ladder "look, then act with verbs" surface (BRO-1888). */}
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Thread">
        <ChatFeed messages={messages} status={status} label="Conversation" />
        <div className="mx-auto flex w-full max-w-[768px] shrink-0 flex-col gap-2.5 px-4 pt-2 pb-4">
          {isOrchestrator ? <GateQueue items={gateItems} onIntent={postIntent} /> : null}
          <Composer
            placeholder="Message Maestro"
            busy={busy}
            onSend={(text) => sendMessage({ text })}
            onStop={stop}
          />
        </div>
      </section>

      {/* The side panel — the same session as a read-only mirror (rung 3, for verifying not operating).
          Hidden on narrow viewports; the layout rule reserves the right panel for wide screens. This is
          the "same run in a side panel" the M4 verify names — one hook, a second projection, no composer.
          Omitted in the DOCK variant: the mission-home right column is already a narrow docked chat, so the
          full-route mirror would not fit and is not part of the home surface (slice 1). */}
      {dock ? null : (
        <aside
          className="hidden w-[380px] shrink-0 flex-col border-border border-l xl:flex"
          aria-label="Session panel"
          data-testid="session-panel"
        >
          <header className="flex h-[44px] shrink-0 items-center border-border border-b px-4">
            <span className="font-medium text-sm">This session</span>
          </header>
          <ChatFeed messages={messages} status={status} label="This session" />
        </aside>
      )}
    </div>
  );
}

/**
 * The orchestrator's chat, docked on the mission home's right column (design-fidelity slice 1). This is the
 * "chat is the home" fix (CLAUDE.md §What Maestro is; the prototype's mission mode, ConceptMaestroLoop
 * `MccMaestroLoopV2` — the work plane with the orchestrator conversation co-present, `.mcc-chatside`). It
 * renders the gate queue (rung 2, "the look") above the composer, so the primary surface carries the
 * approve/send-back verbs — not a separate route. `dock` drops the read-only mirror; the session id is the
 * constant "orchestrator", so no keying is needed (a worker session never mounts here).
 */
export function OrchestratorDock() {
  return <SessionChat sessionId="orchestrator" dock />;
}

export function SessionView() {
  // Loose param read (the route is registered in router.tsx; `strict:false` avoids a config import cycle).
  const params = useParams({ strict: false }) as { sessionId?: string };
  const sessionId = params.sessionId ?? "orchestrator";
  // KEY the chat by the session id so switching sessions tears the old one down (fresh state + the old
  // instance's abort-on-unmount cleanup) rather than reusing the component across a param change.
  return <SessionChat key={sessionId} sessionId={sessionId} />;
}

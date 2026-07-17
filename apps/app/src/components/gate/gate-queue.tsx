// The gate queue (BRO-1888 FID-3) — the disclosure-ladder RUNG 2: the human looks, then acts with
// verbs (approve · send back · redispatch), never a form. It is a DERIVED VIEW over the server-truth
// leaves that need a human (`selectGateQueue` → review + blocked), the same SSE-fed store the mission
// plane reads — never a separate store (gate.ts §Membership). "Needs you" is accent-blue, never red.
//
// The one sanctioned timing component is the GRACE WINDOW (gate.ts `GATE_GRACE_WINDOW_MS`): a chosen
// verdict is reversible for a beat before its intent is sent, so a mis-click never fires an approve.
// The verb becomes an `Intent` posted to POST /api/intents (intents in, events out) — the RESULT lands
// on the event stream and re-projects the node (review→done), which is what DEQUEUES the card. So the
// component never mutates the store; it overlays the pending/undo/sent state and lets server truth win.
//
// The verb PRESENTATION (GateActions / SendBackNote / GateDone) + the grace helpers live in gate-verbs.ts,
// shared with the inspector's single-item machine (BRO-1809 M5). This queue keeps its OWN per-card machine:
// a card can LEAVE the queue (the server processed its verdict) and must DROP its pending, not commit it —
// a distinction the single-item inspector does not have. Verb scope here: review → Approve (grace) + Send
// back with a note (grace); blocked → Redispatch (immediate). Block / Escalate are the inspector's controls.

import { GATE_GRACE_WINDOW_MS, type Intent, type WorkItem } from "@maestro/protocol";
import { STATUS_DOT_VAR, workStatusView } from "@maestro/ui";
import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { relativeTime } from "../board/board-view";
import {
  errText,
  GateActions,
  GateDone,
  type IntentDispatch,
  type Pending,
  SendBackNote,
  secondsLeft,
} from "./gate-verbs";

export type { IntentDispatch } from "./gate-verbs";

export interface GateQueueProps {
  /** The gate-queue items — server-truth leaves that need a human (`selectGateQueue`). */
  items: WorkItem[];
  /** The intent dispatcher (default `postIntent`). */
  onIntent: IntentDispatch;
}

export function GateQueue({ items, onIntent }: GateQueueProps) {
  // Pending verdicts, keyed by the stable WorkItem id (present on every node; gateId is review-only).
  const [pending, setPending] = useState<Record<string, Pending>>({});
  // Which card is expanded (the "look") and which is being noted for a send-back.
  const [openId, setOpenId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  // A coarse clock: it advances the grace countdown label and each card's relative-age receipt.
  const [now, setNow] = useState(() => Date.now());
  // Each graced verdict registers a timer AND a `flush` (fire-the-send-now) closure, so unmount can
  // COMMIT a chosen-but-not-yet-sent verdict rather than drop it (gate.ts §PendingVerdict: sent exactly
  // once, never silently dropped; only Undo cancels). Redispatch is immediate and never registers here.
  const timers = useRef<
    Record<string, { timer: ReturnType<typeof setTimeout>; flush: () => void }>
  >({});
  // Guards the once-only auto-expand of the primary gate (below).
  const autoOpened = useRef(false);

  const clearTimer = useCallback((id: string) => {
    const t = timers.current[id];
    if (t !== undefined) {
      clearTimeout(t.timer);
      delete timers.current[id];
    }
  }, []);

  // Send the chosen intent exactly once (called by the grace timer, on unmount-flush, or immediately for
  // redispatch). The idempotency key is STABLE per decision, so any retry of THIS POST at the transport
  // layer (browser/proxy, or an unmount flush racing a timer) de-dupes server-side (client.ts §idempotencyKey).
  const send = useCallback(
    async (id: string, label: string, intent: Intent, chosenAt: number) => {
      setPending((cur) => (cur[id] ? { ...cur, [id]: { ...cur[id], phase: "sending" } } : cur));
      try {
        await onIntent(intent, { idempotencyKey: `${id}:${label}:${chosenAt}` });
        setPending((cur) => (cur[id] ? { ...cur, [id]: { ...cur[id], phase: "sent" } } : cur));
      } catch (e: unknown) {
        // A rejected POST — or a SYNCHRONOUS throw from a bad dispatcher — lands the card in `failed`
        // (never a silent drop, gate.ts §PendingVerdict); the try/catch means `send` never rejects.
        setPending((cur) =>
          cur[id] ? { ...cur, [id]: { ...cur[id], phase: "failed", error: errText(e) } } : cur,
        );
      }
    },
    [onIntent],
  );

  const choose = useCallback(
    (id: string, label: string, intent: Intent, graced: boolean) => {
      const chosenAt = Date.now();
      // Sync the countdown clock to the click so the first render shows a full 5s, not 6 (the interval
      // clock is otherwise stale from mount, making `now - chosenAt` negative for one render).
      setNow(chosenAt);
      setPending((cur) => ({ ...cur, [id]: { label, intent, phase: "grace", chosenAt, graced } }));
      setNoteFor(null);
      if (graced) {
        clearTimer(id);
        timers.current[id] = {
          timer: setTimeout(() => {
            delete timers.current[id];
            send(id, label, intent, chosenAt);
          }, GATE_GRACE_WINDOW_MS),
          flush: () => send(id, label, intent, chosenAt),
        };
      } else {
        send(id, label, intent, chosenAt); // redispatch: no grace, fire now
      }
    },
    [send, clearTimer],
  );

  const undo = useCallback(
    (id: string) => {
      clearTimer(id);
      setPending((cur) => {
        if (!cur[id]) return cur;
        const { [id]: _dropped, ...rest } = cur;
        return rest;
      });
    },
    [clearTimer],
  );

  // Auto-expand the PRIMARY (first) gate so the look + verbs show without a click — the prototype's
  // MccGateQueue opens index 0 by default (ConceptMaestroLoop.jsx: `useState(mini ? -1 : 0)`). It fires
  // once the queue first has items; after that the user's open/close wins (the ref guards a re-open of a
  // card the human deliberately collapsed). Approve stays reversible for its grace window, so a pre-opened
  // verb is no less safe than a clicked-open one — the disclosure is the only thing that changes.
  useEffect(() => {
    if (autoOpened.current || items.length === 0) return;
    autoOpened.current = true;
    const firstId = items[0]?.id;
    if (firstId) setOpenId((cur) => cur ?? firstId);
  }, [items]);

  // The clock drives two receipts: the grace countdown (a 500ms tick while a verdict is inside its
  // window) and each card's relative age (a calm 30s tick while any card is docked). Gating the age
  // tick on `graceOpen` alone froze the age labels — and pinned a gate that opened after mount to "0s"
  // (react-patterns P20). So it ticks whenever there are cards, fast only during a grace window.
  const graceOpen = Object.values(pending).some((p) => p.phase === "grace" && p.graced);
  const hasCards = items.length > 0;
  useEffect(() => {
    if (!graceOpen && !hasCards) return;
    const t = setInterval(() => setNow(Date.now()), graceOpen ? 500 : 30_000);
    return () => clearInterval(t);
  }, [graceOpen, hasCards]);

  // Cleanup: when a card leaves the queue (server processed the verdict → the node left review/blocked)
  // drop its pending entry + timer, so a later reappearance of the same UUID doesn't show a stale verb.
  const liveIds = items.map((i) => i.id).join(",");
  useEffect(() => {
    const ids = new Set(liveIds ? liveIds.split(",") : []);
    setPending((cur) => {
      let changed = false;
      const next: Record<string, Pending> = {};
      for (const [id, p] of Object.entries(cur)) {
        if (ids.has(id)) next[id] = p;
        else {
          changed = true;
          clearTimer(id);
        }
      }
      return changed ? next : cur;
    });
  }, [liveIds, clearTimer]);

  // On unmount, COMMIT (don't drop) each pending grace verdict: the human chose it, and leaving the
  // surface is not Undo — the only sanctioned cancel (gate.ts §PendingVerdict). Cancel the timer, then
  // flush the send now; the stable idempotency key means a flush + an about-to-fire timer can't double-
  // apply. `timers.current` only ever holds still-in-grace verdicts (a sent/failed timer self-deletes,
  // an undone one is cleared), so this commits exactly the un-committed ones.
  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const id of Object.keys(t)) {
        const entry = t[id];
        if (!entry) continue;
        clearTimeout(entry.timer);
        entry.flush();
      }
    };
  }, []);

  if (items.length === 0) {
    return (
      <div className="mcc-allclear" data-testid="gate-allclear">
        <Check size={14} strokeWidth={2} />
        Nothing at your gate. The loop holds everything.
      </div>
    );
  }

  return (
    <div className="mcc-gateq" data-testid="gate-queue" data-screen-label="Gate queue">
      {items.map((item) => {
        const p = pending[item.id];
        const v = workStatusView(item.state, item.kind);
        const isReview = item.state === "review";
        return (
          <div
            key={item.id}
            className="mcc-gateq-card"
            data-testid="gate-card"
            data-state={item.state}
          >
            {/* The row IS the disclosure toggle (an accessible button — no nested interactive: the verbs
                are siblings below, not descendants). Disabled once a verdict is pending. */}
            <button
              type="button"
              className="mcc-gateq-row"
              aria-expanded={openId === item.id}
              disabled={Boolean(p)}
              onClick={() => {
                // Toggling a row (open, close, or switch cards) discards any in-progress send-back
                // draft, so a half-typed note can't resurface when the card is reopened.
                setOpenId((cur) => (cur === item.id ? null : item.id));
                setNoteFor(null);
                setNoteText("");
              }}
            >
              <span className="mc-chip-dot" style={{ background: STATUS_DOT_VAR[v.tone] }} />
              <span className="mcc-gateq-title">{item.title}</span>
              <span className="mcc-loops-t">
                {relativeTime(item.lastEventAt ?? item.updatedAt, now)}
              </span>
            </button>
            {item.look?.ran ? <span className="mcc-gateq-meta">{item.look.ran}</span> : null}

            {p ? (
              <GateDone
                pending={p}
                secondsLeft={p.graced ? secondsLeft(p.chosenAt, now) : 0}
                onUndo={() => undo(item.id)}
              />
            ) : openId === item.id ? (
              <>
                <GateLook item={item} />
                {noteFor === item.id && isReview ? (
                  <SendBackNote
                    value={noteText}
                    onChange={setNoteText}
                    onCancel={() => setNoteFor(null)}
                    onSend={() => {
                      const feedback = noteText.trim();
                      if (!feedback || !item.gateId) return;
                      choose(
                        item.id,
                        "Sent back",
                        { type: "revise", gateId: item.gateId, feedback },
                        true,
                      );
                      setNoteText("");
                    }}
                  />
                ) : (
                  <GateActions
                    item={item}
                    onApprove={() =>
                      item.gateId &&
                      choose(item.id, "Approved", { type: "approve", gateId: item.gateId }, true)
                    }
                    onSendBack={() => {
                      setNoteFor(item.id);
                      setNoteText("");
                    }}
                    onRedispatch={() =>
                      choose(item.id, "Redispatching", { type: "dispatch", nodeId: item.id }, false)
                    }
                  />
                )}
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** The "look" — what changed · what it decided · what it asks. Evidence on the card so approve is never
 *  blind (concepts.css §.mcc-gateq-look). Falls back to the run receipt when no gate compression exists. */
function GateLook({ item }: { item: WorkItem }) {
  const rows: [string, string][] = [];
  if (item.run) rows.push(["changed", item.run]);
  if (item.look?.decided?.length) rows.push(["decided", item.look.decided.join(" · ")]);
  if (item.look?.ask) rows.push(["asks", item.look.ask]);
  else if (item.reason) rows.push(["blocked", item.reason]);
  if (rows.length === 0) return null;
  return (
    <div className="mcc-gateq-look">
      {rows.map(([key, val]) => (
        <div key={key} className="mcc-gateq-look-row">
          <span className="mcc-gateq-look-key">{key}</span>
          <span className="mcc-gateq-look-val">{val}</span>
        </div>
      ))}
    </div>
  );
}

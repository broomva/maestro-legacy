import { ArrowUp, ChevronDown, Mic, Plus, Sparkles, Square } from "lucide-react";
import * as React from "react";
import { composerSendText } from "./composer";
import { cn } from "./lib/cn";

// PromptPlate — the rich two-storey composer (the prototype's `MccPromptPlate`, PromptPlate.jsx). It is
// the same one glass surface as `Composer` (`.bv-glass-composer` — 28px radius, the frosted-blue halo, the
// inner light line; glass earns its place in exactly the composer, CLAUDE.md §Glass) but with the canon
// dispatch rail: an auto-grow textarea + a `⌘L to focus` hint on top, and a rail beneath carrying the model
// picker on the left and attach / dictate / send on the right. `Composer` stays the bare single-line variant
// (kitchen-sink, tests); PromptPlate is the chat surface's composer (the mission-home dock + the session
// route). Send semantics are shared via `composerSendText` (trim-and-guard, no duplicate rule).

/** One selectable model in the picker chip. `label` is the plain display ("Opus 4.8"); `id` is the wire id. */
export interface PromptModel {
  id: string;
  label: string;
}

/** The default catalog — the latest Claude models (system canon). The picker is presentational context for
 *  now; wiring the choice into the dispatch request is a follow-up (the transport takes no model param yet). */
export const PROMPT_MODELS: readonly PromptModel[] = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

export interface PromptPlateProps {
  /** Placeholder — the chat surface uses the prototype's "Message maestro · anything beyond approve and
   *  send back…". */
  placeholder?: string;
  /** The focus hint shown top-right, hidden while the field is focused. Default "⌘L to focus"; the ⌘L
   *  shortcut focuses the textarea while the plate is mounted + visible. */
  hint?: string;
  /** Controlled value; uncontrolled if omitted (mirrors Composer). */
  value?: string;
  onChange?: (value: string) => void;
  /** Called with the trimmed text on Enter (no Shift) or the send click; empty/whitespace never sends. */
  onSend?: (text: string) => void;
  /** True while a turn streams — the send arrow becomes a stop square and Enter is inert (verb is Stop). */
  busy?: boolean;
  onStop?: () => void;
  /** The model catalog for the picker chip (default {@link PROMPT_MODELS}). */
  models?: readonly PromptModel[];
  /** The active model id (controlled); defaults to the first catalog entry (uncontrolled otherwise). */
  modelId?: string;
  onPickModel?: (id: string) => void;
}

const MAX_TEXTAREA_PX = 184; // ~5 lines, then the field scrolls (PromptPlate.jsx auto-grow ceiling).

export const PromptPlate = React.forwardRef<HTMLTextAreaElement, PromptPlateProps>(
  (
    {
      placeholder = "Message Maestro",
      hint = "⌘L to focus",
      value,
      onChange,
      onSend,
      busy = false,
      onStop,
      models = PROMPT_MODELS,
      modelId,
      onPickModel,
    },
    ref,
  ) => {
    const [internal, setInternal] = React.useState("");
    const controlled = value !== undefined;
    const text = controlled ? value : internal;
    const setText = (next: string) => {
      if (!controlled) setInternal(next);
      onChange?.(next);
    };

    const [innerModel, setInnerModel] = React.useState(models[0]?.id ?? "");
    const activeModelId = modelId ?? innerModel;
    const activeModel = models.find((m) => m.id === activeModelId) ?? models[0];
    const [menuOpen, setMenuOpen] = React.useState(false);
    const pickModel = (id: string) => {
      if (modelId === undefined) setInnerModel(id);
      onPickModel?.(id);
      setMenuOpen(false);
    };

    const taRef = React.useRef<HTMLTextAreaElement | null>(null);
    const setTaRef = (el: HTMLTextAreaElement | null) => {
      taRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    };

    // Auto-grow: the field tracks its content up to ~5 lines, then scrolls (the prototype's useLayoutEffect).
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on every text change is the point.
    React.useLayoutEffect(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, MAX_TEXTAREA_PX)}px`;
      ta.style.overflowY = ta.scrollHeight > MAX_TEXTAREA_PX ? "auto" : "hidden";
    }, [text]);

    // ⌘L focuses the plate, as the hint promises — only while the textarea is actually visible (offsetParent
    // is null when the dock is hidden behind the inspector, so a hidden plate never steals the shortcut).
    React.useEffect(() => {
      if (!hint?.includes("⌘L")) return;
      const onKey = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === "l" || e.key === "L")) {
          const ta = taRef.current;
          if (ta && ta.offsetParent !== null) {
            e.preventDefault();
            ta.focus();
          }
        }
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [hint]);

    // Close the model menu on an outside pointer-down or Escape.
    const menuRef = React.useRef<HTMLDivElement | null>(null);
    React.useEffect(() => {
      if (!menuOpen) return;
      const onDown = (e: PointerEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setMenuOpen(false);
      };
      document.addEventListener("pointerdown", onDown);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("pointerdown", onDown);
        document.removeEventListener("keydown", onKey);
      };
    }, [menuOpen]);

    const ready = composerSendText(text) !== null;
    const send = () => {
      const payload = composerSendText(text);
      if (payload) onSend?.(payload);
      if (!controlled) setInternal("");
    };
    const act = () => {
      if (busy) onStop?.();
      else send();
    };

    return (
      <div
        className="group bv-glass-composer flex flex-col p-0 focus-within:[outline:2px_solid_var(--ring)] focus-within:[outline-offset:2px]"
        style={{ containerType: "inline-size" }}
      >
        {/* Storey 1 — the auto-grow textarea + the focus hint (hidden on focus). */}
        <div className="flex items-start gap-3 px-4 pt-3 pb-0.5">
          <textarea
            ref={setTaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !busy) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={placeholder}
            // The ai-blue ring rides the capsule (focus-within); the textarea suppresses its own — inline
            // outline:none beats the unlayered global :focus-visible (the composer.pw.ts single-ring rule).
            style={{ outline: "none", resize: "none" }}
            className="min-h-[24px] min-w-0 flex-1 border-none bg-transparent p-0 text-[15px] text-foreground leading-[1.55] placeholder:text-muted-foreground"
          />
          {hint ? (
            <span className="shrink-0 whitespace-nowrap pt-0.5 text-muted-foreground text-xs opacity-75 transition-opacity group-focus-within:opacity-0 motion-reduce:transition-none">
              {hint}
            </span>
          ) : null}
        </div>

        {/* Storey 2 — the dispatch rail: model picker (left) + attach / dictate / send (right). */}
        <div className="flex items-center gap-0.5 px-2.5 pt-1.5 pb-2">
          <div ref={menuRef} className="relative flex min-w-0 flex-1 items-center gap-0.5">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-row px-2 font-medium text-[12.5px] text-foreground transition-colors motion-reduce:transition-none hover:bg-[var(--bv-frost-8)]"
            >
              <Sparkles size={14} strokeWidth={2} className="text-[var(--bv-blue)]" />
              <span className="min-w-0 truncate">{activeModel?.label}</span>
              <ChevronDown
                size={11}
                strokeWidth={2}
                className={cn("shrink-0 opacity-50 transition-transform", menuOpen && "rotate-180")}
              />
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="bv-glass absolute bottom-9 left-0 z-10 min-w-[168px] rounded-card p-1 shadow-[var(--bv-shadow-card-hover)]"
              >
                {models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={m.id === activeModelId}
                    onClick={() => pickModel(m.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-row px-2 py-1.5 text-left text-[13px] transition-colors motion-reduce:transition-none hover:bg-[var(--bv-frost-8)]",
                      m.id === activeModelId ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <Sparkles
                      size={13}
                      strokeWidth={2}
                      className={m.id === activeModelId ? "text-[var(--bv-blue)]" : "opacity-60"}
                    />
                    {m.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-label="Attach"
              className="inline-flex size-[30px] items-center justify-center rounded-row text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-[var(--bv-frost-8)] hover:text-foreground"
            >
              <Plus size={16} strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="Dictate"
              className="inline-flex size-[30px] items-center justify-center rounded-row text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-[var(--bv-frost-8)] hover:text-foreground"
            >
              <Mic size={15} strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label={busy ? "Stop" : "Send"}
              onClick={act}
              className={cn(
                "ml-1 inline-flex size-[30px] items-center justify-center rounded-[9px] transition-colors motion-reduce:transition-none",
                busy || ready
                  ? "bg-primary text-primary-foreground hover:bg-[var(--bv-ink-hover)]"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {busy ? <Square size={15} strokeWidth={2} /> : <ArrowUp size={16} strokeWidth={2} />}
            </button>
          </div>
        </div>
      </div>
    );
  },
);
PromptPlate.displayName = "PromptPlate";

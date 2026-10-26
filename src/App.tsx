import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type PedalState, type Slot, parseFirmware, pedalConnected, physicalPedals, readPedal, writePedal } from "./api";
import { foldSides, keyForCode, modifiersOf } from "./keys";
import { SlotCard } from "./SlotCard";
import "./App.css";

const POLL_MS = 1500;
const REPO_URL = "https://github.com/thekdence/treadle";

type Status = "searching" | "loading" | "ready" | "saving";

export default function App() {
  const [status, setStatus] = useState<Status>("searching");
  const [pedal, setPedal] = useState<PedalState | null>(null);
  const [draft, setDraft] = useState<Slot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [recording, setRecording] = useState<number | null>(null);
  const [showExtra, setShowExtra] = useState(false);
  const pressed = usePressedSlots(pedal?.slots ?? [], recording !== null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const state = await readPedal();
      setPedal(state);
      setDraft(state.slots);
      setStatus("ready");
    } catch (e) {
      setError(String(e));
      setStatus("searching");
    }
  }, []);

  // Watch for the pedal being plugged in or pulled out.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const connected = await pedalConnected().catch(() => false);
      if (!alive) return;
      if (connected && status === "searching" && !error) load();
      if (!connected && status === "ready") {
        setPedal(null);
        setDraft([]);
        setStatus("searching");
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [status, error, load]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  const changed = pedal ? draft.filter((s, i) => JSON.stringify(s) !== JSON.stringify(pedal.slots[i])) : [];

  const save = async () => {
    setStatus("saving");
    setRecording(null);
    try {
      const state = await writePedal(changed);
      setPedal(state);
      setDraft(state.slots);
      setToast("Saved to pedal");
    } catch (e) {
      setError(String(e));
    }
    setStatus("ready");
  };

  const updateSlot = (slot: Slot) => setDraft((d) => d.map((s) => (s.index === slot.index ? slot : s)));

  const physical = pedal ? physicalPedals(pedal.firmware) : undefined;
  const mainCount = physical && physical < draft.length ? physical : draft.length;
  const titleFor = (s: Slot) =>
    s.index > mainCount ? `Slot ${s.index}` : mainCount === 1 ? "Pedal" : `Pedal ${s.index}`;

  const renderSlot = (s: Slot, i: number) => (
    <SlotCard
      key={s.index}
      title={titleFor(s)}
      slot={s}
      changed={JSON.stringify(s) !== JSON.stringify(pedal?.slots[i])}
      pressed={pressed.has(s.index)}
      recording={recording === s.index}
      onRecord={(on) => setRecording(on ? s.index : null)}
      onChange={updateSlot}
    />
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span>Treadle</span>
        </div>
        <DeviceChip pedal={pedal} status={status} />
      </header>

      <main className="content">
        {error && (
          <div className="alert" role="alert">
            <span>{error}</span>
            <button className="btn btn-ghost" onClick={() => (pedal ? setError(null) : load())}>
              {pedal ? "Dismiss" : "Try again"}
            </button>
          </div>
        )}

        {!pedal ? (
          <EmptyState loading={status === "loading"} />
        ) : (
          <>
            <p className="lede">
              Your shortcuts are saved on the pedal itself, so it works on any computer without Treadle running.
              Press the pedal to see which slot it uses.
            </p>
            <div className="slots">{draft.slice(0, mainCount).map(renderSlot)}</div>

            {draft.length > mainCount && (
              <div className="extra">
                <button className="disclosure" aria-expanded={showExtra} onClick={() => setShowExtra(!showExtra)}>
                  <span className="chevron" aria-hidden>
                    ›
                  </span>
                  Extra slots ({draft.length - mainCount})
                </button>
                {showExtra && (
                  <>
                    <p className="note">
                      The {parseFirmware(pedal.firmware).model} has {mainCount === 1 ? "one pedal" : `${mainCount} pedals`},
                      but its firmware keeps {draft.length} slots. The extra ones are normally unused.
                    </p>
                    <div className="slots">{draft.slice(mainCount).map((s, i) => renderSlot(s, i + mainCount))}</div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>

      <footer className={`savebar${changed.length ? " is-visible" : ""}`}>
        <span>
          {changed.length} unsaved {changed.length === 1 ? "change" : "changes"}
        </span>
        <div className="row">
          <button className="btn btn-ghost" disabled={status === "saving"} onClick={() => pedal && setDraft(pedal.slots)}>
            Revert
          </button>
          <button className="btn btn-primary" disabled={status === "saving"} onClick={save}>
            {status === "saving" ? "Saving…" : "Save to pedal"}
          </button>
        </div>
      </footer>

      <div className={`toast${toast ? " is-visible" : ""}`} role="status">
        ✓ {toast}
      </div>

      <a className="repo-link" href={REPO_URL} onClick={(e) => (e.preventDefault(), openUrl(REPO_URL))}>
        Open source on GitHub
      </a>
    </div>
  );
}

/** Slots whose saved shortcut is currently held down, so pressing the pedal lights up its card. */
function usePressedSlots(slots: Slot[], paused: boolean) {
  const [pressed, setPressed] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (paused) return;
    const match = (e: KeyboardEvent) => {
      const key = keyForCode(e.code);
      if (!key) return undefined;
      const mods = foldSides(modifiersOf(e));
      return slots.find(
        (s) => s.action.kind === "key" && s.action.key === key.usage && foldSides(s.action.modifiers) === mods,
      );
    };
    const down = (e: KeyboardEvent) => {
      const hit = match(e);
      if (hit) setPressed((p) => new Set(p).add(hit.index));
    };
    const up = (e: KeyboardEvent) => {
      const key = keyForCode(e.code);
      if (!key) return;
      setPressed((p) => {
        const next = new Set(p);
        slots.forEach((s) => s.action.kind === "key" && s.action.key === key.usage && next.delete(s.index));
        return next;
      });
    };
    const clear = () => setPressed(new Set());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, [slots, paused]);

  return pressed;
}

function DeviceChip({ pedal, status }: { pedal: PedalState | null; status: Status }) {
  if (!pedal) {
    return (
      <span className="chip">
        <span className="dot dot-off" />
        {status === "loading" ? "Connecting…" : "No pedal"}
      </span>
    );
  }
  const { model, version } = parseFirmware(pedal.firmware);
  return (
    <span className="chip" title={`USB ${hex(pedal.vendorId)}:${hex(pedal.productId)}`}>
      <span className="dot dot-on" />
      {model}
      {version && <span className="chip-dim">firmware {version}</span>}
    </span>
  );
}

const hex = (n: number) => n.toString(16).padStart(4, "0");

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <div className="empty">
      <PedalArt />
      <h1>{loading ? "Reading your pedal…" : "Plug in your foot switch"}</h1>
      <p>
        Treadle works with PCsensor USB foot switches. If it's plugged in and nothing happens, close the PCsensor
        FootSwitch app and try another USB port.
      </p>
    </div>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="13" width="18" height="7" rx="2.5" fill="currentColor" opacity=".35" />
      <path d="M5 13 L17 6.5 a2 2 0 0 1 2.6 .9 l.4 .8 a2 2 0 0 1-.9 2.6 L11 14z" fill="currentColor" />
    </svg>
  );
}

function PedalArt() {
  return (
    <svg className="pedal-art" width="168" height="110" viewBox="0 0 168 110" aria-hidden>
      <rect x="10" y="66" width="148" height="34" rx="12" className="pedal-base" />
      <path d="M22 66 L132 22 a10 10 0 0 1 13 5 l3 7 a10 10 0 0 1-5 13 L64 78z" className="pedal-top" />
      <rect x="52" y="52" width="62" height="6" rx="3" transform="rotate(-22 83 55)" className="pedal-grip" />
    </svg>
  );
}

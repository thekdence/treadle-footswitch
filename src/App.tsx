import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type PedalState, type Slot, parseFirmware, pedalConnected, readPedal, writePedal } from "./api";
import { foldSides, keyForCode, modifiersOf } from "./keys";
import { ActionView, SlotEditor } from "./SlotEditor";
import { fitWindowToContent } from "./fitWindow";
import boardImg from "./assets/board.png";
import logoImg from "./assets/logo.png";
import pedalImg from "./assets/pedal.png";
import "./App.css";

const POLL_MS = 1500;
const REPO_URL = "https://github.com/thekdence/treadle-footswitch";

type Status = "searching" | "loading" | "ready" | "saving";

const same = (a: Slot, b?: Slot) => JSON.stringify(a) === JSON.stringify(b);

export default function App() {
  const [status, setStatus] = useState<Status>("searching");
  const [pedal, setPedal] = useState<PedalState | null>(null);
  const [draft, setDraft] = useState<Slot[]>([]);
  const [selected, setSelected] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [recording, setRecording] = useState<number | null>(null);
  const pressed = usePressedSlots(pedal?.slots ?? [], recording !== null, setSelected);

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
      if (!connected && (status === "ready" || error)) {
        setPedal(null);
        setDraft([]);
        setError(null);
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

  // Size the window to the pedal layout once it first appears.
  const ready = pedal !== null;
  useEffect(() => {
    if (ready) requestAnimationFrame(() => void fitWindowToContent().catch(() => {}));
  }, [ready]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  const changed = pedal ? draft.filter((s, i) => !same(s, pedal.slots[i])) : [];
  // Keep showing the last count while the save bar slides away.
  const shownCount = useRef(0);
  if (changed.length) shownCount.current = changed.length;

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
  const select = (index: number) => {
    setSelected(index);
    setRecording(null);
  };

  const current = draft.find((s) => s.index === selected) ?? draft[0];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={logoImg} alt="" width={26} height={26} />
          <span>Treadle</span>
        </div>
        <div className="row">
          <a className="topbar-link" href={REPO_URL} onClick={(e) => (e.preventDefault(), openUrl(REPO_URL))}>
            GitHub
          </a>
          <DeviceChip pedal={pedal} status={status} />
        </div>
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

        {!pedal || !current ? (
          <EmptyState loading={status === "loading"} />
        ) : (
          <>
            <div className="board" role="tablist" aria-label="Pedals">
              {draft.map((s, i) => (
                <PedalTile
                  key={s.index}
                  slot={s}
                  selected={s.index === current.index}
                  pressed={pressed.has(s.index)}
                  changed={!same(s, pedal.slots[i])}
                  onSelect={() => select(s.index)}
                />
              ))}
            </div>
            <p className="hint">
              Step on a pedal to jump to it. Shortcuts are saved on the pedal itself, so it works on any computer
              without Treadle running.
            </p>
            <SlotEditor
              key={current.index}
              title={`Pedal ${current.index}`}
              slot={current}
              recording={recording === current.index}
              onRecord={(on) => setRecording(on ? current.index : null)}
              onChange={updateSlot}
            />
          </>
        )}
      </main>

      <footer className={`savebar${changed.length ? " is-visible" : ""}`}>
        <span>
          {shownCount.current} {shownCount.current === 1 ? "pedal" : "pedals"} changed
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
        {toast && `✓ ${toast}`}
      </div>
    </div>
  );
}

function PedalTile(props: { slot: Slot; selected: boolean; pressed: boolean; changed: boolean; onSelect: () => void }) {
  const { slot, selected, pressed, changed } = props;
  const cls = ["tile", selected && "is-selected", pressed && "is-pressed"].filter(Boolean).join(" ");
  return (
    <button className={cls} role="tab" aria-selected={selected} onClick={props.onSelect}>
      <span className="tile-head">
        <span className="tile-num">Pedal {slot.index}</span>
        {pressed ? (
          <span className="badge badge-live">Pressed</span>
        ) : (
          changed && <span className="badge">Unsaved</span>
        )}
      </span>
      <img className="tile-img" src={pedalImg} alt="" draggable={false} />
      <span className="tile-action">
        <ActionView action={slot.action} compact />
      </span>
      {slot.action.kind === "key" && (
        <span className="tile-meta">
          {slot.action.mode === "hold" ? "Hold" : "Tap"}
          {slot.trigger && ` · on ${slot.trigger}`}
        </span>
      )}
    </button>
  );
}

/**
 * Slots whose saved shortcut is currently held down, so stepping on a pedal
 * lights up its tile. The most recent press is also selected.
 */
function usePressedSlots(slots: Slot[], paused: boolean, onPress: (index: number) => void) {
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
      if (!hit) return;
      e.preventDefault();
      if (!e.repeat) onPress(hit.index);
      setPressed((p) => new Set(p).add(hit.index));
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
  }, [slots, paused, onPress]);

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
      <img className="empty-img" src={boardImg} alt="" draggable={false} />
      <h1>{loading ? "Reading your pedal…" : "Plug in your foot switch"}</h1>
      <p>
        Treadle works with PCsensor USB foot switches. If it's plugged in and nothing happens, close the PCsensor
        FootSwitch app and try another USB port.
      </p>
    </div>
  );
}

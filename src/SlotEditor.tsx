import { useEffect, useRef } from "react";
import type { Action, KeyMode, Slot, Trigger } from "./api";
import { KEY_GROUPS, KEYS, keyForCode, keyLabel, modifierBit, modifierLabels } from "./keys";

interface Props {
  title: string;
  slot: Slot;
  recording: boolean;
  onRecord: (on: boolean) => void;
  onChange: (slot: Slot) => void;
}

export function SlotEditor({ title, slot, recording, onRecord, onChange }: Props) {
  const { action } = slot;
  const mode: KeyMode = action.kind === "key" ? action.mode : "hold";
  const editable = action.kind !== "other";

  const setAction = (a: Action) => onChange({ ...slot, action: a });
  const setKey = (modifiers: number, key: number) => setAction({ kind: "key", modifiers, key, mode });

  useShortcutRecorder(recording, (mods, key) => {
    setKey(mods, key);
    onRecord(false);
  }, () => onRecord(false));

  return (
    <section className={`editor${recording ? " is-recording" : ""}`} aria-label={`${title} settings`}>
      <header className="editor-head">
        <h2>{title}</h2>
      </header>

      <div className="editor-display" aria-live="polite">
        {recording ? (
          <span className="placeholder pulse">Press a key or shortcut… (Esc to cancel)</span>
        ) : (
          <ActionView action={action} />
        )}
      </div>

      {editable ? (
        <>
          <div className="row">
            <button
              className={recording ? "btn btn-recording" : "btn btn-primary"}
              onClick={() => onRecord(!recording)}
            >
              <span className="rec-dot" aria-hidden />
              {recording ? "Cancel" : "Record shortcut"}
            </button>
            <select
              className="btn select"
              aria-label="Choose a key"
              value={action.kind === "key" && action.key ? action.key : ""}
              onChange={(e) => setKey(action.kind === "key" ? action.modifiers : 0, Number(e.target.value))}
            >
              <option value="" disabled>
                Choose key…
              </option>
              {KEY_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {KEYS.filter((k) => k.group === g).map((k) => (
                    <option key={k.usage} value={k.usage}>
                      {k.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button className="btn btn-ghost" disabled={action.kind === "none"} onClick={() => setAction({ kind: "none" })}>
              Clear
            </button>
          </div>

          <div className="options">
            <Segmented<KeyMode>
              label="While pressed"
              value={mode}
              disabled={action.kind !== "key"}
              options={[
                ["hold", "Hold key", "Key stays down as long as your foot does. Great for push-to-talk."],
                ["tap", "Tap once", "Sends the shortcut a single time."],
              ]}
              onChange={(m) => action.kind === "key" && setAction({ ...action, mode: m })}
            />
            {slot.trigger && (
              <Segmented<Trigger>
                label="Fires on"
                value={slot.trigger}
                options={[
                  ["press", "Press", "Fires the moment the pedal goes down."],
                  ["release", "Release", "Fires when you lift your foot."],
                ]}
                onChange={(t) => onChange({ ...slot, trigger: t })}
              />
            )}
          </div>
        </>
      ) : (
        <p className="note">
          This pedal holds a mouse, text, media or macro action. Treadle can't edit those yet, so it will leave it
          exactly as it is.
        </p>
      )}
    </section>
  );
}

export function ActionView({ action, compact }: { action: Action; compact?: boolean }) {
  if (action.kind === "none") return <span className="placeholder">Not set</span>;
  if (action.kind === "other") return <span className="placeholder">Custom action</span>;
  const caps = [...modifierLabels(action.modifiers), ...(action.key ? [keyLabel(action.key)] : [])];
  return (
    <span className={`keys${compact ? " keys-compact" : ""}`}>
      {caps.map((c, i) => (
        <span key={i} className="keys-item">
          {i > 0 && <span className="plus">+</span>}
          <kbd>{c}</kbd>
        </span>
      ))}
    </span>
  );
}

function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: [T, string, string][];
  disabled?: boolean;
  onChange: (v: T) => void;
}) {
  const hint = props.options.find(([v]) => v === props.value)?.[2];
  return (
    <div className={`segmented${props.disabled ? " is-disabled" : ""}`}>
      <span className="segmented-label">{props.label}</span>
      <div className="segmented-track" role="radiogroup" aria-label={props.label}>
        {props.options.map(([v, text]) => (
          <button
            key={v}
            role="radio"
            aria-checked={props.value === v}
            disabled={props.disabled}
            className={props.value === v ? "is-on" : ""}
            onClick={() => props.onChange(v)}
          >
            {text}
          </button>
        ))}
      </div>
      {!props.disabled && <span className="segmented-hint">{hint}</span>}
    </div>
  );
}

/**
 * While `active`, swallow keyboard input and report the first shortcut:
 * modifiers plus one key, or modifiers alone once they're released.
 */
function useShortcutRecorder(active: boolean, onDone: (mods: number, key: number) => void, onCancel: () => void) {
  const held = useRef(0);
  const cb = useRef({ onDone, onCancel });
  cb.current = { onDone, onCancel };

  useEffect(() => {
    if (!active) return;
    held.current = 0;
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const bit = modifierBit(e.code);
      if (bit !== undefined) {
        held.current |= bit;
        return;
      }
      if (e.code === "Escape" && held.current === 0) return cb.current.onCancel();
      const key = keyForCode(e.code);
      if (key) cb.current.onDone(held.current, key.usage);
    };
    const up = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (modifierBit(e.code) !== undefined && held.current) cb.current.onDone(held.current, 0);
    };
    const cancel = () => cb.current.onCancel();
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", cancel);
    };
  }, [active]);
}

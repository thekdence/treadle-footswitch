# PCsensor foot switch protocol

How Treadle talks to PCsensor USB foot switches. This was worked out by
observing the devices, building on the MIT-licensed
[rgerganov/footswitch](https://github.com/rgerganov/footswitch) tool, and
studying how the vendor's configurator behaves. It is written here so other
projects can use it too.

Verified on: **iKKEGOL triple pedal, firmware ID FS2020U1IR_V5.7** (USB `3553:b001`).

## The big picture

The pedal stores its mappings in its own flash memory. Once programmed it is
just a USB keyboard (plus mouse and media-key collections), so it works on any
computer with no software running. A configurator only reads and writes those
stored mappings.

## Transport

The device exposes two USB interfaces:

| Interface | What it is |
| --- | --- |
| 0 | Keyboard, mouse and consumer-control HID collections: what the pedal "types" |
| 1 | Vendor configuration channel: 8-byte input and output reports, **no report IDs** |

All configuration happens on interface 1. Because the reports have no report
ID, hidapi-style APIs need a leading `0x00` before the 8 data bytes on write
(`[0x00, b0..b7]`). Forgetting it on Windows means the device silently ignores
every command.

Leave about 30 ms between writes; the firmware drops commands sent back to
back.

## Commands

Every command is one 8-byte report starting with `0x01`:

| Command | Bytes | Reply |
| --- | --- | --- |
| Read firmware ID | `01 83 08 00 00 00 00 00` | Up to 4 reports of NUL-padded ASCII, e.g. `FS2020U1IR_V5.7` |
| Read slot *n* | `01 82 08 nn 00 00 00 00` | One or more reports with the slot payload (below) |
| Read triggers | `01 86 00 00 00 00 00 00` | `len t1 t2 …` spanning 1–2 reports |
| Begin write | `01 80 80 01 00 00 00 00` | none |
| Write slot *n* | `01 81 08 nn 00 00 00 00`, then the payload report(s) | none |
| Write triggers | `01 85 LL 00 00 00 00 00`, then `LL t1 t2 …` | none |

Slots are numbered from 1. A sequence that saves changes looks like this:

1. Begin write, then wait about 100 ms.
2. For each changed slot: the slot header, then its payload.
3. If the firmware supports triggers: write the trigger block for **all**
   slots, waiting about 200 ms between the header and the payload.
4. Wait about 500 ms, then read everything back to confirm.

Slots you don't write keep their existing contents.

## Slot payload

The first payload report is `len type b2 b3 b4 b5 b6 b7`, where `len` is the
payload length (8 for a single report).

| `type` | Meaning | Layout |
| --- | --- | --- |
| `0x00` | Unconfigured | |
| `0x01` | Key, **held** while the pedal is down | `b2` = modifier mask, `b3` = HID key usage |
| `0x81` | Key, **tapped** once | same as `0x01` |
| `0x02` | Mouse | `b3` = mode, `b4` = buttons, `b5..b7` = X / Y / wheel (signed) |
| `0x04` | Typed text | HID usages follow, may span several reports |
| `0x06` / `0x86` | Multi-key combo (hold / tap) | `b2` = modifiers, `b3..` = up to 5 keys |
| `0x07` | Media key | `b2` = media function |
| `0x09` | Macro | references a stored macro |

Treadle edits only `0x00`, `0x01` and `0x81` so far. Every other type is read
back as raw bytes and never rewritten.

The modifier mask is the standard HID one: `0x01` LCtrl, `0x02` LShift,
`0x04` LAlt, `0x08` LGUI, `0x10` RCtrl, `0x20` RShift, `0x40` RAlt,
`0x80` RGUI. Key usages come from the USB HID Usage Tables, keyboard page `0x07`
(for example F15 = `0x6a`).

An empty slot is written as `08 01 00 00 00 00 00 00`.

## Triggers

Firmware newer than 3.4 stores a per-slot trigger: `1` fires on **press**,
`0` fires on **release**. The length byte counts itself, so for 3 slots the
header is `01 85 04 …` and the payload is `04 t1 t2 t3 00 00 00 00`.

## Slot counts

Each slot is one pedal. The firmware ID names the model family, and the
slot count follows the family, so don't read too much into the name: the
three-pedal iKKEGOL unit reports `FS2020U1IR`. See `slot_count` in
`src-tauri/src/pedal/protocol.rs`.

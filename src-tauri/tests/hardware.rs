//! Round-trip test against a real pedal. Changes the last pedal, checks it,
//! then puts the original setting back.
//!
//!     cargo test --test hardware -- --ignored --nocapture

use hidapi::HidApi;
use treadle_lib::pedal::protocol::{Action, KeyMode, Trigger};
use treadle_lib::pedal::{Pedal, SlotUpdate};

#[test]
#[ignore = "needs a foot switch plugged in"]
fn write_read_restore() {
    let mut api = HidApi::new().unwrap();
    let pedal = Pedal::open(&mut api).expect("no pedal connected");

    let before = pedal.read_state().unwrap();
    println!("firmware {}: {:?}", before.firmware, before.slots);
    let original = before.slots.last().unwrap().clone();
    assert!(original.action.is_editable(), "last pedal holds an action we can't restore");

    // Ctrl+Shift+F12, tapped, firing on release.
    let test = SlotUpdate {
        index: original.index,
        action: Action::Key { modifiers: 0x03, key: 0x45, mode: KeyMode::Tap },
        trigger: original.trigger.map(|_| Trigger::Release),
    };
    let after = pedal.write(std::slice::from_ref(&test)).unwrap();
    let written = after.slots.last().unwrap();
    let others_untouched = before.slots[..before.slots.len() - 1]
        .iter()
        .zip(&after.slots)
        .all(|(a, b)| a.action == b.action && a.trigger == b.trigger);

    let restored = pedal
        .write(&[SlotUpdate { index: original.index, action: original.action.clone(), trigger: original.trigger }])
        .unwrap();
    let back = restored.slots.last().unwrap();

    assert_eq!(written.action, test.action, "test shortcut didn't stick");
    assert_eq!(written.trigger, test.trigger, "trigger didn't stick");
    assert!(others_untouched, "other pedals changed");
    assert_eq!(back.action, original.action, "original not restored");
    assert_eq!(back.trigger, original.trigger, "original trigger not restored");
    println!("restored: {:?}", back);
}

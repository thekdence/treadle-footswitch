import { LogicalSize, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Grow the window so the page fits without scrolling, as far as the screen
 * allows. Never shrinks, so a window the user enlarged stays that way.
 */
export async function fitWindowToContent() {
  const overflow = document.documentElement.scrollHeight - window.innerHeight;
  if (overflow <= 0) return;

  const win = getCurrentWindow();
  const [outer, inner, scale, monitor] = await Promise.all([
    win.outerSize(),
    win.innerSize(),
    win.scaleFactor(),
    currentMonitor(),
  ]);
  const frame = (outer.height - inner.height) / scale;
  const screenHeight = monitor ? monitor.workArea.size.height / monitor.scaleFactor : Infinity;
  const height = Math.min(window.innerHeight + overflow, screenHeight - frame);

  await win.setSize(new LogicalSize(window.innerWidth, height));
  await win.center();
}

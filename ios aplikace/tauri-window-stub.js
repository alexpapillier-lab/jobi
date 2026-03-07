/**
 * Stub pro @tauri-apps/api/window – iOS app nepoužívá Tauri.
 */
export function getCurrentWindow() {
  return {
    listen: () => () => {},
    close: () => {},
    setFocus: () => {},
  };
}
export default { getCurrentWindow };

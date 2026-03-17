/**
 * Krátké zvuky při akcích (Web Audio API, žádné externí soubory).
 * Respektuje nastavení soundsEnabled (localStorage jobi_sounds_enabled, výchozí true).
 */

const STORAGE_KEY = "jobi_sounds_enabled";

let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    try {
      const C = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (C) audioContext = new C();
    } catch {
      return null;
    }
  }
  return audioContext;
}

export function areSoundsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "0" || v === "false") return false;
    return true;
  } catch {
    return true;
  }
}

export function setSoundsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // localStorage may be unavailable (private mode, etc.)
  }
}

function playTone(frequency: number, durationMs: number, volume: number = 0.15, type: OscillatorType = "sine") {
  const ctx = getContext();
  if (!ctx || !areSoundsEnabled()) return;

  const resume = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
  resume.then(() => {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + durationMs / 1000);
    } catch {
      // ignore
    }
  }).catch(() => {});
}

/** Dvojtón „vytvořeno“ – příjemné zakončení akce (např. nová zakázka) */
export function playCreated(): void {
  playTone(523.25, 70, 0.12);
  setTimeout(() => playTone(659.25, 90, 0.1), 80);
}

/** Krátký tón „uloženo“ */
export function playSaved(): void {
  playTone(587.33, 60, 0.1);
}

/** Nižší tón „smazáno“ */
export function playDeleted(): void {
  playTone(392, 80, 0.1);
}

/** Fanfára při odemknutí achievementu – příjemná trojice tónů */
export function playAchievementUnlock(): void {
  playTone(523.25, 90, 0.14);
  setTimeout(() => playTone(659.25, 90, 0.12), 100);
  setTimeout(() => playTone(783.99, 120, 0.1), 220);
}

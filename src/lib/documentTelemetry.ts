/**
 * Lightweight telemetry for document print/export operations.
 * Tracks success/failure rates, fallback usage, and timing
 * for debugging and quality monitoring. Data stays local (devLog).
 */
import { devLog, devWarn } from "./devLog";

export type DocumentAction = "print" | "export";
export type DocumentResult = "success" | "error" | "fallback";

export interface DocumentTelemetryEvent {
  action: DocumentAction;
  docType: string;
  result: DocumentResult;
  durationMs: number;
  errorMessage?: string;
  usedFallback?: boolean;
}

const recentEvents: DocumentTelemetryEvent[] = [];
const MAX_EVENTS = 50;

export function trackDocumentAction(event: DocumentTelemetryEvent): void {
  recentEvents.unshift(event);
  if (recentEvents.length > MAX_EVENTS) recentEvents.pop();

  const msg =
    `[DocTelemetry] ${event.action} ${event.docType}: ${event.result} (${event.durationMs}ms)` +
    (event.usedFallback ? " [FALLBACK]" : "") +
    (event.errorMessage ? ` err=${event.errorMessage}` : "");

  if (event.result === "error") {
    devWarn(msg);
  } else {
    devLog(msg);
  }
}

export function getDocumentTelemetryStats(): {
  total: number;
  success: number;
  error: number;
  fallback: number;
  avgDurationMs: number;
} {
  const total = recentEvents.length;
  const success = recentEvents.filter((e) => e.result === "success").length;
  const error = recentEvents.filter((e) => e.result === "error").length;
  const fallback = recentEvents.filter((e) => e.usedFallback).length;
  const avgDurationMs = total > 0
    ? Math.round(recentEvents.reduce((s, e) => s + e.durationMs, 0) / total)
    : 0;
  return { total, success, error, fallback, avgDurationMs };
}

/**
 * Helper to wrap a print/export operation with telemetry tracking.
 * Returns the result and automatically tracks the event.
 */
export async function withDocumentTelemetry<T extends { ok: boolean; error?: string }>(
  action: DocumentAction,
  docType: string,
  fn: () => Promise<T>,
  options?: { fallbackFn?: () => Promise<T> }
): Promise<T & { usedFallback?: boolean }> {
  const start = performance.now();
  let result: T;
  let usedFallback = false;

  try {
    result = await fn();

    if (!result.ok && options?.fallbackFn && result.error?.toLowerCase().includes("not found")) {
      usedFallback = true;
      result = await options.fallbackFn();
    }
  } catch (e) {
    const durationMs = Math.round(performance.now() - start);
    const errorMessage = e instanceof Error ? e.message : String(e);
    trackDocumentAction({ action, docType, result: "error", durationMs, errorMessage });
    throw e;
  }

  const durationMs = Math.round(performance.now() - start);
  trackDocumentAction({
    action,
    docType,
    result: result.ok ? (usedFallback ? "fallback" : "success") : "error",
    durationMs,
    errorMessage: result.ok ? undefined : result.error,
    usedFallback,
  });

  return { ...result, usedFallback };
}

// ---------------------------------------------------------------------------
// Payload validation guardrails
// ---------------------------------------------------------------------------

const MAX_HTML_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_PHOTO_PROTOCOLS = ["https:", "data:"];

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
}

export function validateDocumentVariables(variables: Record<string, string>): ValidationResult {
  const warnings: string[] = [];

  if (variables.photo_urls) {
    try {
      const urls = JSON.parse(variables.photo_urls);
      if (Array.isArray(urls)) {
        for (const url of urls) {
          if (typeof url === "string") {
            const isAllowed = ALLOWED_PHOTO_PROTOCOLS.some((p) => url.startsWith(p));
            if (!isAllowed) {
              warnings.push(`Photo URL uses disallowed protocol: ${url.slice(0, 50)}`);
            }
          }
        }
      }
    } catch {
      warnings.push("photo_urls is not valid JSON");
    }
  }

  if (variables.repair_items) {
    try {
      JSON.parse(variables.repair_items);
    } catch {
      warnings.push("repair_items is not valid JSON");
    }
  }

  return { valid: warnings.length === 0, warnings };
}

export function validateHtmlSize(html: string): ValidationResult {
  const warnings: string[] = [];
  const size = new Blob([html]).size;
  if (size > MAX_HTML_SIZE_BYTES) {
    warnings.push(`HTML size (${Math.round(size / 1024)}KB) exceeds limit (${MAX_HTML_SIZE_BYTES / 1024}KB)`);
  }
  return { valid: warnings.length === 0, warnings };
}

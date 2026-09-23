// Download state machine (PRD §29). Pure: the single place that decides which transitions are legal.
// JS drives CREATED…WAITING_FOR_SELECTION and ORGANIZING/COMPLETED; the native engine drives
// QUEUED…PROCESSING and reports back through events (docs/plan §8).

import type { DownloadStatus, FailureCode } from "@/db/schema";
import { failureState } from "@/domain/downloads/failure";

export type DownloadEvent =
  | { type: "START" }
  | { type: "VALID" }
  | { type: "DETECTED" }
  | { type: "RESOLVED" }
  | { type: "NEED_SELECTION" }
  | { type: "AUTO_SELECT" }
  | { type: "SELECT" }
  | { type: "ENGINE_START" }
  | { type: "DOWNLOAD_DONE"; needsProcessing: boolean }
  | { type: "PROCESS_DONE" }
  | { type: "ORGANIZED" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "CANCEL" }
  | { type: "FAIL"; code: FailureCode }
  | { type: "RETRY" }
  | { type: "REQUEUE" } // RETRYING → QUEUED (variant already resolved)
  | { type: "RE_RESOLVE" }; // RETRYING → RESOLVING (needs a fresh direct URL)

type Next = DownloadStatus | ((e: never) => DownloadStatus);
type Table = Partial<Record<DownloadStatus, Partial<Record<DownloadEvent["type"], Next>>>>;

const fail = (e: { code: FailureCode }) => failureState(e.code);

const TABLE: Table = {
  CREATED: { START: "VALIDATING", CANCEL: "CANCELED" },
  VALIDATING: { VALID: "DETECTING_PLATFORM", FAIL: fail, CANCEL: "CANCELED" },
  DETECTING_PLATFORM: { DETECTED: "RESOLVING", FAIL: fail, CANCEL: "CANCELED" },
  RESOLVING: { RESOLVED: "RESOLVED", FAIL: fail, CANCEL: "CANCELED" },
  RESOLVED: { NEED_SELECTION: "WAITING_FOR_SELECTION", AUTO_SELECT: "QUEUED", CANCEL: "CANCELED" },
  WAITING_FOR_SELECTION: { SELECT: "QUEUED", CANCEL: "CANCELED" },
  QUEUED: { ENGINE_START: "DOWNLOADING", PAUSE: "PAUSED", FAIL: fail, CANCEL: "CANCELED" },
  DOWNLOADING: {
    DOWNLOAD_DONE: (e: { needsProcessing: boolean }) => (e.needsProcessing ? "PROCESSING" : "ORGANIZING"),
    PAUSE: "PAUSED",
    FAIL: fail,
    CANCEL: "CANCELED",
  },
  PROCESSING: { PROCESS_DONE: "ORGANIZING", FAIL: fail, CANCEL: "CANCELED" },
  ORGANIZING: { ORGANIZED: "COMPLETED", FAIL: fail, CANCEL: "CANCELED" },
  PAUSED: { RESUME: "QUEUED", CANCEL: "CANCELED" },
  // Failures and cancellations can be retried; UNSUPPORTED (DRM etc.) cannot.
  FAILED: { RETRY: "RETRYING" },
  AUTH_REQUIRED: { RETRY: "RETRYING" },
  SOURCE_UNAVAILABLE: { RETRY: "RETRYING" },
  CANCELED: { RETRY: "RETRYING" },
  RETRYING: { REQUEUE: "QUEUED", RE_RESOLVE: "RESOLVING", FAIL: fail, CANCEL: "CANCELED" },
  // COMPLETED, UNSUPPORTED: terminal.
};

export class IllegalTransitionError extends Error {
  constructor(readonly from: DownloadStatus, readonly event: DownloadEvent["type"]) {
    super(`Illegal download transition: ${from} --${event}-->`);
  }
}

export function canTransition(from: DownloadStatus, event: DownloadEvent["type"]): boolean {
  return TABLE[from]?.[event] !== undefined;
}

export function transition(from: DownloadStatus, event: DownloadEvent): DownloadStatus {
  const next = TABLE[from]?.[event.type];
  if (next === undefined) throw new IllegalTransitionError(from, event.type);
  return typeof next === "function" ? (next as (e: DownloadEvent) => DownloadStatus)(event) : next;
}

export const TERMINAL: readonly DownloadStatus[] = ["COMPLETED", "UNSUPPORTED"];
export const ACTIVE: readonly DownloadStatus[] = ["DOWNLOADING", "PROCESSING", "ORGANIZING"];

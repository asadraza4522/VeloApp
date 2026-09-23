import type { DownloadStatus, FailureCode } from "@/db/schema";

// What the UI offers for a failure (PRD §15, §17). Copy/Share of the source URL are always available on top.
export type FailureAction = "retry" | "tryAgain" | "openSource" | "copyUrl" | "chooseFormat" | "tryAnotherResolver";

const ACTIONS: Record<FailureCode, FailureAction[]> = {
  NETWORK_ERROR: ["retry"],
  RATE_LIMITED: ["retry"],
  SERVER_ERROR: ["retry"],
  AUTH_REQUIRED: ["openSource", "tryAgain"],
  CAPTCHA_REQUIRED: ["openSource", "tryAgain"],
  PRIVATE: ["openSource", "copyUrl"],
  FORMAT_UNAVAILABLE: ["chooseFormat"],
  PROVIDER_CHANGED: ["tryAnotherResolver"],
  MEDIA_NOT_FOUND: ["openSource", "copyUrl"],
  UNSUPPORTED: ["openSource", "copyUrl"],
  DRM_PROTECTED: ["openSource", "copyUrl"], // never bypassed (PRD §17, §68)
  UNKNOWN: ["retry", "openSource", "copyUrl"],
};

export const actionsFor = (code: FailureCode): FailureAction[] => ACTIONS[code];

// Which terminal-ish download state a failure lands in.
export function failureState(code: FailureCode): DownloadStatus {
  switch (code) {
    case "AUTH_REQUIRED":
    case "PRIVATE":
    case "CAPTCHA_REQUIRED":
      return "AUTH_REQUIRED";
    case "UNSUPPORTED":
    case "DRM_PROTECTED":
      return "UNSUPPORTED";
    case "MEDIA_NOT_FOUND":
      return "SOURCE_UNAVAILABLE";
    default:
      return "FAILED";
  }
}

// Automatic retries: transient network errors only, then it is the user's call (docs/plan §8).
export const MAX_AUTO_RETRIES = 3;
export const shouldAutoRetry = (code: FailureCode, attempts: number) =>
  code === "NETWORK_ERROR" && attempts < MAX_AUTO_RETRIES;

import type { DOWNLOAD_STATUSES } from "@/db/schema";
import { actionsFor, failureState, shouldAutoRetry } from "@/domain/downloads/failure";
import { canTransition, IllegalTransitionError, transition, type DownloadEvent } from "@/domain/downloads/state-machine";

const run = (start: (typeof DOWNLOAD_STATUSES)[number], events: DownloadEvent[]) =>
  events.reduce((s, e) => transition(s, e), start);

describe("download state machine", () => {
  it("happy path with post-processing", () => {
    expect(
      run("CREATED", [
        { type: "START" }, { type: "VALID" }, { type: "DETECTED" }, { type: "RESOLVED" },
        { type: "NEED_SELECTION" }, { type: "SELECT" }, { type: "ENGINE_START" },
        { type: "DOWNLOAD_DONE", needsProcessing: true }, { type: "PROCESS_DONE" }, { type: "ORGANIZED" },
      ]),
    ).toBe("COMPLETED");
  });

  it("skips PROCESSING when nothing to post-process", () => {
    expect(transition("DOWNLOADING", { type: "DOWNLOAD_DONE", needsProcessing: false })).toBe("ORGANIZING");
  });

  it("pause/resume goes back through the queue", () => {
    expect(run("DOWNLOADING", [{ type: "PAUSE" }, { type: "RESUME" }])).toBe("QUEUED");
  });

  it.each([
    ["AUTH_REQUIRED", "AUTH_REQUIRED"], ["PRIVATE", "AUTH_REQUIRED"], ["CAPTCHA_REQUIRED", "AUTH_REQUIRED"],
    ["DRM_PROTECTED", "UNSUPPORTED"], ["UNSUPPORTED", "UNSUPPORTED"], ["MEDIA_NOT_FOUND", "SOURCE_UNAVAILABLE"],
    ["NETWORK_ERROR", "FAILED"], ["RATE_LIMITED", "FAILED"], ["UNKNOWN", "FAILED"],
  ] as const)("failure %s lands in %s", (code, state) => {
    expect(transition("RESOLVING", { type: "FAIL", code })).toBe(state);
    expect(failureState(code)).toBe(state);
  });

  it("retry paths", () => {
    expect(run("FAILED", [{ type: "RETRY" }, { type: "RE_RESOLVE" }])).toBe("RESOLVING");
    expect(run("CANCELED", [{ type: "RETRY" }, { type: "REQUEUE" }])).toBe("QUEUED");
  });

  it("DRM-protected (UNSUPPORTED) and COMPLETED are terminal", () => {
    for (const s of ["UNSUPPORTED", "COMPLETED"] as const) {
      for (const t of ["RETRY", "RESUME", "START", "CANCEL"] as const) expect(canTransition(s, t)).toBe(false);
    }
  });

  it("rejects illegal transitions", () => {
    expect(() => transition("CREATED", { type: "ENGINE_START" })).toThrow(IllegalTransitionError);
    expect(() => transition("COMPLETED", { type: "PAUSE" })).toThrow(IllegalTransitionError);
    expect(() => transition("PAUSED", { type: "PAUSE" })).toThrow(IllegalTransitionError);
  });

  it("every non-terminal in-flight state can be canceled", () => {
    const inFlight = ["CREATED", "VALIDATING", "DETECTING_PLATFORM", "RESOLVING", "RESOLVED", "WAITING_FOR_SELECTION", "QUEUED", "DOWNLOADING", "PROCESSING", "ORGANIZING", "PAUSED", "RETRYING"] as const;
    for (const s of inFlight) expect(transition(s, { type: "CANCEL" })).toBe("CANCELED");
  });
});

describe("failure policy", () => {
  it("DRM/private never offer a way around it", () => {
    expect(actionsFor("DRM_PROTECTED")).toEqual(["openSource", "copyUrl"]);
    expect(actionsFor("PRIVATE")).toEqual(["openSource", "copyUrl"]);
  });
  it("auto-retries only network errors, at most 3 times", () => {
    expect(shouldAutoRetry("NETWORK_ERROR", 2)).toBe(true);
    expect(shouldAutoRetry("NETWORK_ERROR", 3)).toBe(false);
    expect(shouldAutoRetry("AUTH_REQUIRED", 0)).toBe(false);
  });
});

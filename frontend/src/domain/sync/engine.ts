// One sync pass: sign in → register device → push outbox → pull changes → refresh cached server data.
import { kvCache } from "@/db/schema";
import type { Db } from "@/db/types";
import { refreshServerCaches } from "@/domain/sync/caches";
import { getDeviceId, getLocalSetting, setLocalSetting } from "@/domain/sync/device";
import { pullAll } from "@/domain/sync/pull";
import { parkedCount, pendingCount, pushOutbox } from "@/domain/sync/push";
import { RemoteError, type Remote, type RemoteErrorKind } from "@/domain/sync/remote";

export type SyncOutcome = {
  ok: boolean;
  at: number;
  pushed: number;
  pulled: number;
  parked: number;
  pending: number;
  error?: RemoteErrorKind;
  message?: string;
};

export const STATUS_KEY = "sync_status";

export async function syncOnce(deps: { db: Db; remote: Remote; distribution: "full" | "lite"; now?: () => number }): Promise<SyncOutcome> {
  const { db, remote } = deps;
  const now = deps.now ?? Date.now;
  const finish = (o: Omit<SyncOutcome, "at" | "pending" | "parked"> & { parked?: number }): SyncOutcome => {
    const out: SyncOutcome = { ...o, at: now(), parked: o.parked ?? parkedCount(db), pending: pendingCount(db) };
    db.insert(kvCache).values({ key: STATUS_KEY, value: JSON.stringify(out), fetchedAt: out.at })
      .onConflictDoUpdate({ target: kvCache.key, set: { value: JSON.stringify(out), fetchedAt: out.at } }).run();
    return out;
  };
  const fail = (e: unknown, extra: { pushed?: number; pulled?: number; parked?: number } = {}) => {
    const err = e instanceof RemoteError ? e : new RemoteError("network", e instanceof Error ? e.message : String(e));
    return finish({ ok: false, pushed: extra.pushed ?? 0, pulled: extra.pulled ?? 0, parked: extra.parked, error: err.kind, message: err.message });
  };

  try {
    await remote.userId();
    const deviceId = getDeviceId(db);
    if (!getLocalSetting(db, "device_registered")) {
      await remote.upsert("devices", [{ id: deviceId, platform: "android", distribution: deps.distribution, last_seen_at: new Date(now()).toISOString() }], "id");
      setLocalSetting(db, "device_registered", "1");
    }

    const push = await pushOutbox(db, remote);
    if (push.error) return fail(push.error, { pushed: push.pushed, parked: push.parked });

    const pull = await pullAll(db, remote, deviceId, now());
    if (pull.error) return fail(pull.error, { pushed: push.pushed, parked: push.parked });

    await refreshServerCaches(db, remote, now()).catch(() => {}); // flags/entitlements are best-effort
    return finish({ ok: true, pushed: push.pushed, pulled: pull.applied, parked: push.parked });
  } catch (e) {
    return fail(e);
  }
}

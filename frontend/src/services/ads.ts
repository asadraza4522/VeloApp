// AdMob wrapper. Loaded lazily (native module) and only when an ad is actually needed, never at startup.
// Policy (PRD §51): banners only on Home/Library, no interstitials, nothing during downloads; Premium users see no ads.
import { ensureSession } from "@/services/auth";

type Ads = typeof import("react-native-google-mobile-ads");

const REWARDED_ID = process.env.EXPO_PUBLIC_ADMOB_REWARDED_ID;
const BANNER_ID = process.env.EXPO_PUBLIC_ADMOB_BANNER_ID;
const TEST_DEVICE = process.env.EXPO_PUBLIC_ADMOB_TEST_DEVICE; // your phone's id from logcat: real units must never be clicked/watched by the developer outside test mode

let lib: Ads | null = null;
let ready: Promise<boolean> | null = null;

const load = (): Ads => (lib ??= require("react-native-google-mobile-ads") as Ads); // eslint-disable-line @typescript-eslint/no-require-imports

/** Real unit ids in release builds; Google's test units in dev. A release build without ids simply shows no ads. */
export function adUnit(kind: "rewarded" | "banner"): string | null {
  if (__DEV__) return kind === "rewarded" ? load().TestIds.REWARDED : load().TestIds.BANNER;
  return (kind === "rewarded" ? REWARDED_ID : BANNER_ID) ?? null;
}

/** EU/UK consent (UMP) first, then the SDK. Resolves false when ads may not be requested. */
export function initAds(): Promise<boolean> {
  return (ready ??= (async () => {
    try {
      const { AdsConsent, default: mobileAds } = load();
      if (TEST_DEVICE) await mobileAds().setRequestConfiguration({ testDeviceIdentifiers: [TEST_DEVICE] });
      const info = await AdsConsent.gatherConsent();
      if (!info.canRequestAds) return false;
      await mobileAds().initialize();
      return true;
    } catch {
      ready = null; // allow a retry later
      return false;
    }
  })());
}

export type RewardResult = "earned" | "closed" | "no-fill" | "error";

/**
 * Show one rewarded ad. `earned` only means the SDK saw the reward; Premium is granted by the server after Google's
 * signed callback (SSV), tagged with this user's id, so the caller must wait for the server snapshot to change.
 */
export async function showRewarded(): Promise<RewardResult> {
  const unit = adUnit("rewarded");
  if (!unit || !(await initAds())) return "error";
  const session = await ensureSession();
  const { RewardedAd, RewardedAdEventType, AdEventType } = load();

  return new Promise<RewardResult>((resolve) => {
    let earned = false;
    let settled = false;
    const finish = (r: RewardResult) => { if (!settled) { settled = true; clearTimeout(timer); unsubs.forEach((u) => u()); resolve(r); } };
    const ad = RewardedAd.createForAdRequest(unit, { serverSideVerificationOptions: { userId: session!.user.id } });
    const unsubs = [
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => void ad.show()),
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => { earned = true; }),
      ad.addAdEventListener(AdEventType.CLOSED, () => finish(earned ? "earned" : "closed")),
      ad.addAdEventListener(AdEventType.ERROR, (e: { code?: string }) => finish(e?.code === "googleMobileAds/error-code-no-fill" ? "no-fill" : "error")),
    ];
    const timer = setTimeout(() => finish("error"), 30_000); // never leave the button spinning
    ad.load();
  });
}

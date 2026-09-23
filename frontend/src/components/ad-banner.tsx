import { useEffect, useState } from "react";
import { View } from "react-native";

import { usePremium } from "@/db/use-premium";
import { adUnit, initAds } from "@/services/ads";

// Light, non-intrusive ads (PRD §51): one anchored banner on Home/Library for free users. Nothing while Premium is active.
export function AdBanner() {
  const premium = usePremium();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (premium.active || !adUnit("banner")) return;
    let live = true;
    void initAds().then((r) => live && setOk(r)); // consent + SDK start happen only when a banner is really needed
    return () => { live = false; };
  }, [premium.active]);

  if (premium.active || !ok) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BannerAd, BannerAdSize } = require("react-native-google-mobile-ads") as typeof import("react-native-google-mobile-ads");
  return (
    <View accessibilityLabel="Advertisement" style={{ alignItems: "center" }}>
      <BannerAd unitId={adUnit("banner")!} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} />
    </View>
  );
}

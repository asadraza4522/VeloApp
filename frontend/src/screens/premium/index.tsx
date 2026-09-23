import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";

import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { db } from "@/db/client";
import { usePremium } from "@/db/use-premium";
import { fonts, fontSize, makeStyles, spacing } from "@/design/theme";
import { formatRemaining, rewardAllowance, waitForPremiumChange } from "@/domain/monetization/premium";
import { getFlag, premiumUntil, refreshServerCaches, rewardedSecondsToday } from "@/domain/sync/caches";
import { isLite } from "@/distribution";
import { getOffer, purchasesAvailable, restorePurchases, type Offer } from "@/services/purchases";
import { showRewarded } from "@/services/ads";
import { createSupabaseRemote } from "@/services/supabase-remote";

const BENEFITS = ["No ads", "Advanced formats and batch downloads (coming)", "Advanced conversion and organization (coming)", "Cloud sync across devices"];
const remote = createSupabaseRemote();
const refresh = () => refreshServerCaches(db, remote, Date.now(), true).then(() => {});
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function PremiumScreen() {
  const styles = useStyles();
  const router = useRouter();
  const premium = usePremium();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"ad" | "buy" | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    void refresh().then(() => bump((n) => n + 1)).catch(() => {}); // fresh usage + entitlements when the sheet opens
    if (purchasesAvailable) void getOffer().then(setOffer).catch(() => {});
  }, []);

  const cap = getFlag<number>(db, "rewarded_hours_per_day", 4);
  const allowance = rewardAllowance(cap, rewardedSecondsToday(db));

  const confirm = async (before: number | null) => {
    setMessage("Verifying…");
    const r = await waitForPremiumChange({ before, refresh, readUntil: () => premiumUntil(db), sleep });
    setMessage(r === "confirmed" ? "Premium updated." : "Couldn't confirm it yet. It will appear shortly if it was valid.");
    bump((n) => n + 1);
  };

  const watchAd = async () => {
    if (!allowance.canWatch) return;
    setBusy("ad");
    setMessage("");
    try {
      const before = premiumUntil(db);
      const r = await showRewarded();
      if (r === "earned") await confirm(before);
      else setMessage(r === "closed" ? "Watch the whole ad to earn the hour." : r === "no-fill" ? "No ad available right now. Try again in a moment." : "Couldn't show an ad. Check your connection.");
    } finally {
      setBusy(null);
    }
  };

  const buy = async () => {
    if (!offer) return;
    setBusy("buy");
    try {
      const before = premiumUntil(db);
      if ((await offer.buy()) === "purchased") await confirm(before);
    } catch {
      setMessage("The purchase didn't complete.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      <Text style={styles.title}>{premium.active ? "Premium active" : "Velo Premium"}</Text>
      {premium.active && <Text style={styles.timer}>{premium.lifetime ? "Lifetime" : `${formatRemaining(premium.remainingMs)} remaining`}</Text>}

      <Card>
        <Text style={styles.cardTitle}>Watch an ad, get 1 hour</Text>
        <Text style={styles.detail}>Hours stack: a second ad adds to what is left, it never resets. {allowance.left} of {cap} left today.</Text>
        <Button label={allowance.canWatch ? "Watch ad +1 hour" : "Daily limit reached"} onPress={() => void watchAd()} disabled={!allowance.canWatch} loading={busy === "ad"} />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Go Premium</Text>
        {BENEFITS.map((b) => <Text key={b} style={styles.detail}>• {b}</Text>)}
        {purchasesAvailable ? (
          <>
            <Button label={offer ? `Subscribe · ${offer.price}` : "Loading price…"} onPress={() => void buy()} disabled={!offer} loading={busy === "buy"} />
            <Button label="Restore purchases" variant="ghost" onPress={() => void restorePurchases().then(() => confirm(premiumUntil(db))).catch(() => setMessage("Nothing to restore."))} />
          </>
        ) : (
          <Text style={styles.detail}>{isLite ? "Subscriptions aren't configured yet." : "Subscriptions are available in the Google Play version of Velo. Rewarded hours work everywhere."}</Text>
        )}
      </Card>

      {message !== "" && <Text style={styles.message}>{message}</Text>}
      <Button label="Close" variant="ghost" onPress={() => router.back()} />
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  body: { padding: spacing.xl, gap: spacing.lg },
  title: { fontFamily: fonts.display, fontSize: fontSize.h1, color: c.onSurface },
  timer: { fontFamily: fonts.display, fontSize: fontSize.display, color: c.mutedAmber, fontVariant: ["tabular-nums"] },
  cardTitle: { fontFamily: fonts.textSemiBold, fontSize: fontSize.bodyLg, color: c.onSurface },
  detail: { fontFamily: fonts.text, fontSize: fontSize.body, color: c.mutedSecondary },
  message: { fontFamily: fonts.textMedium, fontSize: fontSize.body, color: c.onSurfaceSecondary },
}));

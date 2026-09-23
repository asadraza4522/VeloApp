// RevenueCat (Play Billing). Only the Lite/Play build can sell subscriptions: sideloaded APKs (Full) cannot use Play Billing.
// Premium itself always comes from the server (RevenueCat webhook → entitlements), never from this client-side result.
import { isLite } from "@/distribution";
import { ensureSession } from "@/services/auth";

const API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;

export const purchasesAvailable = isLite && Boolean(API_KEY);

type Purchases = typeof import("react-native-purchases").default;
let lib: Purchases | null = null;
let configured: Promise<void> | null = null;

const load = (): Purchases => (lib ??= (require("react-native-purchases") as { default: Purchases }).default); // eslint-disable-line @typescript-eslint/no-require-imports

function configure(): Promise<void> {
  return (configured ??= (async () => {
    const session = await ensureSession();
    load().configure({ apiKey: API_KEY!, appUserID: session!.user.id }); // same id the webhook maps back to a Supabase user
  })().catch((e) => { configured = null; throw e; }));
}

export type Offer = { price: string; title: string; buy: () => Promise<"purchased" | "cancelled"> };

export async function getOffer(): Promise<Offer | null> {
  if (!purchasesAvailable) return null;
  await configure();
  const offering = (await load().getOfferings()).current;
  const pkg = offering?.availablePackages[0];
  if (!pkg) return null;
  return {
    price: pkg.product.priceString,
    title: pkg.product.title,
    buy: async () => {
      try {
        await load().purchasePackage(pkg);
        return "purchased";
      } catch (e) {
        if ((e as { userCancelled?: boolean }).userCancelled) return "cancelled";
        throw e;
      }
    },
  };
}

export async function restorePurchases(): Promise<void> {
  if (!purchasesAvailable) return;
  await configure();
  await load().restorePurchases();
}

import { QueryClient } from "@tanstack/react-query";

// Server calls only (resolve, entitlements, flags). Local data lives in SQLite, not here.
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 }, mutations: { retry: 0 } } });

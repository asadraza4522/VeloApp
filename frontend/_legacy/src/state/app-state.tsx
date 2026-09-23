import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  controlDownload,
  deleteDownload,
  DownloadJob,
  getSyncState,
  listDownloads,
  putSyncState,
} from "@/src/api";
import { clearJobNotification, trackJobNotifications } from "@/src/notifications";
import { storage } from "@/src/utils/storage";

export type SourceStatus = "Downloaded" | "Saved" | "File missing" | "Failed";
export type SourceType = "VIDEO" | "AUDIO" | "IMAGE";

export type Source = {
  id: string;
  title: string;
  creator: string;
  platform: string;
  type: SourceType;
  status: SourceStatus;
  duration: string;
  url: string;
  thumbnail?: string | null;
  localUri?: string;
  fileUrl?: string;
};

const SOURCES_KEY = "@velo_sources";
const AUTH_KEY = "@velo_signed_in";
const EMAIL_KEY = "@velo_auth_email";
const WIFI_KEY = "@velo_wifi_only";
const WORKSPACE_KEY = "@velo_workspace";
const JOB_POLL_MS = 2500;

export const seedSources: Source[] = [
  { id: "s1", title: "React Native Architecture Guide", creator: "Velo Labs", platform: "YouTube", type: "VIDEO", status: "Downloaded", duration: "18:42", url: "https://youtube.com/watch?v=velo-demo", thumbnail: "https://images.pexels.com/photos/9665193/pexels-photo-9665193.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940" },
  { id: "s2", title: "Design systems that scale", creator: "Studio Notes", platform: "Vimeo", type: "VIDEO", status: "File missing", duration: "09:18", url: "https://vimeo.com/velo-design", thumbnail: "https://images.unsplash.com/photo-1526289034009-0240ddb68ce3?crop=entropy&cs=srgb&fm=jpg&q=85" },
  { id: "s3", title: "Focus playlist — deep work", creator: "Velo Radio", platform: "SoundCloud", type: "AUDIO", status: "Saved", duration: "42:10", url: "https://soundcloud.com/velo/focus", thumbnail: null },
];

type AppStateValue = {
  sources: Source[];
  addSource: (source: Source, action: "saved" | "downloaded") => void;
  updateSource: (url: string, patch: Partial<Source>) => void;
  jobs: DownloadJob[];
  refreshJobs: () => Promise<void>;
  actJob: (jobId: string, action: "pause" | "resume") => Promise<void>;
  removeJob: (jobId: string) => Promise<void>;
  signedIn: boolean;
  authEmail: string;
  signIn: (email: string) => void;
  signOut: () => void;
  wifiOnly: boolean;
  setWifiOnly: (value: boolean) => void;
  workspace: string;
  synced: boolean;
  toast: string;
  notify: (message: string) => void;
  activeSource: Source | null;
  openSource: (source: Source) => void;
  closeSource: () => void;
  authVisible: boolean;
  openAuth: () => void;
  closeAuth: () => void;
};

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<Source[]>(seedSources);
  const [hydrated, setHydrated] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [wifiOnly, setWifiOnlyState] = useState(true);
  const [workspace, setWorkspace] = useState("");
  const [synced, setSynced] = useState(false);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [toast, setToast] = useState("");
  const [activeSource, setActiveSource] = useState<Source | null>(null);
  const [authVisible, setAuthVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevJobStatuses = useRef<Map<string, string>>(new Map());

  const notify = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  // Hydrate local state, then pull the cloud workspace (backend wins when it
  // already holds sources; otherwise local data is pushed up by the effect below).
  useEffect(() => {
    (async () => {
      let ws = await storage.getItem(WORKSPACE_KEY, "");
      if (!ws) {
        ws = `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        await storage.setItem(WORKSPACE_KEY, ws);
      }
      setWorkspace(ws);

      const raw = await storage.getItem(SOURCES_KEY, "");
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Source[];
          if (Array.isArray(parsed) && parsed.length) setSources(parsed);
        } catch {
          // corrupted payload — keep seeds
        }
      }
      const auth = await storage.getItem(AUTH_KEY, false);
      const email = await storage.getItem(EMAIL_KEY, "");
      const wifi = await storage.getItem(WIFI_KEY, true);
      setSignedIn(Boolean(auth));
      if (email) setAuthEmail(email);
      setWifiOnlyState(wifi !== false);

      try {
        const remote = await getSyncState(ws);
        if (Array.isArray(remote.sources) && remote.sources.length) {
          setSources(remote.sources as Source[]);
        }
        if (remote.settings && typeof remote.settings.wifiOnly === "boolean") {
          setWifiOnlyState(remote.settings.wifiOnly);
        }
        setSynced(true);
      } catch {
        setSynced(false);
      }
      setHydrated(true);
    })();
  }, []);

  // Persist locally
  useEffect(() => {
    if (hydrated) storage.setItem(SOURCES_KEY, JSON.stringify(sources));
  }, [sources, hydrated]);

  // Debounced cloud push on every sources/settings change
  useEffect(() => {
    if (!hydrated || !workspace) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(async () => {
      try {
        await putSyncState(workspace, sources, { wifiOnly });
        setSynced(true);
      } catch {
        setSynced(false);
      }
    }, 1500);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [sources, wifiOnly, hydrated, workspace]);

  // Global download-job poller: powers the Queue UI and local notifications.
  const refreshJobs = useCallback(async () => {
    if (!workspace) return;
    try {
      const data = await listDownloads(workspace);
      setJobs(data);
      data.forEach((job) => {
        const prev = prevJobStatuses.current.get(job.id);
        if (prev && prev !== job.status) {
          if (job.status === "ready") notify(`Ready to save · ${job.title}`);
          if (job.status === "failed") notify(`Failed · ${job.title}`);
        }
        prevJobStatuses.current.set(job.id, job.status);
      });
      trackJobNotifications(data);
    } catch {
      // backend unreachable — keep last known list
    }
  }, [workspace, notify]);

  useEffect(() => {
    if (!workspace) return;
    refreshJobs();
    const interval = setInterval(refreshJobs, JOB_POLL_MS);
    return () => clearInterval(interval);
  }, [workspace, refreshJobs]);

  const actJob = useCallback(
    async (jobId: string, action: "pause" | "resume") => {
      try {
        await controlDownload(jobId, action);
        notify(action === "pause" ? "Download paused" : "Download resumed");
      } catch {
        notify("Action failed — the job may have finished");
      }
      refreshJobs();
    },
    [notify, refreshJobs],
  );

  const removeJob = useCallback(
    async (jobId: string) => {
      try {
        await deleteDownload(jobId);
        await clearJobNotification(jobId);
        notify("Removed from queue");
      } catch {
        notify("Remove failed");
      }
      refreshJobs();
    },
    [notify, refreshJobs],
  );

  const value = useMemo<AppStateValue>(
    () => ({
      sources,
      addSource: (source, action) => {
        setSources((current) => [source, ...current.filter((item) => item.id !== source.id)]);
        setActiveSource(null);
        notify(action === "saved" ? "Source saved to your library" : "Added to the download queue");
      },
      updateSource: (url, patch) => {
        setSources((current) => current.map((item) => (item.url === url ? { ...item, ...patch } : item)));
      },
      jobs,
      refreshJobs,
      actJob,
      removeJob,
      signedIn,
      authEmail,
      signIn: (email) => {
        setSignedIn(true);
        setAuthEmail(email);
        storage.setItem(AUTH_KEY, true);
        storage.setItem(EMAIL_KEY, email);
        setAuthVisible(false);
        notify("Signed in locally · MOCKED AUTH");
      },
      signOut: () => {
        setSignedIn(false);
        setAuthEmail("");
        storage.setItem(AUTH_KEY, false);
        storage.removeItem(EMAIL_KEY);
        notify("Signed out — library stays on this device");
      },
      wifiOnly,
      setWifiOnly: (next) => {
        setWifiOnlyState(next);
        storage.setItem(WIFI_KEY, next);
      },
      workspace,
      synced,
      toast,
      notify,
      activeSource,
      openSource: setActiveSource,
      closeSource: () => setActiveSource(null),
      authVisible,
      openAuth: () => setAuthVisible(true),
      closeAuth: () => setAuthVisible(false),
    }),
    [sources, jobs, refreshJobs, actJob, removeJob, signedIn, authEmail, wifiOnly, workspace, synced, toast, activeSource, authVisible, notify],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (!value) throw new Error("useAppState must be used inside AppStateProvider");
  return value;
}

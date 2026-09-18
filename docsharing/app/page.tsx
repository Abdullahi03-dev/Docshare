"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

/* ---------------------------------- utils --------------------------------- */

// Feature flag: Offline LAN mode is parked for now — the toggle and LAN
// panel below are hidden until this is flipped back to true.
const OFFLINE_MODE_ENABLED = false;

const BACKEND_CONFIGURED = !!process.env.NEXT_PUBLIC_API_URL;

function getApiBase() {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1")
      return "http://localhost:3001/api";
    // Phone on the same Wi-Fi opening http://<laptop-ip>:3000 → talk to :3001.
    // (Only over plain http; https live sites must set NEXT_PUBLIC_API_URL.)
    if (window.location.protocol === "http:") return `http://${h}:3001/api`;
  }
  return "http://localhost:3001/api";
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function extOf(name: string) {
  const parts = name.split(".");
  const ext = parts.length > 1 ? parts.pop()!.toUpperCase() : "";
  return ext && ext.length <= 5 ? ext : "FILE";
}
function formatCountdown(expiresAt: string | null) {
  if (!expiresAt) return "";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "expired";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

/* ---------------------------------- types --------------------------------- */

type ShareFile = {
  originalName: string;
  storedName: string;
  size: number;
  mimetype: string;
};

type ShareResponse = {
  code: string;
  qr: string;
  burn: boolean;
  ttlMinutes: number;
  files: ShareFile[];
  expiresAt: string;
};

type ShareMeta = {
  code: string;
  burn: boolean;
  ttlMinutes: number;
  files: ShareFile[];
  expiresAt: string;
};

type NetworkInfo = {
  ips: string[];
  port: number;
  frontendPort: number;
  lanUrls: string[];
  apiLanUrls: string[];
};

/* ---------------------------------- icons --------------------------------- */

function Mark() {
  return (
    <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-zinc-950 text-white dark:bg-white dark:text-black">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M8 12.2V4.6"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d="M5.2 7.4 8 4.6l2.8 2.8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M4 13.6h8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function UploadGlyph() {
  return (
    <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 shadow-[0_1px_2px_rgba(0,0,0,0.05)] dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:shadow-none">
      <svg width="22" height="22" viewBox="0 0 18 18" fill="none" aria-hidden>
        <path
          d="M9 12.5v-9M5.5 6.5 9 3l3.5 3.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M3.5 12.5h11"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function FileGlyph() {
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
      <svg width="16" height="16" viewBox="0 0 15 15" fill="none" aria-hidden>
        <path
          d="M3.5 1.8h5l3 3v8.4h-8V1.8Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M8.3 1.8v3.2h3"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function CheckGlyph() {
  return (
    <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-zinc-950 text-white dark:bg-white dark:text-black">
      <svg width="19" height="19" viewBox="0 0 18 18" fill="none" aria-hidden>
        <path
          d="m4.5 9.2 2.7 2.7 6.3-6.4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export default function Home() {
  const [mode, setMode] = useState<"online" | "local">("online");
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [share, setShare] = useState<ShareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [apiDot, setApiDot] = useState<"checking" | "online" | "offline">(
    "checking"
  );
  const [liveHost, setLiveHost] = useState(false);
  const [noticeOff, setNoticeOff] = useState(false);

  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [selectedIp, setSelectedIp] = useState("");

  const [codeInput, setCodeInput] = useState("");
  const [recvMeta, setRecvMeta] = useState<ShareMeta | null>(null);
  const [recvLoading, setRecvLoading] = useState(false);
  const [recvError, setRecvError] = useState<string | null>(null);

  const [ttl, setTtl] = useState(30);
  const [burn, setBurn] = useState(false);

  const [isDark, setIsDark] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  /* theme */
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    const h = window.location.hostname;
    setLiveHost(h !== "localhost" && h !== "127.0.0.1");
  }, []);

  const toggleTheme = useCallback(() => {
    const el = document.documentElement;
    const next = !el.classList.contains("dark");
    el.classList.toggle("dark", next);
    try {
      localStorage.setItem("docshare-theme", next ? "dark" : "light");
    } catch {}
    setIsDark(next);
  }, []);

  /* health — quiet, footer only */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/health`);
        const data = await res.json();
        if (alive) setApiDot(data.status === "ok" ? "online" : "offline");
      } catch {
        if (alive) setApiDot("offline");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* LAN network info for offline mode */
  const fetchNetworkInfo = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/network-info`);
      if (!res.ok) return;
      const data = (await res.json()) as NetworkInfo;
      setNetworkInfo(data);
      if (data.ips.length > 0) {
        setSelectedIp((prev) =>
          prev && data.ips.includes(prev) ? prev : data.ips[0]
        );
      }
    } catch {
      /* backend unreachable — panel will say so */
    }
  }, []);

  useEffect(() => {
    fetchNetworkInfo();
  }, [fetchNetworkInfo]);

  /* countdown */
  useEffect(() => {
    if (!share?.expiresAt) return;
    const tick = () => setCountdown(formatCountdown(share.expiresAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [share]);

  /* upload */
  const startUpload = useCallback(
    (list: File[]) => {
      const arr = Array.from(list).filter((f) => f.size > 0);
      if (arr.length === 0) return;
      setPending(arr);
      setUploading(true);
      setProgress(0);
      setError(null);
      setShare(null);

      const fd = new FormData();
      arr.forEach((f) => fd.append("files", f));
      fd.append("expiresIn", String(ttl));
      if (burn) fd.append("burn", "true");

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", `${getApiBase()}/share`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        if (xhr.status >= 200 && xhr.status < 300) {
          const data = JSON.parse(xhr.responseText) as ShareResponse;
          setShare(data);
          setPending([]);
        } else {
          setError(xhr.responseText || "Upload failed. Try again.");
          setPending([]);
        }
      } catch {
        setError("Upload failed. Try again.");
        setPending([]);
      } finally {
        setUploading(false);
      }
    };
    xhr.onerror = () => {
      setError("Could not reach the server. Is the backend running?");
      setPending([]);
      setUploading(false);
    };
    xhr.send(fd);
    },
    [ttl, burn]
  );

  const resetAll = useCallback(() => {
    try {
      xhrRef.current?.abort();
    } catch {}
    setPending([]);
    setUploading(false);
    setProgress(0);
    setShare(null);
    setError(null);
    setCopiedLink(false);
    setCopiedCode(false);
  }, []);

  const killShare = useCallback(async () => {
    if (!share) return;
    try {
      await fetch(`${getApiBase()}/share/${share.code}`, {
        method: "DELETE",
      });
    } catch {}
    resetAll();
  }, [share, resetAll]);

  const shareLink =
    share && typeof window !== "undefined"
      ? `${window.location.origin}/r/${share.code}`
      : (share?.qr ?? "");

  const lanLink =
    share && selectedIp
      ? `http://${selectedIp}:${networkInfo?.frontendPort ?? 3000}/r/${share.code}`
      : "";

  const onCopyLink = useCallback(async () => {
    const text = mode === "local" && lanLink ? lanLink : shareLink;
    if (!text) return;
    if (await copyText(text)) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    }
  }, [shareLink, lanLink, mode]);

  const onCopyCode = useCallback(async () => {
    if (!share) return;
    if (await copyText(share.code)) {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    }
  }, [share]);

  /* receive */
  const fetchShare = useCallback(async (code: string) => {
    const c = code.trim();
    if (!/^\d{4}$/.test(c)) {
      setRecvError("Enter the 4-digit code.");
      return;
    }
    setRecvLoading(true);
    setRecvError(null);
    setRecvMeta(null);
    try {
      const res = await fetch(`${getApiBase()}/share/${c}`);
      if (!res.ok) throw new Error(await res.text());
      setRecvMeta((await res.json()) as ShareMeta);
    } catch (e: unknown) {
      setRecvError(e instanceof Error ? e.message : "Not found or expired.");
    } finally {
      setRecvLoading(false);
    }
  }, []);

  const totalBytes = pending.reduce((n, f) => n + f.size, 0);
  const shareTotal = share ? share.files.reduce((n, f) => n + f.size, 0) : 0;
  const showConfigNotice = !BACKEND_CONFIGURED && liveHost && !noticeOff;

  const statusLabel =
    !BACKEND_CONFIGURED && liveHost
      ? "not configured"
      : apiDot === "checking"
        ? "connecting"
        : apiDot;

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-white text-zinc-950 dark:bg-[#0a0a0a] dark:text-zinc-50">
      {/* dot-grid backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle,#d9d9de_1px,transparent_1.2px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black_0%,transparent_62%)] dark:[background-image:radial-gradient(circle,#232326_1px,transparent_1.2px)]"
      />

      {/* header */}
      <header className="relative mx-auto flex w-full max-w-3xl items-center justify-between px-6 pt-6">
        <a href="/" className="flex items-center gap-2.5">
          <Mark />
          <span className="font-grotesk text-[17px] font-bold tracking-tight">
            Docshare
          </span>
        </a>
        <nav className="flex items-center gap-5">
          <a
            href="#share"
            className="hidden font-mono text-[12px] text-zinc-400 transition-colors duration-150 hover:text-zinc-900 sm:inline dark:hover:text-zinc-100"
          >
            Share
          </a>
          <a
            href="#receive"
            className="hidden font-mono text-[12px] text-zinc-400 transition-colors duration-150 hover:text-zinc-900 sm:inline dark:hover:text-zinc-100"
          >
            Receive
          </a>
          <a
            href="/direct"
            className="hidden font-mono text-[12px] text-zinc-400 transition-colors duration-150 hover:text-zinc-900 sm:inline dark:hover:text-zinc-100"
          >
            Direct
          </a>
          <span className="hidden h-4 w-px bg-zinc-200 sm:block dark:bg-zinc-800" />
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-400">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                statusLabel === "online"
                  ? "live-dot bg-zinc-900 dark:bg-zinc-100"
                  : "bg-zinc-300 dark:bg-zinc-700"
              }`}
            />
            {statusLabel}
          </span>
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="grid h-8 w-8 place-items-center rounded-lg border border-zinc-200 bg-white/70 text-zinc-500 backdrop-blur transition-colors duration-150 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
          >
            {isDark ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle
                  cx="7"
                  cy="7"
                  r="3"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path
                  d="M7 1v1.4M7 11.6V13M1 7h1.4M11.6 7H13M2.8 2.8l1 1M10.2 10.2l1 1M11.2 2.8l-1 1M3.8 10.2l-1 1"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M11.5 8.2A4.7 4.7 0 0 1 5.8 2.5a4.7 4.7 0 1 0 5.7 5.7Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </nav>
      </header>

      {/* main */}
      <main className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pb-24 pt-14 sm:pt-[72px]">
        {/* hero */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-3">
            <span className="h-px w-8 bg-zinc-300 dark:bg-zinc-700" />
            <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-zinc-400">
              Private file transfer
            </p>
            <span className="h-px w-8 bg-zinc-300 dark:bg-zinc-700" />
          </div>
          <h1 className="mx-auto mt-5 font-grotesk text-[52px] font-bold leading-[0.98] tracking-[-0.045em] sm:text-[76px]">
            Send files,
            <br />
            <span className="font-instrument font-normal italic tracking-[-0.02em]">
              simply.
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Drop a file, get a link. No accounts, no clutter — gone in 30
            minutes.
          </p>

          {/* mode switch (offline parked — see OFFLINE_MODE_ENABLED) */}
          {OFFLINE_MODE_ENABLED && (
            <>
              <div className="mt-8 inline-flex items-center rounded-full border border-zinc-200 bg-white/70 p-1 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/70">
            <button
              onClick={() => setMode("online")}
              className={`rounded-full px-5 py-1.5 text-[13px] font-medium transition-all duration-150 ${
                mode === "online"
                  ? "bg-zinc-950 text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] dark:bg-white dark:text-black dark:shadow-none"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              Online
            </button>
            <button
              onClick={() => {
                setMode("local");
                fetchNetworkInfo();
              }}
              className={`rounded-full px-5 py-1.5 text-[13px] font-medium transition-all duration-150 ${
                mode === "local"
                  ? "bg-zinc-950 text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] dark:bg-white dark:text-black dark:shadow-none"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              Offline LAN
            </button>
          </div>
          <p className="mt-3 font-mono text-[11px] text-zinc-400">
            {mode === "online"
              ? "via server · works anywhere · 30 min expiry"
              : "direct Wi-Fi · no internet needed · same network"}
          </p>
            </>
          )}
        </div>

        {/* backend-not-configured notice (live deployments) */}
        {showConfigNotice && (
          <div className="rise mx-auto mt-10 w-full max-w-xl rounded-xl border border-zinc-200 bg-white/80 p-5 text-left backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
            <div className="flex items-start justify-between gap-3">
              <p className="font-grotesk text-[15px] font-bold tracking-tight">
                Backend not connected
              </p>
              <button
                onClick={() => setNoticeOff(true)}
                aria-label="Dismiss"
                className="rounded px-1 font-mono text-xs text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              This page has no API to talk to, so uploads will fail. Point it
              at your Render backend, then redeploy:
            </p>
            <ol className="mt-3 space-y-1.5 font-mono text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              <li>
                <span className="text-zinc-400">1.</span> Vercel → Project →
                Settings → Environment Variables
              </li>
              <li>
                <span className="text-zinc-400">2.</span> Add{" "}
                <span className="rounded border border-zinc-200 bg-[#fafafa] px-1.5 py-0.5 dark:border-zinc-700 dark:bg-black">
                  NEXT_PUBLIC_API_URL
                </span>
              </li>
              <li>
                <span className="text-zinc-400">3.</span> Value:{" "}
                <span className="rounded border border-zinc-200 bg-[#fafafa] px-1.5 py-0.5 dark:border-zinc-700 dark:bg-black">
                  https://your-backend.onrender.com/api
                </span>
              </li>
              <li>
                <span className="text-zinc-400">4.</span> Redeploy the project
              </li>
            </ol>
          </div>
        )}

        {/* offline LAN panel (parked — see OFFLINE_MODE_ENABLED) */}
        {OFFLINE_MODE_ENABLED && mode === "local" && (
          <div className="rise mx-auto mt-10 w-full max-w-xl rounded-xl border border-zinc-200 bg-white/80 p-6 text-left backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
            <div className="flex items-baseline justify-between">
              <p className="font-grotesk text-[15px] font-bold tracking-tight">
                Go offline
              </p>
              <p className="font-mono text-[11px] text-zinc-400">
                no internet · same Wi-Fi
              </p>
            </div>
            <ol className="mt-4 space-y-3">
              {[
                "Connect laptop and phone to the same Wi-Fi — or turn on your laptop hotspot.",
                "Run both apps on your laptop. They already listen on 0.0.0.0, nothing to configure.",
                "Phone scans the QR after upload, or opens the LAN link directly.",
              ].map((step, i) => (
                <li key={i} className="flex gap-3 text-[13px] leading-relaxed">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-zinc-200 font-mono text-[10px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                    {i + 1}
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {step}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex items-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-900">
              <span className="shrink-0 font-mono text-[11px] text-zinc-400">
                LAPTOP IP
              </span>
              {networkInfo?.ips?.length ? (
                <select
                  value={selectedIp}
                  onChange={(e) => setSelectedIp(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-[#fafafa] px-3 py-2 font-mono text-[12px] focus:border-zinc-950 focus:outline-none dark:border-zinc-700 dark:bg-black dark:focus:border-zinc-100"
                >
                  {networkInfo.ips.map((ip) => (
                    <option key={ip} value={ip}>
                      {ip} → http://{ip}:{networkInfo.frontendPort}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[13px] text-zinc-500 dark:text-zinc-400">
                  Detecting… is the backend running?
                </span>
              )}
              <button
                onClick={fetchNetworkInfo}
                className="shrink-0 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium transition-colors duration-150 hover:border-zinc-950 dark:border-zinc-700 dark:hover:border-zinc-100"
              >
                Refresh
              </button>
            </div>
          </div>
        )}

        {/* share options — expiry + burn, chosen before upload */}
        {!share && pending.length === 0 && !uploading && (
          <div className="rise mx-auto mt-10 flex w-full max-w-xl flex-wrap items-center justify-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                Expires
              </span>
              <div className="flex items-center rounded-full border border-zinc-200 p-0.5 dark:border-zinc-800">
                {[
                  { label: "10m", value: 10 },
                  { label: "30m", value: 30 },
                  { label: "1h", value: 60 },
                  { label: "24h", value: 1440 },
                ].map((o) => (
                  <button
                    key={o.value}
                    onClick={() => setTtl(o.value)}
                    className={`rounded-full px-3 py-1 font-mono text-[11px] transition-all duration-150 ${
                      ttl === o.value
                        ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                        : "text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                Burn after reading
              </span>
              <button
                role="switch"
                aria-checked={burn}
                aria-label="Burn after reading"
                onClick={() => setBurn((b) => !b)}
                className={`relative h-5 w-9 rounded-full border transition-colors duration-150 ${
                  burn
                    ? "border-zinc-950 bg-zinc-950 dark:border-zinc-100 dark:bg-zinc-100"
                    : "border-zinc-300 bg-transparent dark:border-zinc-700"
                }`}
              >
                <span
                  className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all duration-150 ${
                    burn
                      ? "left-[18px] bg-white dark:bg-black"
                      : "left-[3px] bg-zinc-400 dark:bg-zinc-600"
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {/* workspace */}
        <div id="share" className="mt-10 scroll-mt-8">
          {share ? (
            /* ------------------------------ share result ----------------------------- */
            <div className="rise py-6 text-center">
              <CheckGlyph />
              <h2 className="mt-6 font-grotesk text-[30px] font-bold tracking-[-0.03em]">
                Ready to share
              </h2>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                {share.files.length} file{share.files.length > 1 ? "s" : ""} ·{" "}
                {formatBytes(shareTotal)} · expires in{" "}
                <span className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
                  {countdown}
                </span>
              </p>
              {share.burn && (
                <p className="mx-auto mt-3 w-fit rounded-full border border-zinc-950 px-3 py-1 font-mono text-[11px] text-zinc-900 dark:border-zinc-100 dark:text-zinc-100">
                  self-destructs after first download
                </p>
              )}

              {mode === "local" && lanLink ? (
                <div className="mx-auto mt-8 max-w-xl">
                  <div className="mx-auto w-fit rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-white dark:shadow-none">
                    <QRCodeSVG
                      value={lanLink}
                      size={172}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#09090b"
                    />
                  </div>
                  <div className="mt-5 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/80 p-2 pl-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
                    <span className="min-w-0 flex-1 truncate text-left font-mono text-[13px] text-zinc-700 dark:text-zinc-300">
                      {lanLink}
                    </span>
                    <button
                      onClick={onCopyLink}
                      className="shrink-0 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:opacity-80 active:scale-[0.98] dark:bg-white dark:text-black"
                    >
                      {copiedLink ? "Copied ✓" : "Copy link"}
                    </button>
                  </div>
                  <p className="mt-2.5 font-mono text-[11px] text-zinc-400">
                    scan with your phone — same Wi-Fi
                  </p>
                </div>
              ) : (
                <div className="mx-auto mt-8 flex max-w-xl items-center gap-2 rounded-xl border border-zinc-200 bg-white/80 p-2 pl-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
                  <span className="min-w-0 flex-1 truncate text-left font-mono text-[13px] text-zinc-700 dark:text-zinc-300">
                    {shareLink}
                  </span>
                  <button
                    onClick={onCopyLink}
                    className="shrink-0 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:opacity-80 active:scale-[0.98] dark:bg-white dark:text-black"
                  >
                    {copiedLink ? "Copied ✓" : "Copy link"}
                  </button>
                </div>
              )}

              <div className="mt-7">
                <div className="inline-flex items-center gap-3">
                  <span className="font-mono text-[30px] font-medium tracking-[0.3em] text-zinc-900 dark:text-zinc-100">
                    {share.code}
                  </span>
                  <button
                    onClick={onCopyCode}
                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors duration-150 hover:border-zinc-950 hover:text-zinc-950 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-100 dark:hover:text-zinc-100"
                  >
                    {copiedCode ? "Copied ✓" : "Copy code"}
                  </button>
                </div>
                <p className="mt-2 font-mono text-[11px] text-zinc-400">
                  or share the 4-digit code
                </p>
              </div>

              <ul className="mx-auto mt-8 max-w-xl divide-y divide-zinc-100 border-y border-zinc-100 text-left dark:divide-zinc-900 dark:border-zinc-900">
                {share.files.map((f) => (
                  <li
                    key={f.storedName}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <span
                      className="truncate text-sm text-zinc-700 dark:text-zinc-300"
                      title={f.originalName}
                    >
                      {f.originalName}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-zinc-400">
                      {extOf(f.originalName)} · {formatBytes(f.size)}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex items-center justify-center gap-2">
                <button
                  onClick={resetAll}
                  className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:opacity-80 active:scale-[0.98] dark:bg-white dark:text-black"
                >
                  Share another
                </button>
                <button
                  onClick={killShare}
                  className="rounded-lg px-4 py-2.5 text-sm text-zinc-400 transition-colors duration-150 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  Stop sharing
                </button>
              </div>
            </div>
          ) : uploading || pending.length > 0 ? (
            /* ------------------------------ uploading ------------------------------ */
            <div className="rise rounded-xl border border-zinc-200 bg-white/80 p-6 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
              <div className="flex items-center gap-4">
                <FileGlyph />
                <div className="min-w-0 flex-1 text-left">
                  <p
                    className="truncate text-sm font-medium"
                    title={pending.map((f) => f.name).join(", ")}
                  >
                    {pending.length === 1
                      ? pending[0].name
                      : `${pending.length} files`}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-zinc-400">
                    {formatBytes(totalBytes)} · {progress}% · uploading
                  </p>
                </div>
                <button
                  onClick={resetAll}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-xs text-zinc-400 transition-colors duration-150 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  Cancel
                </button>
              </div>
              <div className="mt-5 h-[3px] overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                <div
                  className="h-full rounded-full bg-zinc-950 transition-[width] duration-150 dark:bg-white"
                  style={{ width: `${progress}%` }}
                />
              </div>
              {pending.length > 1 && (
                <ul className="mt-4 space-y-1.5">
                  {pending.map((f) => (
                    <li
                      key={f.name + f.size}
                      className="flex justify-between gap-3 text-[13px]"
                    >
                      <span
                        className="truncate text-zinc-600 dark:text-zinc-400"
                        title={f.name}
                      >
                        {f.name}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-zinc-400">
                        {extOf(f.name)} · {formatBytes(f.size)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            /* --------------------------------- idle -------------------------------- */
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ")
                  fileRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files?.length)
                  startUpload(Array.from(e.dataTransfer.files));
              }}
              className={`relative cursor-pointer rounded-2xl border border-dashed px-6 py-16 text-center transition-all duration-150 sm:py-20 ${
                dragOver
                  ? "scale-[1.01] border-zinc-950 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900"
                  : "border-zinc-300 bg-white/70 backdrop-blur hover:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950/70 dark:hover:border-zinc-100"
              }`}
            >
              <span
                aria-hidden
                className="absolute left-3 top-2.5 select-none font-mono text-[13px] text-zinc-300 dark:text-zinc-700"
              >
                +
              </span>
              <span
                aria-hidden
                className="absolute right-3 top-2.5 select-none font-mono text-[13px] text-zinc-300 dark:text-zinc-700"
              >
                +
              </span>
              <span
                aria-hidden
                className="absolute bottom-2.5 left-3 select-none font-mono text-[13px] text-zinc-300 dark:text-zinc-700"
              >
                +
              </span>
              <span
                aria-hidden
                className="absolute bottom-2.5 right-3 select-none font-mono text-[13px] text-zinc-300 dark:text-zinc-700"
              >
                +
              </span>
              <UploadGlyph />
              <p className="mt-6 font-grotesk text-[19px] font-bold tracking-[-0.02em]">
                {dragOver
                  ? "Let go to upload"
                  : mode === "local"
                    ? "Drop it here — never leaves your network"
                    : "Drag & drop your files"}
              </p>
              <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                or{" "}
                <span className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100">
                  browse from your computer
                </span>
              </p>
              <div className="mt-6 flex items-center justify-center gap-2">
                {["1 GB max", "Any type", "30 min expiry"].map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1 font-mono text-[10.5px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
                  >
                    {chip}
                  </span>
                ))}
              </div>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length)
                    startUpload(Array.from(e.target.files));
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {error && (
            <p className="rise mt-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {error}{" "}
              <button onClick={resetAll} className="underline underline-offset-4">
                Try again
              </button>
            </p>
          )}
        </div>

        {/* divider */}
        <div className="my-16 flex items-center gap-4">
          <span className="h-px flex-1 bg-zinc-100 dark:bg-zinc-900" />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-300 dark:text-zinc-700">
            Receive
          </span>
          <span className="h-px flex-1 bg-zinc-100 dark:bg-zinc-900" />
        </div>

        {/* receive */}
        <div id="receive" className="mx-auto w-full max-w-md scroll-mt-8 text-center">
          <h3 className="font-grotesk text-[22px] font-bold tracking-[-0.02em]">
            Got a code?
          </h3>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            Punch in the 4 digits and grab the files.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              fetchShare(codeInput);
            }}
            className="mt-6 flex gap-2"
          >
            <input
              value={codeInput}
              onChange={(e) =>
                setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="0000"
              inputMode="numeric"
              maxLength={4}
              aria-label="Share code"
              className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white/70 px-4 py-3 text-center font-mono text-xl tracking-[0.45em] backdrop-blur placeholder:text-zinc-300 focus:border-zinc-950 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950/70 dark:placeholder:text-zinc-700 dark:focus:border-zinc-100"
            />
            <button
              type="submit"
              disabled={recvLoading}
              aria-label="Fetch share"
              className="grid w-[52px] shrink-0 place-items-center rounded-xl bg-zinc-950 text-white transition-all duration-150 hover:opacity-80 active:scale-[0.97] disabled:opacity-40 dark:bg-white dark:text-black"
            >
              <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2.5 8h11M9.5 4.5 13 8l-3.5 3.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </form>

          {recvError && (
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
              {recvError}
            </p>
          )}

          {recvMeta && (
            <div className="rise mt-6 rounded-xl border border-zinc-200 bg-white/80 text-left backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
              <div className="flex items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-mono text-sm tracking-[0.2em]">
                    {recvMeta.code}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {recvMeta.files.length} file
                    {recvMeta.files.length > 1 ? "s" : ""} · expires{" "}
                    {new Date(recvMeta.expiresAt).toLocaleTimeString()}
                    {recvMeta.burn ? " · self-destructs on download" : ""}
                  </p>
                </div>
                <a
                  href={`${getApiBase()}/share/${recvMeta.code}/download`}
                  className="shrink-0 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:opacity-80 active:scale-[0.98] dark:bg-white dark:text-black"
                >
                  Download{recvMeta.files.length > 1 ? " all" : ""}
                </a>
              </div>
              <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-900 dark:border-zinc-900">
                {recvMeta.files.map((f, i) => (
                  <li
                    key={f.storedName}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm"
                        title={f.originalName}
                      >
                        {f.originalName}
                      </p>
                      <p className="font-mono text-[11px] text-zinc-400">
                        {extOf(f.originalName)} · {formatBytes(f.size)}
                      </p>
                    </div>
                    <a
                      href={`${getApiBase()}/share/${recvMeta.code}/download/${i}`}
                      className="shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium transition-colors duration-150 hover:border-zinc-950 dark:border-zinc-800 dark:hover:border-zinc-100"
                    >
                      Save
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>

      {/* footer */}
      <footer className="relative border-t border-zinc-100 dark:border-zinc-900">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-5">
          <p className="flex items-center gap-2 font-mono text-[11px] text-zinc-400">
            <span className="grid h-4 w-4 place-items-center rounded bg-zinc-950 text-[8px] font-bold text-white dark:bg-white dark:text-black">
              D
            </span>
            Docshare — no sign-up, no clutter
          </p>
          <p className="font-mono text-[11px] text-zinc-400">
            auto-deletes in 30 min ·{" "}
            <a
              href="https://github.com/Abdullahi03-dev/Docshare"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 transition-colors duration-150 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              source
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

function getApiBase() {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env) return env;
  if (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
    return `http://${window.location.hostname}:3001/api`;
  }
  return "http://localhost:3001/api";
}
const API_FALLBACK = "http://localhost:3001/api";

type ShareFile = {
  originalName: string;
  storedName: string;
  size: number;
  mimetype: string;
};

type ShareResponse = {
  code: string;
  qr: string;
  files: ShareFile[];
  expiresAt: string;
};

type ShareMeta = {
  code: string;
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

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatCountdown(expiresAt: string | null) {
  if (!expiresAt) return "";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "expired";
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Home() {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [share, setShare] = useState<ShareResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState("");
  const [health, setHealth] = useState("checking...");
  const [codeInput, setCodeInput] = useState("");
  const [recvMeta, setRecvMeta] = useState<ShareMeta | null>(null);
  const [recvLoading, setRecvLoading] = useState(false);
  const [recvError, setRecvError] = useState<string | null>(null);
  const [tab, setTab] = useState<"share" | "receive">("share");
  const [relayMode, setRelayMode] = useState<"online" | "local">("online");
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [selectedIp, setSelectedIp] = useState<string>("");

  const API = typeof window !== "undefined" ? getApiBase() : API_FALLBACK;

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/health`);
      const data = await res.json();
      setHealth(data.status === "ok" ? "online" : "offline");
    } catch {
      setHealth("offline");
    }
  }, []);

  const fetchNetworkInfo = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/network-info`);
      if (!res.ok) throw new Error("no network-info");
      const data: NetworkInfo = await res.json();
      setNetworkInfo(data);
      if (data.ips.length > 0 && !selectedIp) setSelectedIp(data.ips[0]);
    } catch {
      // silent — offline build still works without LAN
    }
  }, [selectedIp]);

  useEffect(() => {
    checkHealth();
    fetchNetworkInfo();
  }, [checkHealth, fetchNetworkInfo]);

  useEffect(() => {
    if (!share?.expiresAt) return;
    const id = setInterval(() => setCountdown(formatCountdown(share.expiresAt)), 1000);
    setCountdown(formatCountdown(share.expiresAt));
    return () => clearInterval(id);
  }, [share]);

  const uploadFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    setMessage(null);
    try {
      const fd = new FormData();
      arr.forEach((f) => fd.append("files", f));
      const res = await fetch(`${getApiBase()}/share`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data: ShareResponse = await res.json();
      setShare(data);
      setMessage(`Shared ${data.files.length} file(s) • code ${data.code}`);
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) uploadFiles(e.target.files);
    e.target.value = "";
  };

  const killShare = async () => {
    if (!share) return;
    if (!confirm(`Stop sharing ${share.code}? Files will be deleted.`)) return;
    await fetch(`${getApiBase()}/share/${share.code}`, { method: "DELETE" });
    setShare(null);
    setMessage("Share stopped & files deleted");
  };

  const copyCode = async (c: string) => {
    await navigator.clipboard.writeText(c);
    setMessage(`Copied code ${c}`);
    setTimeout(() => setMessage(null), 2000);
  };

  const fetchShare = async (code: string) => {
    const c = code.trim();
    if (!/^\d{4}$/.test(c)) {
      setRecvError("Enter 4-digit code");
      return;
    }
    setRecvLoading(true);
    setRecvError(null);
    setRecvMeta(null);
    try {
      const res = await fetch(`${getApiBase()}/share/${c}`);
      if (!res.ok) throw new Error(await res.text());
      const data: ShareMeta = await res.json();
      setRecvMeta(data);
    } catch (e: unknown) {
      setRecvError(e instanceof Error ? e.message : "Not found or expired");
    } finally {
      setRecvLoading(false);
    }
  };

  const downloadShare = (code: string) => {
    window.location.href = `${getApiBase()}/share/${code}/download`;
  };

  // QR for display: online uses backend qr (FRONTEND_URL), local uses LAN IP
  const displayQrUrl = share
    ? relayMode === "local" && selectedIp
      ? `http://${selectedIp}:3000/r/${share.code}`
      : share.qr
    : "";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <header className="sticky top-0 z-10 border-b bg-white/80 dark:bg-zinc-900/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-black dark:bg-white text-white dark:text-black grid place-items-center font-bold text-sm">FS</div>
            <span className="font-semibold tracking-tight">FileSharer</span>
            <span className="text-xs text-zinc-500 hidden sm:inline">
              {relayMode === "local" ? "local LAN · offline" : "online relay · 30 min"}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 border ${health === "online" ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-950 dark:border-green-900 dark:text-green-300" : "bg-red-50 border-red-200 text-red-700"}`}>
              <span className={`h-2 w-2 rounded-full ${health === "online" ? "bg-green-500" : "bg-red-500"} animate-pulse`} />
              {health}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-6">
        {/* Relay Mode Toggle — Second option: Local LAN (works anywhere offline) */}
        <div className="rounded-2xl border bg-white dark:bg-zinc-900 dark:border-zinc-800 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-medium">Relay mode</p>
              <p className="text-xs text-zinc-500">
                {relayMode === "online" ? "Online: via server, works anywhere (needs internet)" : "Local: direct LAN, no internet — phone & laptop same WiFi/hotspot"}
              </p>
            </div>
            <div className="flex gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-full">
              <button
                onClick={() => setRelayMode("online")}
                className={`px-4 py-1.5 rounded-full text-xs font-medium transition ${relayMode === "online" ? "bg-black dark:bg-white text-white dark:text-black shadow" : "text-zinc-600 dark:text-zinc-400"}`}
              >
                Online
              </button>
              <button
                onClick={() => setRelayMode("local")}
                className={`px-4 py-1.5 rounded-full text-xs font-medium transition ${relayMode === "local" ? "bg-black dark:bg-white text-white dark:text-black shadow" : "text-zinc-600 dark:text-zinc-400"}`}
              >
                Local LAN
              </button>
            </div>
          </div>

          {relayMode === "local" && (
            <div className="mt-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs">
              <p className="font-medium text-amber-800 dark:text-amber-300">Offline setup:</p>
              <ol className="list-decimal list-inside mt-1 text-amber-700 dark:text-amber-400 space-y-0.5">
                <li>Connect laptop + phone to same WiFi (or laptop hotspot).</li>
                <li>Backend + Next.js must run on <code className="bg-white dark:bg-zinc-900 px-1 rounded border">0.0.0.0</code> (already configured).</li>
                <li>Phone scans QR below → opens <code className="bg-white dark:bg-zinc-900 px-1 rounded border">http://LAN_IP:3000/r/CODE</code>.</li>
                <li>Allow firewall for ports 3000/3001 if prompted.</li>
              </ol>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="text-zinc-600 dark:text-zinc-400">LAN IP:</span>
                {networkInfo?.ips?.length ? (
                  <select
                    value={selectedIp}
                    onChange={(e) => setSelectedIp(e.target.value)}
                    className="rounded-full border dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1 text-xs"
                  >
                    {networkInfo.ips.map((ip) => (
                      <option key={ip} value={ip}>
                        {ip} → http://{ip}:3000
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-zinc-500">Detecting… (is backend running? GET /api/network-info)</span>
                )}
                <button onClick={fetchNetworkInfo} className="rounded-full border dark:border-zinc-700 px-3 py-1 text-xs hover:bg-white dark:hover:bg-zinc-800">
                  Refresh IP
                </button>
              </div>
              {networkInfo?.ips.length === 0 && (
                <p className="mt-1 text-amber-600 dark:text-amber-400">No LAN IP found — you’re offline isolated or backend not reachable on LAN.</p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-full w-fit">
          <button onClick={() => setTab("share")} className={`px-5 py-2 rounded-full text-sm font-medium transition ${tab === "share" ? "bg-black dark:bg-white text-white dark:text-black shadow" : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"}`}>Share</button>
          <button onClick={() => setTab("receive")} className={`px-5 py-2 rounded-full text-sm font-medium transition ${tab === "receive" ? "bg-black dark:bg-white text-white dark:text-black shadow" : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"}`}>Receive</button>
        </div>

        {message && (
          <div className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2.5 text-sm flex justify-between items-center">
            <span>{message}</span>
            <button onClick={() => setMessage(null)} className="opacity-70 hover:opacity-100 ml-4 shrink-0">✕</button>
          </div>
        )}

        {tab === "share" ? (
          <>
            {share ? (
              <div className="rounded-2xl border bg-white dark:bg-zinc-900 dark:border-zinc-800 overflow-hidden">
                <div className="px-6 py-5 flex gap-6 flex-col sm:flex-row sm:items-center">
                  <div className="flex-1">
                    <p className="text-xs uppercase tracking-widest text-zinc-500">Your code</p>
                    <div className="flex items-baseline gap-3 mt-1">
                      <span className="text-5xl font-black tracking-widest tabular-nums">{share.code}</span>
                      <button onClick={() => copyCode(share.code)} className="text-xs rounded-full border px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:border-zinc-700">Copy</button>
                    </div>
                    <p className="text-sm text-zinc-500 mt-2">
                      Expires in {countdown} • {share.files.length} file(s) • {relayMode === "local" ? "LAN only" : "online"} • 30 min auto-delete
                    </p>
                    <div className="flex flex-wrap gap-2 mt-4">
                      <a href={`${API}/share/${share.code}/download`} className="rounded-full bg-black dark:bg-white text-white dark:text-black px-4 py-2 text-sm font-medium hover:opacity-90 inline-flex items-center gap-1.5">↓ Test download</a>
                      <button onClick={killShare} className="rounded-full border border-red-200 text-red-600 dark:border-red-900 dark:text-red-400 px-4 py-2 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950">Stop sharing</button>
                      <button onClick={() => setShare(null)} className="rounded-full border dark:border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">Share more</button>
                    </div>
                    <ul className="mt-4 divide-y dark:divide-zinc-800 border dark:border-zinc-800 rounded-xl overflow-hidden">
                      {share.files.map((f) => (
                        <li key={f.storedName} className="px-3 py-2 flex justify-between text-sm bg-zinc-50/50 dark:bg-zinc-800/30">
                          <span className="truncate pr-3" title={f.originalName}>{f.originalName}</span>
                          <span className="text-zinc-500 shrink-0">{formatBytes(f.size)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="shrink-0 flex flex-col items-center gap-2 border dark:border-zinc-800 rounded-xl p-3 bg-white dark:bg-zinc-900">
                    {/* Local QR — works offline, no external API */}
                    {displayQrUrl ? (
                      <QRCodeSVG value={displayQrUrl} size={180} level="M" className="rounded-lg" />
                    ) : (
                      <div className="w-[180px] h-[180px] grid place-items-center text-xs text-zinc-400">No URL</div>
                    )}
                    <a href={displayQrUrl} className="text-xs text-zinc-500 break-all text-center max-w-[180px] hover:underline">
                      {displayQrUrl}
                    </a>
                    <p className="text-[11px] text-zinc-400">
                      {relayMode === "local" ? "Scan on same WiFi" : "Scan with phone"}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={`rounded-2xl border-2 border-dashed bg-white dark:bg-zinc-900 p-8 text-center transition ${dragOver ? "border-black dark:border-white bg-zinc-100 dark:bg-zinc-800" : "border-zinc-200 dark:border-zinc-800"} ${uploading ? "opacity-60 pointer-events-none" : ""}`}
              >
                <div className="mx-auto max-w-sm flex flex-col items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 grid place-items-center text-xl">↑</div>
                  <div>
                    <p className="font-medium">{uploading ? "Uploading..." : "Drop files here"}</p>
                    <p className="text-sm text-zinc-500">One or many · any type · up to 1GB each · auto-zipped on download</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-full bg-black dark:bg-white px-6 py-2.5 text-sm font-medium text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 transition">
                    {uploading ? "Please wait..." : "Choose files"}
                    <input type="file" multiple className="hidden" onChange={onInputChange} disabled={uploading} />
                  </label>
                  <p className="text-xs text-zinc-400">or drag & drop multiple</p>
                </div>
              </div>
            )}

            <div className="rounded-2xl border bg-white dark:bg-zinc-900 dark:border-zinc-800 p-5">
              <h3 className="font-medium text-sm">How it works</h3>
              <ol className="mt-3 grid sm:grid-cols-3 gap-3 text-sm text-zinc-600 dark:text-zinc-400">
                <li className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3">
                  <span className="font-semibold text-black dark:text-white">1.</span> Drop files → get 4-digit code (1000-9999, no dup while active, 9000 concurrent max)
                </li>
                <li className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3">
                  <span className="font-semibold text-black dark:text-white">2.</span> Phone enters code at <code className="bg-white dark:bg-zinc-900 px-1 rounded border dark:border-zinc-700">/r/CODE</code> or scan QR
                  {relayMode === "local" && <span className="block mt-1 text-[11px]">Local: <code className="bg-white dark:bg-zinc-900 px-1 rounded border">http://LAN_IP:3000/r/CODE</code></span>}
                </li>
                <li className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3">
                  <span className="font-semibold text-black dark:text-white">3.</span> Download streams; multi-file auto-zips. Expires in 30 min, deletes from disk.
                </li>
              </ol>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border bg-white dark:bg-zinc-900 dark:border-zinc-800 p-6">
            <h2 className="font-medium">Enter 4-digit code</h2>
            <p className="text-sm text-zinc-500">From {relayMode === "local" ? "local QR (same WiFi)" : "laptop share screen or QR link"}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetchShare(codeInput);
              }}
              className="mt-4 flex gap-3"
            >
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="4829"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                className="flex-1 rounded-full border dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-5 py-3 text-center text-2xl tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
              />
              <button type="submit" disabled={recvLoading} className="rounded-full bg-black dark:bg-white text-white dark:text-black px-6 py-3 text-sm font-medium hover:opacity-90 disabled:opacity-50">
                {recvLoading ? "..." : "Fetch"}
              </button>
            </form>
            {recvError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{recvError}</p>}
            {recvMeta && (
              <div className="mt-5 border dark:border-zinc-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 flex items-center justify-between">
                  <span className="text-sm font-medium">Code {recvMeta.code} • {recvMeta.files.length} file(s) • expires {new Date(recvMeta.expiresAt).toLocaleTimeString()}</span>
                  <button onClick={() => downloadShare(recvMeta.code)} className="rounded-full bg-black dark:bg-white text-white dark:text-black px-4 py-1.5 text-xs font-medium hover:opacity-90">
                    Download {recvMeta.files.length > 1 ? "ZIP" : "file"}
                  </button>
                </div>
                <ul className="divide-y dark:divide-zinc-800">
                  {recvMeta.files.map((f, i) => (
                    <li key={f.storedName} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium" title={f.originalName}>{f.originalName}</p>
                        <p className="text-xs text-zinc-500">{formatBytes(f.size)} · {f.mimetype}</p>
                      </div>
                      <a href={`${API}/share/${recvMeta.code}/download/${i}`} className="shrink-0 rounded-full border dark:border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800">Download</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <p className="text-center text-xs text-zinc-400">
          Backend: <code className="bg-white dark:bg-zinc-900 border dark:border-zinc-800 px-1.5 py-0.5 rounded">{API}</code> · {relayMode === "local" ? "Local LAN (offline)" : "Relay"} · no DB
        </p>
      </main>
    </div>
  );
}

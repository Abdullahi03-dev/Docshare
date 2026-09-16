"use client";

import { use, useEffect, useState } from "react";

function getApiBase() {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1")
      return "http://localhost:3001/api";
    // Phone on the same Wi-Fi opening http://<laptop-ip>:3000 → talk to :3001.
    if (window.location.protocol === "http:") return `http://${h}:3001/api`;
  }
  return "http://localhost:3001/api";
}

type ShareMeta = {
  code: string;
  files: {
    originalName: string;
    storedName: string;
    size: number;
    mimetype: string;
  }[];
  expiresAt: string;
};

function formatBytes(b: number) {
  if (!b) return "0 B";
  const k = 1024;
  const s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(2)) + " " + s[i];
}

function extOf(name: string) {
  const parts = name.split(".");
  const ext = parts.length > 1 ? parts.pop()!.toUpperCase() : "";
  return ext && ext.length <= 5 ? ext : "FILE";
}

export default function RPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const API = getApiBase();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/share/${code}`);
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as ShareMeta;
        if (!cancelled) setMeta(data);
      } catch (e: unknown) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Not found or expired.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <div className="flex min-h-screen flex-col bg-white text-zinc-950 dark:bg-[#0a0a0a] dark:text-zinc-50">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-6 pt-7">
        <a href="/" className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-zinc-950 text-white dark:bg-white dark:text-black">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden
            >
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
          <span className="font-grotesk text-[17px] font-bold tracking-tight">
            Docshare
          </span>
        </a>
        <a
          href="/"
          className="text-sm text-zinc-400 transition-colors duration-150 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← New share
        </a>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-20 text-center">
        {loading ? (
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-400">
              Retrieving share
            </p>
            <p className="mt-4 font-mono text-3xl tracking-[0.35em]">{code}</p>
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
              Checking availability…
            </p>
          </div>
        ) : err || !meta ? (
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-400">
              Unavailable
            </p>
            <p className="mt-4 font-mono text-3xl tracking-[0.35em]">{code}</p>
            <p className="mx-auto mt-3 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
              This share was not found or has expired.
            </p>
            <p className="mx-auto mt-1 max-w-xs font-mono text-[11px] text-zinc-400">
              {err}
            </p>
            <a
              href="/"
              className="mt-8 inline-block rounded-md bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition-opacity duration-150 hover:opacity-80 dark:bg-white dark:text-black"
            >
              Send a file instead
            </a>
          </div>
        ) : (
          <div className="rise">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-400">
              Incoming share
            </p>
            <h1 className="mt-4 font-mono text-4xl font-medium tracking-[0.3em]">
              {meta.code}
            </h1>
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
              {meta.files.length} file{meta.files.length > 1 ? "s" : ""} ·{" "}
              {formatBytes(meta.files.reduce((n, f) => n + f.size, 0))} ·
              expires {new Date(meta.expiresAt).toLocaleTimeString()}
            </p>

            <a
              href={`${API}/share/${code}/download`}
              className="mt-8 block w-full rounded-md bg-zinc-950 py-3 text-sm font-medium text-white transition-opacity duration-150 hover:opacity-80 dark:bg-white dark:text-black"
            >
              Download{meta.files.length > 1 ? " all as ZIP" : ""}
            </a>

            <ul className="mt-6 divide-y divide-zinc-100 border-y border-zinc-100 text-left dark:divide-zinc-900 dark:border-zinc-900">
              {meta.files.map((f, i) => (
                <li
                  key={f.storedName}
                  className="flex items-center justify-between gap-3 py-3"
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
                    href={`${API}/share/${code}/download/${i}`}
                    className="shrink-0 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium transition-colors duration-150 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
                  >
                    Save
                  </a>
                </li>
              ))}
            </ul>

            <p className="mt-8 font-mono text-[11px] text-zinc-400">
              Files auto-delete when the share expires.
            </p>
          </div>
        )}
      </main>

      <footer className="border-t border-zinc-100 dark:border-zinc-900">
        <div className="mx-auto w-full max-w-2xl px-6 py-5 text-center">
          <p className="font-mono text-[11px] text-zinc-400">
            Docshare · Private · 30 min expiry
          </p>
        </div>
      </footer>
    </div>
  );
}

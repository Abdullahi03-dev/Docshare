"use client";

import { use, useEffect, useState } from "react";

function getApiBase() {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env) return env;
  if (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
    return `http://${window.location.hostname}:3001/api`;
  }
  return "http://localhost:3001/api";
}

type ShareMeta = {
  code: string;
  files: { originalName: string; storedName: string; size: number; mimetype: string }[];
  expiresAt: string;
};

function formatBytes(b: number) {
  if (b === 0) return "0 B";
  const k = 1024, s = ["B","KB","MB","GB"];
  const i = Math.floor(Math.log(b)/Math.log(k));
  return parseFloat((b/Math.pow(k,i)).toFixed(2))+" "+s[i];
}

export default function RPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const API = getApiBase();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/share/${code}`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (!cancelled) setMeta(data);
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Not found or expired");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [code, API]);

  if (loading) return <div className="min-h-screen grid place-items-center p-6">Loading share {code}…</div>;
  if (err) return <div className="min-h-screen grid place-items-center p-6 text-center"><div><p className="font-medium">Share {code} not found</p><p className="text-sm text-zinc-500 mt-1">{err}</p><a href="/" className="inline-block mt-4 rounded-full bg-black text-white px-5 py-2 text-sm">Go home</a></div></div>;
  if (!meta) return null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6">
      <div className="mx-auto max-w-md rounded-2xl border bg-white dark:bg-zinc-900 dark:border-zinc-800 overflow-hidden">
        <div className="px-6 py-5">
          <h1 className="text-xl font-semibold">Share {meta.code}</h1>
          <p className="text-sm text-zinc-500">{meta.files.length} file(s) • expires {new Date(meta.expiresAt).toLocaleString()}</p>
          <a href={`${API}/share/${code}/download`} className="mt-4 inline-flex w-full justify-center rounded-full bg-black dark:bg-white text-white dark:text-black py-3 font-medium">Download {meta.files.length > 1 ? "ZIP" : meta.files[0].originalName}</a>
        </div>
        <ul className="divide-y dark:divide-zinc-800 border-t dark:border-zinc-800">
          {meta.files.map((f,i)=>(
            <li key={f.storedName} className="px-6 py-3 flex justify-between items-center gap-3">
              <div className="min-w-0"><p className="truncate text-sm font-medium" title={f.originalName}>{f.originalName}</p><p className="text-xs text-zinc-500">{formatBytes(f.size)}</p></div>
              <a href={`${API}/share/${code}/download/${i}`} className="shrink-0 rounded-full border dark:border-zinc-700 px-3 py-1.5 text-xs">Download</a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

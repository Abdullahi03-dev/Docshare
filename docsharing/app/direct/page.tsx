"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

/* ---------------------------------- utils --------------------------------- */

function getApiBase() {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1")
      return "http://localhost:3001/api";
    if (window.location.protocol === "http:") return `http://${h}:3001/api`;
  }
  return "http://localhost:3001/api";
}

/** Signaling origin: same host as the API, without the /api prefix. */
function getSocketOrigin() {
  return getApiBase().replace(/\/api$/, "") || getApiBase();
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

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const CHUNK = 16 * 1024;
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

type JoinAck = { ok: boolean; error?: string; peerWaiting?: boolean };
type SignalMsg =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

type RecvFile = {
  name: string;
  size: number;
  type: string;
  received: number;
  url: string | null;
};

type SendPhase = "idle" | "joining" | "waiting" | "sending" | "done" | "error";
type RecvPhase =
  | "idle"
  | "joining"
  | "waiting"
  | "receiving"
  | "done"
  | "error";

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

/* ---------------------------------- page ---------------------------------- */

export default function DirectPage() {
  const [tab, setTab] = useState<"send" | "receive">("send");
  const [isDark, setIsDark] = useState(false);

  /* sender state */
  const [sendFiles, setSendFiles] = useState<File[]>([]);
  const [sendPhase, setSendPhase] = useState<SendPhase>("idle");
  const [sendCode, setSendCode] = useState("");
  const [sendProgress, setSendProgress] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);
  const [connState, setConnState] = useState<string>("");

  /* receiver state */
  const [codeInput, setCodeInput] = useState("");
  const [recvPhase, setRecvPhase] = useState<RecvPhase>("idle");
  const [recvFiles, setRecvFiles] = useState<RecvFile[]>([]);
  const [recvProgress, setRecvProgress] = useState(0);
  const [recvError, setRecvError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const cancelRef = useRef(false);
  const offerStartedRef = useRef(false);
  const recvRef = useRef<{ files: RecvFile[]; parts: BlobPart[][]; cur: number }>({
    files: [],
    parts: [],
    cur: 0,
  });
  const lastTickRef = useRef(0);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    return () => {
      // full cleanup on unmount
      cancelRef.current = true;
      try {
        dcRef.current?.close();
      } catch {}
      try {
        pcRef.current?.close();
      } catch {}
      try {
        socketRef.current?.disconnect();
      } catch {}
      for (const f of recvRef.current.files) {
        if (f.url) URL.revokeObjectURL(f.url);
      }
    };
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

  const teardown = useCallback(() => {
    cancelRef.current = true;
    try {
      dcRef.current?.close();
    } catch {}
    try {
      pcRef.current?.close();
    } catch {}
    try {
      socketRef.current?.disconnect();
    } catch {}
    socketRef.current = null;
    pcRef.current = null;
    dcRef.current = null;
    offerStartedRef.current = false;
  }, []);

  const resetSend = useCallback(() => {
    teardown();
    cancelRef.current = false;
    setSendFiles([]);
    setSendPhase("idle");
    setSendCode("");
    setSendProgress(0);
    setSendError(null);
    setConnState("");
  }, [teardown]);

  const resetRecv = useCallback(() => {
    teardown();
    cancelRef.current = false;
    for (const f of recvRef.current.files) {
      if (f.url) URL.revokeObjectURL(f.url);
    }
    recvRef.current = { files: [], parts: [], cur: 0 };
    setRecvFiles([]);
    setRecvPhase("idle");
    setRecvProgress(0);
    setRecvError(null);
    setCodeInput("");
  }, [teardown]);

  const emitAck = useCallback(
    (socket: Socket, ev: string, payload: unknown): Promise<JoinAck> =>
      new Promise((resolve) => {
        const t = setTimeout(() => resolve({ ok: false, error: "Timeout" }), 10000);
        socket.emit(ev, payload, (res: JoinAck) => {
          clearTimeout(t);
          resolve(res ?? { ok: false });
        });
      }),
    []
  );

  const throttledProgress = useCallback(
    (setter: (n: number) => void, pct: number) => {
      const now = Date.now();
      if (now - lastTickRef.current > 100 || pct >= 100) {
        lastTickRef.current = now;
        setter(pct);
      }
    },
    []
  );

  /* ------------------------------- sender --------------------------------- */

  const streamFiles = useCallback(
    async (dc: RTCDataChannel, files: File[]) => {
      const total = files.reduce((n, f) => n + f.size, 0) || 1;
      let sent = 0;
      dc.send(
        JSON.stringify({
          t: "meta",
          files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
        })
      );
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        dc.send(JSON.stringify({ t: "file-start", i }));
        let offset = 0;
        while (offset < f.size) {
          if (cancelRef.current) throw new Error("cancelled");
          while (dc.bufferedAmount > 4 * 1024 * 1024) {
            await new Promise<void>((res) => {
              const h = () => {
                dc.removeEventListener("bufferedamountlow", h);
                res();
              };
              dc.addEventListener("bufferedamountlow", h);
              setTimeout(() => {
                dc.removeEventListener("bufferedamountlow", h);
                res();
              }, 250);
            });
            if (cancelRef.current) throw new Error("cancelled");
          }
          const chunk = await f.slice(offset, offset + CHUNK).arrayBuffer();
          dc.send(chunk);
          offset += chunk.byteLength;
          sent += chunk.byteLength;
          throttledProgress(setSendProgress, Math.round((sent / total) * 100));
        }
        dc.send(JSON.stringify({ t: "file-end", i }));
      }
      dc.send(JSON.stringify({ t: "done" }));
      setSendProgress(100);
    },
    [throttledProgress]
  );

  const startOffer = useCallback(
    async (socket: Socket, pc: RTCPeerConnection, code: string, files: File[]) => {
      if (offerStartedRef.current) return;
      offerStartedRef.current = true;
      try {
        const dc = pc.createDataChannel("files", { ordered: true });
        dc.binaryType = "arraybuffer";
        dc.bufferedAmountLowThreshold = 256 * 1024;
        dcRef.current = dc;
        dc.onopen = () => {
          setSendPhase("sending");
          streamFiles(dc, files).then(
            () => setSendPhase("done"),
            (e: unknown) => {
              if (!cancelRef.current) {
                setSendError(e instanceof Error ? e.message : "Send failed.");
                setSendPhase("error");
              }
            }
          );
        };
        dc.onerror = () => {
          if (!cancelRef.current) {
            setSendError("Data channel error. Try Online relay instead.");
            setSendPhase("error");
          }
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("signal", {
          code,
          data: { kind: "offer", sdp: offer } satisfies SignalMsg,
        });
      } catch {
        setSendError("Could not start the connection.");
        setSendPhase("error");
      }
    },
    [streamFiles]
  );

  const startSend = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      cancelRef.current = false;
      offerStartedRef.current = false;
      setSendError(null);
      setSendProgress(0);
      setSendPhase("joining");

      const socket: Socket = io(getSocketOrigin(), {
        transports: ["websocket", "polling"],
      });
      socketRef.current = socket;

      // unique 4-digit code, retry if taken
      let code = "";
      let joined = false;
      let peerWaiting = false;
      for (let attempt = 0; attempt < 12 && !joined; attempt++) {
        code = String(Math.floor(1000 + Math.random() * 9000));
        const ack = await emitAck(socket, "join", { code, role: "sender" });
        if (ack.ok) {
          joined = true;
          peerWaiting = !!ack.peerWaiting;
        } else if (ack.error !== "Code taken, try another") {
          setSendError(ack.error ?? "Could not reach the server.");
          setSendPhase("error");
          socket.disconnect();
          return;
        }
      }
      if (!joined) {
        setSendError("Could not get a code. Try again.");
        setSendPhase("error");
        socket.disconnect();
        return;
      }
      setSendCode(code);

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit("signal", {
            code,
            data: { kind: "ice", candidate: e.candidate.toJSON() } satisfies SignalMsg,
          });
        }
      };
      pc.onconnectionstatechange = () => {
        setConnState(pc.connectionState);
        if (pc.connectionState === "failed" && !cancelRef.current) {
          setSendError(
            "Direct connection failed (strict NAT or firewall). Your files never left this device — try Online relay instead."
          );
          setSendPhase("error");
        }
      };
      socket.on("signal", async ({ data }: { data: SignalMsg }) => {
        try {
          if (data.kind === "answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          } else if (data.kind === "ice") {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        } catch {}
      });
      socket.on("peer-joined", ({ role }: { role: string }) => {
        if (role === "receiver") void startOffer(socket, pc, code, files);
      });
      socket.on("peer-left", () => {
        if (!cancelRef.current) {
          setSendPhase((p) => (p === "done" ? p : "waiting"));
        }
      });
      socket.on("disconnect", () => {
        if (!cancelRef.current) {
          setSendPhase((p) =>
            p === "waiting" || p === "joining" ? "error" : p
          );
          setSendError((e) => e ?? "Lost connection to the server.");
        }
      });

      setSendPhase("waiting");
      if (peerWaiting) void startOffer(socket, pc, code, files);
    },
    [emitAck, startOffer]
  );

  /* ------------------------------ receiver -------------------------------- */

  const startReceive = useCallback(
    async (code: string) => {
      const c = code.trim();
      if (!/^\d{4}$/.test(c)) {
        setRecvError("Enter the 4-digit code.");
        return;
      }
      cancelRef.current = false;
      setRecvError(null);
      setRecvFiles([]);
      setRecvProgress(0);
      recvRef.current = { files: [], parts: [], cur: 0 };
      setRecvPhase("joining");

      const socket: Socket = io(getSocketOrigin(), {
        transports: ["websocket", "polling"],
      });
      socketRef.current = socket;

      const ack = await emitAck(socket, "join", { code: c, role: "receiver" });
      if (!ack.ok) {
        setRecvError(ack.error ?? "Could not reach the server.");
        setRecvPhase("error");
        socket.disconnect();
        return;
      }
      setRecvPhase("waiting");

      let pc: RTCPeerConnection | null = null;

      const onDataMessage = (ev: MessageEvent) => {
        const st = recvRef.current;
        if (typeof ev.data === "string") {
          try {
            const msg = JSON.parse(ev.data) as
              | { t: "meta"; files: { name: string; size: number; type: string }[] }
              | { t: "file-start"; i: number }
              | { t: "file-end"; i: number }
              | { t: "done" };
            if (msg.t === "meta") {
              st.files = msg.files.map((f) => ({ ...f, received: 0, url: null }));
              st.parts = msg.files.map(() => []);
              setRecvFiles(st.files.map((f) => ({ ...f })));
              setRecvPhase("receiving");
            } else if (msg.t === "file-start") {
              st.cur = msg.i;
            } else if (msg.t === "file-end") {
              const f = st.files[msg.i];
              if (f) {
                const blob = new Blob(st.parts[msg.i], {
                  type: f.type || "application/octet-stream",
                });
                f.url = URL.createObjectURL(blob);
                setRecvFiles(st.files.map((x) => ({ ...x })));
              }
            } else if (msg.t === "done") {
              setRecvProgress(100);
              setRecvPhase("done");
            }
          } catch {}
          return;
        }
        // binary chunk (list updates throttled — chunks arrive very fast on LAN)
        const f = st.files[st.cur];
        if (!f) return;
        st.parts[st.cur].push(ev.data as BlobPart);
        f.received += (ev.data as ArrayBuffer).byteLength;
        const now = Date.now();
        if (now - lastTickRef.current > 100) {
          lastTickRef.current = now;
          const total = st.files.reduce((n, x) => n + x.size, 0) || 1;
          const got = st.files.reduce((n, x) => n + x.received, 0);
          setRecvProgress(Math.round((got / total) * 100));
          setRecvFiles(st.files.map((x) => ({ ...x })));
        }
      };

      socket.on("signal", async ({ data }: { data: SignalMsg }) => {
        try {
          if (data.kind === "offer") {
            if (pc) {
              try {
                pc.close();
              } catch {}
            }
            pc = new RTCPeerConnection(ICE_SERVERS);
            pcRef.current = pc;
            pc.onicecandidate = (e) => {
              if (e.candidate) {
                socket.emit("signal", {
                  code: c,
                  data: { kind: "ice", candidate: e.candidate.toJSON() } satisfies SignalMsg,
                });
              }
            };
            pc.ondatachannel = (e) => {
              const dc = e.channel;
              dc.binaryType = "arraybuffer";
              dcRef.current = dc;
              dc.onmessage = onDataMessage;
            };
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit("signal", {
              code: c,
              data: { kind: "answer", sdp: answer } satisfies SignalMsg,
            });
          } else if (data.kind === "ice" && pc) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        } catch {
          setRecvError("Could not establish the connection.");
          setRecvPhase("error");
        }
      });
      socket.on("peer-left", () => {
        if (!cancelRef.current) {
          setRecvPhase((p) =>
            p === "done" ? p : recvRef.current.files.length > 0 ? p : "error"
          );
          setRecvError((e) =>
            e ?? recvRef.current.files.length > 0
              ? e
              : "Sender left before connecting."
          );
        }
      });
      socket.on("disconnect", () => {
        if (!cancelRef.current && recvRef.current.files.length === 0) {
          setRecvPhase((p) => (p === "done" ? p : "error"));
          setRecvError((e) => e ?? "Lost connection to the server.");
        }
      });
    },
    [emitAck, throttledProgress]
  );

  const sendTotal = sendFiles.reduce((n, f) => n + f.size, 0);

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-white text-zinc-950 dark:bg-[#0a0a0a] dark:text-zinc-50">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle,#d9d9de_1px,transparent_1.2px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black_0%,transparent_62%)] dark:[background-image:radial-gradient(circle,#232326_1px,transparent_1.2px)]"
      />

      <header className="relative mx-auto flex w-full max-w-3xl items-center justify-between px-6 pt-6">
        <a href="/" className="flex items-center gap-2.5">
          <Mark />
          <span className="font-grotesk text-[17px] font-bold tracking-tight">
            Docshare
          </span>
        </a>
        <nav className="flex items-center gap-5">
          <a
            href="/"
            className="hidden font-mono text-[12px] text-zinc-400 transition-colors duration-150 hover:text-zinc-900 sm:inline dark:hover:text-zinc-100"
          >
            Relay
          </a>
          <a
            href="/direct"
            className="hidden font-mono text-[12px] text-zinc-900 sm:inline dark:text-zinc-100"
          >
            Direct
          </a>
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="grid h-8 w-8 place-items-center rounded-lg border border-zinc-200 bg-white/70 text-zinc-500 backdrop-blur transition-colors duration-150 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
          >
            {isDark ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.3" />
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

      <main className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pb-24 pt-14 sm:pt-[72px]">
        <div className="text-center">
          <div className="flex items-center justify-center gap-3">
            <span className="h-px w-8 bg-zinc-300 dark:bg-zinc-700" />
            <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-zinc-400">
              Peer-to-peer
            </p>
            <span className="h-px w-8 bg-zinc-300 dark:bg-zinc-700" />
          </div>
          <h1 className="mx-auto mt-5 font-grotesk text-[52px] font-bold leading-[0.98] tracking-[-0.045em] sm:text-[76px]">
            Send{" "}
            <span className="font-instrument font-normal italic tracking-[-0.02em]">
              direct.
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Both sides open this page. Files stream device-to-device — the
            server only introduces you, then gets out of the way.
          </p>

          <div className="mt-8 inline-flex items-center rounded-full border border-zinc-200 bg-white/70 p-1 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/70">
            <button
              onClick={() => setTab("send")}
              className={`rounded-full px-5 py-1.5 text-[13px] font-medium transition-all duration-150 ${
                tab === "send"
                  ? "bg-zinc-950 text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] dark:bg-white dark:text-black dark:shadow-none"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              Send
            </button>
            <button
              onClick={() => setTab("receive")}
              className={`rounded-full px-5 py-1.5 text-[13px] font-medium transition-all duration-150 ${
                tab === "receive"
                  ? "bg-zinc-950 text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] dark:bg-white dark:text-black dark:shadow-none"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              Receive
            </button>
          </div>
        </div>

        <div className="mt-10">
          {tab === "send" ? (
            sendPhase === "idle" ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.length) {
                    const arr = Array.from(e.dataTransfer.files);
                    setSendFiles(arr);
                    void startSend(arr);
                  }
                }}
                className="cursor-pointer rounded-2xl border border-dashed border-zinc-300 bg-white/70 px-6 py-16 text-center backdrop-blur transition-all duration-150 hover:border-zinc-950 sm:py-20 dark:border-zinc-700 dark:bg-zinc-950/70 dark:hover:border-zinc-100"
              >
                <p className="font-grotesk text-[19px] font-bold tracking-[-0.02em]">
                  Drop files to send direct
                </p>
                <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                  or{" "}
                  <span className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100">
                    browse from your computer
                  </span>
                </p>
                <div className="mt-6 flex items-center justify-center gap-2">
                  {["P2P encrypted", "No size cap", "LAN-fast"].map((chip) => (
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
                    if (e.target.files?.length) {
                      const arr = Array.from(e.target.files);
                      setSendFiles(arr);
                      void startSend(arr);
                    }
                    e.target.value = "";
                  }}
                />
              </div>
            ) : sendPhase === "error" ? (
              <div className="rise rounded-xl border border-zinc-200 bg-white/80 p-8 text-center backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
                <p className="font-grotesk text-lg font-bold tracking-tight">
                  Couldn't send direct
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                  {sendError}
                </p>
                <div className="mt-6 flex items-center justify-center gap-2">
                  <button
                    onClick={resetSend}
                    className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:opacity-80 active:scale-[0.98] dark:bg-white dark:text-black"
                  >
                    Try again
                  </button>
                  <a
                    href="/"
                    className="rounded-lg border border-zinc-200 px-5 py-2.5 text-sm font-medium transition-colors duration-150 hover:border-zinc-950 dark:border-zinc-800 dark:hover:border-zinc-100"
                  >
                    Use Online relay
                  </a>
                </div>
              </div>
            ) : (
              <div className="rise rounded-xl border border-zinc-200 bg-white/80 p-8 text-center backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
                {sendPhase === "done" ? (
                  <>
                    <p className="font-grotesk text-[26px] font-bold tracking-[-0.02em]">
                      Delivered
                    </p>
                    <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                      {sendFiles.length} file{sendFiles.length > 1 ? "s" : ""} ·{" "}
                      {formatBytes(sendTotal)} · straight to their device
                    </p>
                    <button
                      onClick={resetSend}
                      className="mt-6 rounded-lg bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:opacity-80 active:scale-[0.98] dark:bg-white dark:text-black"
                    >
                      Send more
                    </button>
                  </>
                ) : (
                  <>
                    <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                      {sendPhase === "joining"
                        ? "Reserving code"
                        : sendPhase === "waiting"
                          ? "Waiting for receiver"
                          : "Sending"}
                    </p>
                    {sendCode && (
                      <p className="mt-4 font-mono text-[34px] font-medium tracking-[0.3em]">
                        {sendCode}
                      </p>
                    )}
                    <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
                      {sendPhase === "waiting"
                        ? "They enter this code under Receive — on this page, any device."
                        : sendPhase === "sending"
                          ? `${formatBytes(
                              Math.round((sendTotal * sendProgress) / 100)
                            )} of ${formatBytes(sendTotal)} · ${sendProgress}%`
                          : "Getting ready…"}
                      {connState === "connected" && sendPhase === "waiting"
                        ? " · connected"
                        : ""}
                    </p>
                    {(sendPhase === "sending" || sendPhase === "waiting") && (
                      <div className="mx-auto mt-6 h-[3px] max-w-md overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                        <div
                          className="h-full rounded-full bg-zinc-950 transition-[width] duration-150 dark:bg-white"
                          style={{ width: `${sendProgress}%` }}
                        />
                      </div>
                    )}
                    <ul className="mx-auto mt-6 max-w-md divide-y divide-zinc-100 border-y border-zinc-100 text-left dark:divide-zinc-900 dark:border-zinc-900">
                      {sendFiles.map((f) => (
                        <li
                          key={f.name + f.size}
                          className="flex items-center justify-between gap-3 py-2.5"
                        >
                          <span
                            className="truncate text-sm text-zinc-700 dark:text-zinc-300"
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
                    <button
                      onClick={resetSend}
                      className="mt-6 rounded-lg px-4 py-2 text-sm text-zinc-400 transition-colors duration-150 hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            )
          ) : recvPhase === "idle" ? (
            <div className="mx-auto w-full max-w-md text-center">
              <h3 className="font-grotesk text-[22px] font-bold tracking-[-0.02em]">
                Enter their code
              </h3>
              <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                The 4 digits from the sender's screen.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void startReceive(codeInput);
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
                  aria-label="Direct share code"
                  className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white/70 px-4 py-3 text-center font-mono text-xl tracking-[0.45em] backdrop-blur placeholder:text-zinc-300 focus:border-zinc-950 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950/70 dark:placeholder:text-zinc-700 dark:focus:border-zinc-100"
                />
                <button
                  type="submit"
                  aria-label="Connect"
                  className="grid w-[52px] shrink-0 place-items-center rounded-xl bg-zinc-950 text-white transition-all duration-150 hover:opacity-80 active:scale-[0.97] dark:bg-white dark:text-black"
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
            </div>
          ) : recvPhase === "error" ? (
            <div className="rise mx-auto w-full max-w-md rounded-xl border border-zinc-200 bg-white/80 p-8 text-center backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
              <p className="font-grotesk text-lg font-bold tracking-tight">
                Couldn't connect
              </p>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                {recvError}
              </p>
              <div className="mt-6 flex items-center justify-center gap-2">
                <button
                  onClick={resetRecv}
                  className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:opacity-80 active:scale-[0.98] dark:bg-white dark:text-black"
                >
                  Try again
                </button>
                <a
                  href="/#receive"
                  className="rounded-lg border border-zinc-200 px-5 py-2.5 text-sm font-medium transition-colors duration-150 hover:border-zinc-950 dark:border-zinc-800 dark:hover:border-zinc-100"
                >
                  Use Online relay
                </a>
              </div>
            </div>
          ) : (
            <div className="rise mx-auto w-full max-w-md rounded-xl border border-zinc-200 bg-white/80 p-8 text-center backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                {recvPhase === "done"
                  ? "Received"
                  : recvPhase === "receiving"
                    ? `Receiving · ${recvProgress}%`
                    : recvPhase === "joining"
                      ? "Joining"
                      : "Waiting for sender"}
              </p>
              {(recvPhase === "receiving" || recvPhase === "waiting" || recvPhase === "joining") && (
                <div className="mx-auto mt-6 h-[3px] max-w-xs overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                  <div
                    className="h-full rounded-full bg-zinc-950 transition-[width] duration-150 dark:bg-white"
                    style={{ width: `${recvProgress}%` }}
                  />
                </div>
              )}
              {recvFiles.length > 0 && (
                <ul className="mt-6 divide-y divide-zinc-100 border-y border-zinc-100 text-left dark:divide-zinc-900 dark:border-zinc-900">
                  {recvFiles.map((f) => (
                    <li
                      key={f.name + f.size}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm" title={f.name}>
                          {f.name}
                        </p>
                        <p className="font-mono text-[11px] text-zinc-400">
                          {extOf(f.name)} · {formatBytes(f.received)} of{" "}
                          {formatBytes(f.size)}
                        </p>
                      </div>
                      {f.url ? (
                        <a
                          href={f.url}
                          download={f.name}
                          className="shrink-0 rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white transition-all duration-150 hover:opacity-80 dark:bg-white dark:text-black"
                        >
                          Save
                        </a>
                      ) : (
                        <span className="shrink-0 font-mono text-[11px] text-zinc-400">
                          …
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-6 flex items-center justify-center gap-2">
                {recvPhase === "done" ? (
                  <button
                    onClick={resetRecv}
                    className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:opacity-80 active:scale-[0.98] dark:bg-white dark:text-black"
                  >
                    Receive more
                  </button>
                ) : (
                  <button
                    onClick={resetRecv}
                    className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition-colors duration-150 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <p className="mx-auto mt-12 max-w-md text-center font-mono text-[11px] leading-relaxed text-zinc-400">
          Same Wi-Fi is fastest — devices find each other directly. Across the
          internet it still works peer-to-peer in most cases. Stuck behind a
          strict firewall? The <a href="/" className="underline underline-offset-4">Online relay</a> always works.
        </p>
      </main>

      <footer className="relative border-t border-zinc-100 dark:border-zinc-900">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-5">
          <p className="font-mono text-[11px] text-zinc-400">
            Docshare Direct · E2E encrypted
          </p>
          <p className="font-mono text-[11px] text-zinc-400">
            server never sees bytes
          </p>
        </div>
      </footer>
    </div>
  );
}

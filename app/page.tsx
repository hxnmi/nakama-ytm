"use client"

import { useEffect, useRef, useState } from "react"

type Streamer = {
  name: string
  channelId: string
  liveVideoId?: string
  isLive: boolean
  enabled: boolean
}

declare global {
  interface Window {
    YT: any
    onYouTubeIframeAPIReady: () => void
  }
}

export default function Page() {
  const players = useRef<any[]>([])
  const [streams, setStreams] = useState<Streamer[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const liveStreams = streams.filter(
    s => s.isLive && !!s.liveVideoId
  )

  const visibleStreams = liveStreams
    .filter(s => s.enabled)
    .slice(0, 12)


  /* ================= SYNC ORDER ================= */
  useEffect(() => {
    const liveIds = visibleStreams.map(s => s.channelId)

    setOrder(prev => {
      if (
        prev.length === liveIds.length &&
        prev.every((id, i) => id === liveIds[i])
      ) {
        return prev
      }

      const kept = prev.filter(id => liveIds.includes(id))
      const added = liveIds.filter(id => !kept.includes(id))

      return [...kept, ...added]
    })
  }, [visibleStreams.map(s => s.channelId).join(",")])


  /* ================= LOAD CACHE ================= */
  useEffect(() => {
    const saved = localStorage.getItem("layoutState")
    if (!saved) return

    try {
      const parsed = JSON.parse(saved)
      setStreams(parsed.streams ?? [])
      setOrder(parsed.order ?? [])
      setFocusedId(parsed.focusedId ?? null)
    } catch { }
  }, [])

  /* ================= FETCH LIVE STATUS ================= */
  useEffect(() => {
    async function load() {
      const res = await fetch("/api/live-status")
      const data: Streamer[] = await res.json()

      setStreams(prev =>
        data.map(r => {
          const existing = prev.find(
            p => p.channelId === r.channelId
          )

          const isReallyLive = r.isLive && !!r.liveVideoId

          return {
            ...r,
            isLive: isReallyLive,
            liveVideoId: isReallyLive ? r.liveVideoId : undefined,

            enabled: isReallyLive
              ? existing?.enabled ?? true
              : false,
          }
        })
      )
    }

    load()
    const timer = setInterval(load, 60000)
    return () => clearInterval(timer)
  }, [])

  /* ================= YOUTUBE PLAYERS ================= */
  const streamKeys = visibleStreams.map(s => s.channelId).join(",");
  useEffect(() => {
    if (!visibleStreams.length) return;

    players.current.forEach(p => {
      try { p?.destroy?.(); } catch (e) { console.error("YT Destroy Error:", e); }
    });
    players.current = [];

    const init = () => {
      visibleStreams.forEach((s, i) => {
        const elementId = `player-${s.channelId}`;
        if (document.getElementById(elementId)) {
          players.current[i] = new window.YT.Player(elementId, {
            videoId: s.liveVideoId,
            playerVars: {
              autoplay: 1,
              playsinline: 1,
              mute: focusedId ? (s.channelId !== focusedId) : false
            },
          });
        }
      });
    };

    if (window.YT && window.YT.Player) {
      const t = setTimeout(init, 50);
      return () => clearTimeout(t);
    } else {
      window.onYouTubeIframeAPIReady = () => setTimeout(init, 50);
    }

    return () => {
      players.current.forEach(p => p?.destroy?.());
      players.current = [];
    };
  }, [streamKeys, focusedId]);

  /* ================= SAVE STATE ================= */
  useEffect(() => {
    localStorage.setItem(
      "layoutState",
      JSON.stringify({
        streams,
        order,
        focusedId,
      })
    )
  }, [streams, order, focusedId])

  /* ================= SOLO AUDIO ================= */
  useEffect(() => {
    if (!window.YT || !focusedId) return Object.entries(players.current).forEach(([id, player]) => {
      if (!player?.mute) return
      if (id === focusedId) player.unMute()
      else player.mute()
    })
  }, [focusedId])

  /* ================= RENDER ================= */
  return (
    <div className="app">
      <header className="header">
        <div
          className="header-left"
          onClick={(e) => e.preventDefault()}
        >
          <img
            src="/FULL-LOGO-NMC.png"
            alt="Nakama"
            className="logo"
            draggable={false}
          />
          <h1>Nakama Youtube MultiView</h1>
        </div>

        <span className="live-count">
          LIVE: {liveStreams.length} / {streams.length}
        </span>
      </header>
      <div className={`content ${focusedId ? "focus" : ""}`}>
        <main className={`grid ${focusedId ? "focus" : `grid-${visibleStreams.length}`}`}>
          { /* MAIN AREA */}
          {visibleStreams
            .filter(s => !focusedId || s.channelId === focusedId)
            .map(s => (
              <div
                key={s.channelId}
                className={`card ${focusedId === s.channelId ? "focused" : ""}`}
                onClick={() => setFocusedId(prev => (prev === s.channelId ? null : s.channelId))}
              >
                <div className="player">
                  <div id={`player-${s.channelId}`} />
                </div>
                <span className="label">{s.name}</span>
              </div>
            ))}
        </main>
        {/* BOTTOM STRIP */}
        {focusedId && (
          <div className="bottom-strip">
            {visibleStreams
              .filter(s => s.channelId !== focusedId)
              .map(s => (
                <div
                  key={s.channelId}
                  className="card unfocused"
                  onClick={() => setFocusedId(s.channelId)}
                >
                  <div className="player">
                    <div id={`player-${s.channelId}`} />
                  </div>
                  <span className="label">{s.name}</span>
                </div>
              ))}
          </div>
        )}
        {/* CHAT PANEL */}
        {focusedId && (
          <aside className="chat-panel">
            <iframe
              src={`https://www.youtube.com/live_chat?v=${liveStreams.find(s => s.channelId === focusedId)?.liveVideoId
                }&embed_domain=${window.location.hostname}`}
              allow="autoplay"
            />
          </aside>
        )}
      </div>
      <footer className="offline-bar">
        {(["A4A", "NMC"] as const).map(group => {
          const members = GROUPS[group]

          const groupStreams = streams
            .filter(s => members.includes(s.name))
            .sort((a, b) => (a.isLive === b.isLive ? 0 : a.isLive ? -1 : 1))

          return (
            <div key={group} className="group-row">
              <span className="group-label">{group}</span>

              <div className="group-streams">
                {groupStreams.map(s => (
                  <span
                    key={s.channelId}
                    className={`toggle-pill ${s.isLive ? "live" : "offline"
                      } ${s.enabled ? "enabled" : "disabled"}`}
                    onClick={() => {
                      if (!s.isLive) return
                      setStreams(prev =>
                        prev.map(p =>
                          p.channelId === s.channelId
                            ? { ...p, enabled: !p.enabled }
                            : p
                        )
                      )
                    }}
                  >
                    <span className="dot" />
                    {s.name}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </footer>
    </div >
  )
}

const GROUPS = {
  A4A: ["yb", "Tepe46", "Tierison", "bang mister aloy", "ibot13", "youKtheo", "Garry Ang", "Bravyson Vconk", "Niko Junius", "GURAISU", "Michelle Christo", "Jessica Prashela", "Derisky Prisadevano", "Juan Herman"],
  NMC: ["Shroud", "Faris AA", "Papuy", "ELJAWZ", "MIRJAAA", "Danny", "Sipije", "a bee gel", "zota frz", "Anjasmara7", "Lezype", "Lise Zhang", "Dobori Tensha VT", "Gray Wellington", "Apinpalingserius", "Moonears", "Idinzzz", "PaddanG", "tasya", "Sam Wani", "LokiTheHuman"],
}
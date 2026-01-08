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
  const players = useRef<Record<string, any>>({})
  const [streams, setStreams] = useState<Streamer[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [showOffline, setShowOffline] = useState(false);
  const [ytReady, setYtReady] = useState(false)


  const liveStreams = streams.filter(
    s => s.isLive && !!s.liveVideoId
  )

  const visibleStreams = liveStreams
    .filter(s => s.enabled)
    .slice(0, 12)

  useEffect(() => {
    if (window.YT?.Player) {
      setYtReady(true)
      return
    }

    const tag = document.createElement("script")
    tag.src = "https://www.youtube.com/iframe_api"
    document.body.appendChild(tag)

    window.onYouTubeIframeAPIReady = () => {
      setYtReady(true)
    }
  }, [])


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
    if (!ytReady) return

    visibleStreams.forEach(s => {
      const id = s.channelId
      const el = document.getElementById(`player-${id}`)

      if (!el) return

      if (!players.current[id]) {
        players.current[id] = new window.YT.Player(el, {
          videoId: s.liveVideoId,
          playerVars: {
            autoplay: 1,
            playsinline: 1,
          },
        })
      }
    })

    Object.keys(players.current).forEach(id => {
      if (!visibleStreams.find(s => s.channelId === id)) {
        players.current[id].destroy()
        delete players.current[id]
      }
    })
  }, [ytReady, streamKeys])



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
    if (!focusedId) return

    Object.entries(players.current).forEach(([id, player]) => {
      if (!player?.mute) return
      id === focusedId ? player.unMute() : player.mute()
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <button
            onClick={() => setShowOffline(!showOffline)}
            className={`toggle-pill ${showOffline ? 'enabled' : 'disabled'}`}
            style={{ background: showOffline ? '#e11d48' : '#262633', border: 'none', color: '#fff', cursor: 'pointer' }}
          >
            {showOffline ? "Hide Offline" : "Show Offline"}
          </button>
          <span className="live-count">
            LIVE: {liveStreams.length} / {streams.length}
          </span>
        </div>
      </header>
      <div className={`content ${focusedId ? "focus" : ""}`}>
        {/* MAIN AREA */}
        <main className={`grid ${focusedId ? "focus" : `grid-${visibleStreams.length}`}`}>
          {visibleStreams.map(s => {
            const isFocused = s.channelId === focusedId

            return (
              <div
                key={s.channelId}
                className={`card ${isFocused ? "focused" : "unfocused"}`}
                data-focused={isFocused}
                onClick={() =>
                  setFocusedId(prev => (prev === s.channelId ? null : s.channelId))
                }
              >
                <div className="player">
                  <div id={`player-${s.channelId}`} />
                </div>
                <span className="label">{s.name}</span>
              </div>
            )
          })}
        </main>

        {/* BOTTOM STRIP */}
        {/* {focusedId && (
          <div className="bottom-strip">
            {visibleStreams
              .filter(s => s.channelId !== focusedId)
              .map(s => (
                <div
                  key={`strip-${s.channelId}`} // Different key for the wrapper
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
        )} */}
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
            .filter(s => showOffline ? true : s.isLive)
            .sort((a, b) => (a.isLive === b.isLive ? 0 : a.isLive ? -1 : 1));

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
  NMC: ["Papuy", "ELJAWZ", "MIRJAAA", "Danny", "Sipije", "a bee gel", "zota frz", "Anjasmara7", "Lezype", "Lise Zhang", "Dobori Tensha VT", "Gray Wellington", "Apinpalingserius", "Moonears", "Idinzzz", "PaddanG", "tasya", "Sam Wani", "LokiTheHuman"],
}
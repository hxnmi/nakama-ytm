"use client"

import { useEffect, useRef, useState } from "react"

type Streamer = {
  name: string
  channelId: string
  liveVideoId?: string
  isLive: boolean
  enabled: boolean
  concurrentViewers?: number
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
  const [audioMode, setAudioMode] = useState<"mute" | "reduce">("mute")
  const [masterVolume, setMasterVolume] = useState(40)
  const [unfocusedVolume, setUnfocusedVolume] = useState(30) // %
  const groupStreamsRef = useRef<HTMLDivElement | null>(null)

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
  useEffect(() => {
    const el = groupStreamsRef.current
    if (!el) return

    const update = () => {
      const hasScrollbar = el.scrollWidth > el.clientWidth
      el.classList.toggle("has-scrollbar", hasScrollbar)
    }

    update()

    const ro = new ResizeObserver(update)
    ro.observe(el)

    return () => ro.disconnect()
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

  /* ================= AUDIO CONTROL ================= */
  useEffect(() => {
    const entries = Object.entries(players.current)

    // Helper
    const clamp = (v: number) => Math.max(0, Math.min(100, v))

    if (!focusedId) {
      entries.forEach(([_, player]) => {
        if (!player?.unMute || !player?.setVolume) return
        player.unMute()
        player.setVolume(clamp(masterVolume))
      })
      return
    }

    entries.forEach(([id, player]) => {
      if (!player?.mute || !player?.setVolume) return

      if (id === focusedId) {
        player.unMute()
        player.setVolume(clamp(masterVolume))
      } else {
        if (audioMode === "mute") {
          player.mute()
        } else {
          player.unMute()
          player.setVolume(
            clamp(Math.round(masterVolume * (unfocusedVolume / 100)))
          )
        }
      }
    })
  }, [focusedId, audioMode, unfocusedVolume, masterVolume])


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
          {focusedId && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select
                value={audioMode}
                onChange={(e) => setAudioMode(e.target.value as any)}
                style={{
                  background: "#262633",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "4px 8px",
                  cursor: "pointer",
                }}
              >
                <option value="mute">Mute others</option>
                <option value="reduce">Reduce others</option>
              </select>

              {audioMode === "reduce" && (
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={10}
                  value={unfocusedVolume}
                  onChange={(e) => setUnfocusedVolume(+e.target.value)}
                  title={`Others volume: ${unfocusedVolume}%`}
                />
              )}
            </div>
          )}
          {!focusedId && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>🔊</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={masterVolume}
                onChange={(e) => setMasterVolume(+e.target.value)}
                title={`Master volume: ${masterVolume}%`}
              />
            </div>)}
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
                {s.concurrentViewers && (
                  <span className="viewer-count">
                    👁 {s.concurrentViewers.toLocaleString()}
                  </span>
                )}
              </div>
            )
          })}
        </main>
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

              <div ref={groupStreamsRef} className="group-streams">
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
  A4A: ["yb", "Tepe46", "Tierison", "bang mister aloy", "ibot13", "youKtheo", "Garry Ang", "Bravyson Vconk", "Niko Junius", "GURAISU", "Michelle Christo", "Jessica Prashela", "Derisky Prisadevano", "Juan Herman", "JAPETLETSDOIT", "Dylan Lauw", "MODE siNclair"],
  NMC: ["Papuy", "ELJAWZ", "MIRJAAA", "Danny", "Sipije", "zota frz", "a bee gel", "Bopeng", "Anjasmara7", "Lezype", "Gabriel", "Alesya Nina", "Chavilangel", "Maeve Soo", "Lise Zhang", "Dobori Tensha VT", "Gray Wellington", "Apinpalingserius", "Idinzzz", "Kicked417", "Wayne D Veron", "Moonears", "Jaka Triad", "Jacky Jax RP", "nayrdika", "ihsannn", "PaddanG", "Sam Wani", "SEYA", "CYYA", "BudyTabootie", "Happy RP", "Dipiw", "Raihan Dwi", "tasya", , "LokiTheHuman", "irfan_4tm", "Boujee Girl", "NengEidel", "Intannn", "Wazowsky", "KafeeyInHere", "nenabobo", "hi.juenva", "Nanas Art", "Siberian Husky", "Ayus Bangga"],
}
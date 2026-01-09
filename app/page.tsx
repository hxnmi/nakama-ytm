"use client"

import { useEffect, useRef, useState, useMemo } from "react"

type StreamStatus = "live" | "waiting" | "scheduled" | "offline"

type Streamer = {
  name: string
  channelId: string
  status: StreamStatus
  liveVideoId?: string
  concurrentViewers?: number
  enabled: boolean
}
type Notify = {
  id: string
  message: string
  type: "live" | "info"
}

type AudioPrefs = {
  audioMode: "mute" | "reduce"
  masterVolume: number
  unfocusedVolume: number
}

declare global {
  interface Window {
    YT: any
    onYouTubeIframeAPIReady: () => void
  }
}

const STORAGE = {
  layout: "layoutState",
  audio: "audioPrefs",
  lastStatus: "lastStreamStatus",
}


export default function Page() {
  const players = useRef<Record<string, any>>({})
  const lastStatusRef = useRef<Record<string, StreamStatus>>({})
  const lastNotifyAtRef = useRef<Record<string, number>>({})
  const groupStreamsRef = useRef<HTMLDivElement | null>(null)
  const audioValues = useRef<{
    masterVolume: number;
    unfocusedVolume: number;
    audioMode: "mute" | "reduce";
  }>({
    masterVolume: 40,
    unfocusedVolume: 30,
    audioMode: "mute"
  })

  const [isClient, setIsClient] = useState(false)
  const [ytReady, setYtReady] = useState(false)
  const [host, setHost] = useState("")

  const [streams, setStreams] = useState<Streamer[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [showOffline, setShowOffline] = useState(false);

  const [audioMode, setAudioMode] = useState<"mute" | "reduce">("mute")
  const [masterVolume, setMasterVolume] = useState<number>(40)
  const [unfocusedVolume, setUnfocusedVolume] = useState<number>(30)

  const [chatLoading, setChatLoading] = useState(false)
  const [chatUnavailable, setChatUnavailable] = useState(false)
  const [notifications, setNotifications] = useState<Notify[]>([])

  const liveStreams = streams.filter(
    s => s.status === "live" && !!s.liveVideoId
  )

  /* ================= COMPUTED ================= */
  const visibleStreams = useMemo(() => {
    return streams
      .filter(s => ["live", "waiting", "scheduled"].includes(s.status) && !!s.liveVideoId && s.enabled)
      .sort((a, b) => order.indexOf(a.channelId) - order.indexOf(b.channelId))
  }, [streams, order])

  const streamKeys = visibleStreams.map(s => s.channelId).join(",")

  /* ================= INITIAL LOAD ================= */
  useEffect(() => {
    setIsClient(true)
    setHost(window.location.hostname)

    try {
      const savedAudio = localStorage.getItem(STORAGE.audio)
      if (savedAudio) {
        const p = JSON.parse(savedAudio)
        setAudioMode(p.audioMode); setMasterVolume(p.masterVolume); setUnfocusedVolume(p.unfocusedVolume)
      }
      const savedLayout = localStorage.getItem(STORAGE.layout)
      if (savedLayout) {
        const p = JSON.parse(savedLayout)
        if (p.streams) setStreams(p.streams); if (p.order) setOrder(p.order); if (p.focusedId) setFocusedId(p.focusedId)
      }
    } catch (e) { console.error("Cache load failed", e) }

    const savedStatus = localStorage.getItem(STORAGE.lastStatus)
    if (savedStatus) {
      try { lastStatusRef.current = JSON.parse(savedStatus) } catch (e) { }
    }

    if (window.YT?.Player) {
      setYtReady(true)
    } else {
      const tag = document.createElement("script")
      tag.src = "https://www.youtube.com/iframe_api"
      document.body.appendChild(tag)
      window.onYouTubeIframeAPIReady = () => setYtReady(true)
    }
  }, [])

  /* ================= PREFS ================= */
  useEffect(() => {
    audioValues.current = { masterVolume, unfocusedVolume, audioMode }
    if (isClient) localStorage.setItem(STORAGE.audio, JSON.stringify(audioValues.current))
  }, [masterVolume, unfocusedVolume, audioMode, isClient])

  useEffect(() => {
    if (!isClient || streams.length === 0) return
    localStorage.setItem(STORAGE.layout, JSON.stringify({ streams, order, focusedId }))
  },)

  /* ================= API SYNC ================= */
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/live-status")
        const data: Streamer[] = await res.json()

        setStreams(prev => {
          const map = new Map(prev.map(p => [p.channelId, p]))
          return data.map(r => {
            const existing = map.get(r.channelId)
            const prevS = lastStatusRef.current[r.channelId]

            if (isClient && prevS && prevS !== "live" && r.status === "live") {
              const now = Date.now()
              if (now - (lastNotifyAtRef.current[r.channelId] || 0) > 60000) {
                setNotifications(n => [...n, { id: now.toString(), type: "live", message: `🔴 ${r.name} is LIVE` }])
                lastNotifyAtRef.current[r.channelId] = now
              }
            }

            lastStatusRef.current[r.channelId] = r.status
            const playable = r.status !== "offline" && !!r.liveVideoId
            return { ...existing, ...r, liveVideoId: playable ? r.liveVideoId : undefined, enabled: existing?.enabled ?? playable }
          })
        })
        localStorage.setItem(STORAGE.lastStatus, JSON.stringify(lastStatusRef.current))
      } catch (e) { console.error(e) }
    }

    fetchStatus()
    const t = setInterval(fetchStatus, 60000)
    return () => clearInterval(t)
  }, [isClient])

  /* ================= PLAYERS MANAGER ================= */
  useEffect(() => {
    if (!ytReady) return

    visibleStreams.forEach(s => {
      const id = s.channelId
      const el = document.getElementById(`player-${id}`)
      if (!el || players.current[id]) return

      players.current[id] = new window.YT.Player(el, {
        videoId: s.liveVideoId,
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, enablejsapi: 1 },
        events: {
          onReady: (e: any) => {
            const isF = s.channelId === focusedId
            const vol = (!focusedId || isF) ? audioValues.current.masterVolume : (audioValues.current.audioMode === "mute" ? 0 : Math.round(audioValues.current.masterVolume * (audioValues.current.unfocusedVolume / 100)))
            e.target.setVolume(vol)
            vol === 0 ? e.target.mute() : e.target.unMute()
          }
        }
      })
    })

    Object.keys(players.current).forEach(id => {
      if (!visibleStreams.find(s => s.channelId === id)) {
        players.current[id]?.destroy?.()
        delete players.current[id]
      }
    })
  }, [ytReady, streamKeys])

  /* ================= AUDIO CONTROL ================= */
  useEffect(() => {
    Object.entries(players.current).forEach(([id, player]) => {
      if (!player?.setVolume) return
      const isFocused = id === focusedId
      if (!focusedId || isFocused) {
        player.unMute()
        player.setVolume(masterVolume)
      } else {
        if (audioMode === "mute") player.mute()
        else {
          player.unMute()
          player.setVolume(Math.round(masterVolume * (unfocusedVolume / 100)))
        }
      }
    })
  }, [focusedId, audioMode, unfocusedVolume, masterVolume])

  /* ================= UI HELPERS ================= */
  useEffect(() => {
    if (notifications.length > 0) {
      const t = setTimeout(() => setNotifications(prev => prev.slice(1)), 5000)
      return () => clearTimeout(t)
    }
  }, [notifications])

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

  const footerGroups = useMemo(() => {
    return (["A4A", "NMC"] as const).map(group => {
      const members = GROUPS[group]
      const filtered = streams
        .filter(s => members.includes(s.name) && (showOffline || s.status !== "offline"))
        .sort((a, b) => {
          const p: Record<string, number> = { live: 0, waiting: 1, scheduled: 2, offline: 3 }
          return p[a.status] - p[b.status]
        })
      return { name: group, streams: filtered }
    })
  }, [streams, showOffline])

  /* ================= CHAT OVERLAY ================= */
  useEffect(() => {
    if (!focusedId) return

    setChatLoading(true)
    setChatUnavailable(false)
    const timer = setTimeout(() => {
      setChatLoading(false)
      setChatUnavailable(true)
    }, 10000)

    return () => clearTimeout(timer)
  }, [focusedId])

  /* ================= SYNC ORDER ================= */
  useEffect(() => {
    const liveIds = visibleStreams.map(s => s.channelId)
    if (liveIds.length === 0) return

    setOrder(prev => {
      const kept = prev.filter(id => liveIds.includes(id))
      const added = liveIds.filter(id => !kept.includes(id))
      const nextOrder = [...kept, ...added]

      if (JSON.stringify(nextOrder) === JSON.stringify(prev)) return prev
      return nextOrder
    })
  }, [streamKeys])

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

  useEffect(() => {
    if (!focusedId) return

    setStreams(prev =>
      prev.map(s =>
        s.channelId === focusedId && !s.enabled
          ? { ...s, enabled: true }
          : s
      )
    )
  }, [focusedId])

  /* ================= SAVE STATE ================= */
  useEffect(() => {
    if (streams.length === 0) return
    localStorage.setItem(
      "layoutState",
      JSON.stringify({
        streams,
        order,
        focusedId,
      })
    )
  }, [streams, order, focusedId])

  useEffect(() => {
    const saved = localStorage.getItem("audioPrefs")
    if (!saved) return

    try {
      const parsed: AudioPrefs = JSON.parse(saved)
      if (parsed.audioMode) setAudioMode(parsed.audioMode)
      if (typeof parsed.masterVolume === "number")
        setMasterVolume(parsed.masterVolume)
      if (typeof parsed.unfocusedVolume === "number")
        setUnfocusedVolume(parsed.unfocusedVolume)
    } catch { }
  }, [])

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
                  value={isClient ? unfocusedVolume : 30}
                  onChange={(e) => setUnfocusedVolume(+e.target.value)}
                  title={`Others volume: ${unfocusedVolume}%`}
                />
              )}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.8 }}>🔊</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={isClient ? masterVolume : 40}
              onChange={(e) => setMasterVolume(+e.target.value)}
              title={`Master volume: ${isClient ? masterVolume : 40}%`}
            />
          </div>
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
                <span className={`label status-${s.status}`}>
                  <span className="dot" />
                  {s.name}
                </span>
                {s.concurrentViewers !== undefined && (
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
              src={`https://www.youtube.com/live_chat?v=${visibleStreams.find(s => s.channelId === focusedId)?.liveVideoId
                }&embed_domain=${host}`} onLoad={() => { setChatLoading(false) }}
              allow="autoplay"
            />
            {chatLoading && (
              <div className="chat-overlay">
                💬 Loading chat…
              </div>
            )}

            {!chatLoading && chatUnavailable && (
              <div className="chat-overlay">
                ⛔ Chat Unavailable
              </div>
            )}
          </aside>
        )}
      </div>
      <div className="notify-stack">
        {notifications.map(n => (
          <div key={n.id} className={`notify ${n.type}`}>
            {n.message}
          </div>
        ))}
      </div>
      <footer className="offline-bar">
        {footerGroups.map(g => (
          <div key={g.name} className="group-row">
            <span className="group-label">{g.name}</span>
            <div className="group-streams">
              {g.streams.map(s => (
                <span key={s.channelId} className={`toggle-pill ${s.status} ${s.enabled ? "enabled" : "disabled"}`}
                  onClick={() => {
                    if (s.status === "offline") return
                    setStreams(prev => prev.map(p => p.channelId === s.channelId ? { ...p, enabled: !p.enabled } : p))
                  }}>
                  <span className="dot" />{s.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </footer>
    </div >
  )
}

const GROUPS = {
  A4A: ["yb", "Tepe46", "Tierison", "bang mister aloy", "ibot13", "youKtheo", "Garry Ang", "Bravyson Vconk", "Niko Junius", "GURAISU", "Michelle Christo", "Jessica Prashela", "Derisky Prisadevano", "Juan Herman", "JAPETLETSDOIT", "Dylan Lauw", "MODE siNclair"],
  NMC: ["Papuy", "ELJAWZ", "MIRJAAA", "Danny", "Sipije", "zota frz", "a bee gel", "Bopeng", "Anjasmara7", "Lezype", "Gabriel", "Alesya Nina", "Chavilangel", "Maeve Soo", "Lise Zhang", "Dobori Tensha VT", "Gray Wellington", "Apinpalingserius", "Idinzzz", "Kicked417", "Wayne D Veron", "Moonears", "Jaka Triad", "Jacky Jax RP", "nayrdika", "ihsannn", "PaddanG", "Sam Wani", "SEYA", "CYYA", "BudyTabootie", "Happy RP", "Dipiw", "Raihan Dwi", "tasya", "LokiTheHuman", "irfan_4tm", "Boujee Girl", "NengEidel", "Intannn", "Wazowsky", "KafeeyInHere", "nenabobo", "hi.juenva", "Nanas Art", "Siberian Husky", "Ayus Bangga"],
}
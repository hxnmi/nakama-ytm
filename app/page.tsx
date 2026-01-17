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
  groups: string[]
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

type ReminderState = {
  show: boolean
  lastShownAt?: number
  dismissed?: boolean
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
  subReminder: "subReminderState"
}

export default function Page() {
  const players = useRef<Record<string, any>>({})
  const lastStatusRef = useRef<Record<string, StreamStatus>>({})
  const lastNotifyAtRef = useRef<Record<string, number>>({})
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

  const [subReminders, setSubReminders] =
    useState<Record<string, ReminderState>>({})

  // NEW: mobile menu open state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const liveStreams = useMemo(
    () => streams.filter(s => s.status === "live" && !!s.liveVideoId),
    [streams]
  )

  /* ================= COMPUTED ================= */
  const visibleStreams = useMemo(() => {
    const getIndex = (id: string) => {
      const i = order.indexOf(id)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }

    return streams
      .filter(s =>
        s.enabled &&
        s.liveVideoId &&
        s.status !== "offline"
      )
      .sort((a, b) => getIndex(a.channelId) - getIndex(b.channelId))
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
  }, [streams, order, focusedId, isClient])

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
                setNotifications(n => [...n, {
                  id: crypto.randomUUID(),
                  type: "live",
                  message: `🔴 ${r.name} is LIVE`
                }])
                lastNotifyAtRef.current[r.channelId] = now
              }
            }

            lastStatusRef.current[r.channelId] = r.status
            const playable = r.status !== "offline" && !!r.liveVideoId
            return { ...existing, ...r, liveVideoId: playable ? r.liveVideoId : undefined, enabled: existing?.enabled ?? false }
          })
        })
        localStorage.setItem(STORAGE.lastStatus, JSON.stringify(lastStatusRef.current))
      } catch (e) { console.error(e) }
    }

    fetchStatus()
    const jitter = Math.random() * 5000
    const t = setTimeout(() => {
      const i = setInterval(fetchStatus, 180000)
      return () => clearInterval(i)
    }, jitter)
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
            const isMain = !focusedId || isF
            const vol = isMain
              ? audioValues.current.masterVolume
              : audioValues.current.audioMode === "mute"
                ? 0
                : Math.round(audioValues.current.masterVolume *
                  audioValues.current.unfocusedVolume / 100)
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

  useEffect(() => {
    return () => {
      Object.values(players.current).forEach(p => p?.destroy?.())
      players.current = {}
    }
  }, [])

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

  const footerGroups = useMemo(() => {
    const map = new Map<string, Streamer[]>()
    const STATUS_PRIORITY: Record<StreamStatus, number> = {
      live: 0,
      waiting: 1,
      scheduled: 2,
      offline: 3,
    }

    streams.forEach(s => {
      s.groups?.forEach(g => {
        if (!map.has(g)) map.set(g, [])
        map.get(g)!.push(s)
      })
    })

    return Array.from(map.entries()).map(([name, streams]) => ({
      name,
      streams: streams
        .filter(s => showOffline || s.status !== "offline")
        .sort(
          (a, b) =>
            STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
        ),
    }))
  }, [streams, showOffline])

  useEffect(() => {
    if (!focusedId) return

    const stream = streams.find(s => s.channelId === focusedId)
    if (!stream || stream.status !== "live") return

    setSubReminders(prev => {
      const entry = prev[focusedId] ?? {}
      const now = Date.now()

      if (entry.dismissed) return prev
      if (entry.lastShownAt && now - entry.lastShownAt < 120_000)
        return prev

      return {
        ...prev,
        [focusedId]: {
          ...entry,
          show: true,
          lastShownAt: now,
        },
      }
    })
  }, [focusedId, streams])

  function dismissReminder(channelId: string) {
    setSubReminders(prev => ({
      ...prev,
      [channelId]: {
        dismissed: true,
        show: false,
        lastShownAt: Date.now(),
      },
    }))
  }

  useEffect(() => {
    localStorage.setItem(
      STORAGE.subReminder,
      JSON.stringify(subReminders)
    )
  }, [subReminders])

  useEffect(() => {
    const SPEED_PX_PER_SEC = 18
    const EDGE = 2

    const states = new Map<HTMLElement, {
      dir: 1 | -1
      carry: number
    }>()

    let lastTime = performance.now()
    let rafId: number

    const step = (now: number) => {
      const dt = (now - lastTime) / 1000
      lastTime = now

      const containers =
        document.querySelectorAll<HTMLElement>(".group-streams")

      containers.forEach(el => {
        if (el.matches(":hover")) return

        let state = states.get(el)
        if (!state) {
          state = { dir: 1, carry: 0 }
          states.set(el, state)

          const maxScroll = el.scrollWidth - el.clientWidth
          if (maxScroll > 0 && el.scrollLeft === 0) {
            el.scrollLeft = 1
          }
        }

        const maxScroll = el.scrollWidth - el.clientWidth
        if (maxScroll <= 0) return

        state.carry += state.dir * SPEED_PX_PER_SEC * dt
        const move = Math.trunc(state.carry)

        if (move !== 0) {
          el.scrollLeft += move
          state.carry -= move
        }

        if (el.scrollLeft < EDGE) el.scrollLeft = EDGE
        if (el.scrollLeft > maxScroll - EDGE)
          el.scrollLeft = maxScroll - EDGE

        if (state.dir === 1 && el.scrollLeft >= maxScroll - EDGE) {
          state.dir = -1
        } else if (state.dir === -1 && el.scrollLeft <= EDGE) {
          state.dir = 1
        }
      })

      rafId = requestAnimationFrame(step)
    }

    rafId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafId)
  }, [])

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 900) setMobileMenuOpen(false)
    }
    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

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

      if (
        prev.length === nextOrder.length &&
        prev.every((v, i) => v === nextOrder[i])
      ) return prev
      return nextOrder
    })
  }, [streamKeys])

  /* ================= LOAD CACHE ================= */
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
          <span className="live-count">
            LIVE: {liveStreams.length} / {streams.length}
          </span>
        </div>
        <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            className="mobile-menu-button"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(prev => !prev)}
            title="Open menu"
          >
            ☰
          </button>
          <div className="desktop-controls">
            {focusedId && (
              <div className="audio-focus-controls" style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            <div className="volume-group" style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
          </div>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="mobile-menu" role="dialog" aria-modal="true">
          <div className="mobile-menu-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <strong>Menu</strong>
            <button onClick={() => setMobileMenuOpen(false)} className="icon-button">✕</button>
          </div>

          <div className="mobile-menu-content" style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 6 }}>Master volume</label>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={isClient ? masterVolume : 40}
                onChange={(e) => setMasterVolume(+e.target.value)}
                title={`Master volume: ${isClient ? masterVolume : 40}%`}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 6 }}>Audio behavior</label>
              <select value={audioMode} onChange={(e) => setAudioMode(e.target.value as any)} style={{ width: '100%', padding: '6px 8px', borderRadius: 6, background: '#262633', color: '#fff', border: 'none' }}>
                <option value="mute">Mute others</option>
                <option value="reduce">Reduce others</option>
              </select>
            </div>

            {audioMode === 'reduce' && (
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Others volume</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={isClient ? unfocusedVolume : 30}
                  onChange={(e) => setUnfocusedVolume(+e.target.value)}
                  title={`Others volume: ${unfocusedVolume}%`}
                />
              </div>
            )}

            <div className="mobile-menu-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <button onClick={() => { setShowOffline(prev => !prev); setMobileMenuOpen(false); }} className={`toggle-pill ${showOffline ? 'enabled' : 'disabled'}`} style={{ flex: 1 }}>
                {showOffline ? "Hide Offline" : "Show Offline"}
              </button>
              <button onClick={() => setMobileMenuOpen(false)} style={{ marginLeft: 8, padding: '8px 12px', borderRadius: 8, background: '#262633', color: '#fff', border: 'none' }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`content ${focusedId ? "focus" : ""}`}>
        <main className={`grid ${focusedId ? "focus" : `grid-${visibleStreams.length}`}`}>
          {visibleStreams.map(s => {
            const isFocused = s.channelId === focusedId
            const reminder = subReminders[s.channelId]

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
                {isFocused && reminder?.show && (
                  <div className="sub-reminder">
                    ⭐ Support {s.name}<br />
                    ⬆️ hover the channel to subscribe!<br />
                    👍 click the title to like!
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        dismissReminder(s.channelId)
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}
                {
                  s.concurrentViewers !== undefined && (
                    <span className="viewer-count">
                      👁 {s.concurrentViewers.toLocaleString()}
                    </span>
                  )
                }
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

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
  subReminder: "subReminderState",
  showChat: "showChat"
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

  const [notifications, setNotifications] = useState<Notify[]>([])

  const [subReminders, setSubReminders] =
    useState<Record<string, ReminderState>>({})

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isCompactTitle, setIsCompactTitle] = useState(false)
  const [isVerySmall, setIsVerySmall] = useState(false);

  const [showChat, setShowChat] = useState<boolean>(false)

  const [theme, setTheme] = useState<"dark" | "light">("dark")

  const liveStreams = useMemo(
    () => streams.filter(s => s.status === "live" && !!s.liveVideoId),
    [streams]
  )

  const [streamInput, setStreamInput] = useState("")
  const [customStreams, setCustomStreams] = useState<Streamer[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)

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

  const layout = useMemo(() => {
    const videoCount = visibleStreams.length
    if (isMobile) {
      const ids = visibleStreams.map(s => s.channelId)
      const activeId = focusedId ?? ids[0]

      if (videoCount === 1 && showChat) {
        return {
          cols: 1,
          rows: 2,
          mode: "mobile-longchat",
          cells: [
            { type: "video", channelId: activeId },
            { type: "chat", channelId: activeId, rowSpan: 1 },
          ],
        }
      }
      if (videoCount === 1) {
        return {
          cols: 1,
          rows: 1,
          mode: "mobile",
          cells: [
            { type: "video", channelId: activeId },
          ],
        }
      }

      if (videoCount === 2 && showChat) {
        return {
          cols: 1,
          rows: 3,
          mode: "mobile",
          cells: [
            { type: "video", channelId: ids[0] },
            { type: "video", channelId: ids[1] },
            { type: "chat", channelId: activeId },
          ],
        }
      }

      if (videoCount === 2) {
        return {
          cols: 1,
          rows: 2,
          mode: "mobile",
          cells: ids.map(id => ({
            type: "video",
            channelId: id,
          })),
        }
      }

      if (videoCount === 3) {
        return {
          cols: 1,
          rows: 3,
          mode: "mobile",
          cells: ids.map(id => ({
            type: "video",
            channelId: id,
          })),
        }
      }
      if (videoCount > 4 && videoCount === 10 || isMobile) {
        const cols = 2
        const rows = Math.ceil(videoCount / cols)
        return {
          cols,
          rows,
          mode: "mobile",
          cells: Array.from({ length: videoCount }, (_, i) => ({
            type: "video" as const,
            channelId: visibleStreams[i]?.channelId,
          })),
        }
      }
    }
    if (!showChat || videoCount >= 5 || (isMobile && videoCount > 10)) {
      const cols = Math.ceil(Math.sqrt(videoCount))
      const rows = Math.ceil(videoCount / cols)
      return {
        cols,
        rows,
        mode: "grid" as "grid",
        cells: Array.from({ length: videoCount }, (_, i) => ({
          type: "video" as const,
          channelId: visibleStreams[i]?.channelId,
        })),
      }
    }
    // side by side chat for small counts
    if (videoCount === 0) {
      return { cols: 0, rows: 0, mode: "grid" as "grid", cells: [] }
    }
    if (videoCount === 1) {
      return {
        cols: 2,
        rows: 1,
        mode: "sidechat" as "sidechat",
        cells: [
          { type: "video" as const, channelId: visibleStreams[0].channelId },
          { type: "chat" as const, channelId: visibleStreams[0].channelId },
        ],
      }
    }
    if (videoCount === 2) {
      return {
        cols: 2,
        rows: 2,
        mode: "sidechat" as "sidechat",
        cells: [
          { type: "video" as const, channelId: visibleStreams[0].channelId },
          { type: "chat" as const, channelId: visibleStreams[0].channelId },
          { type: "video" as const, channelId: visibleStreams[1].channelId },
          { type: "chat" as const, channelId: visibleStreams[1].channelId },
        ],
      }
    }
    if (videoCount === 3) {
      const ids = visibleStreams.map(s => s.channelId)
      const cells: { type: "video" | "chat", channelId: string }[] = []
      for (let i = 0; i < 3; i++) {
        cells.push({ type: i % 2 === 0 ? "video" : "chat", channelId: ids[i] })
      }
      for (let i = 0; i < 3; i++) {
        cells.push({ type: i % 2 === 0 ? "chat" : "video", channelId: ids[i] })
      }
      return {
        cols: 3,
        rows: 2,
        mode: "grid" as "grid",
        cells,
      }
    }
    if (videoCount === 4) {
      const ids = visibleStreams.map(s => s.channelId)
      return {
        cols: 4,
        rows: 2,
        mode: "grid" as "grid",
        cells: [
          { type: "video" as const, channelId: ids[0] },
          { type: "chat" as const, channelId: ids[0] },
          { type: "chat" as const, channelId: ids[1] },
          { type: "video" as const, channelId: ids[1] },

          { type: "video" as const, channelId: ids[2] },
          { type: "chat" as const, channelId: ids[2] },
          { type: "chat" as const, channelId: ids[3] },
          { type: "video" as const, channelId: ids[3] },
        ],
      }
    }
    return {
      cols: videoCount,
      rows: 1,
      mode: "grid" as "grid",
      cells: Array.from({ length: videoCount }, (_, i) => ({
        type: "video" as const,
        channelId: visibleStreams[i]?.channelId,
      })),
    }
  }, [visibleStreams, showChat])

  /* ================= INITIAL LOAD ================= */
  useEffect(() => {
    setIsClient(true)
    setHost(window.location.hostname)

    try {
      const savedChat = localStorage.getItem(STORAGE.showChat)
      if (savedChat !== null) {
        setShowChat(savedChat === "true")
      }

      const savedAudio = localStorage.getItem(STORAGE.audio)
      if (savedAudio) {
        const p = JSON.parse(savedAudio)
        setAudioMode(p.audioMode); setMasterVolume(p.masterVolume); setUnfocusedVolume(p.unfocusedVolume)
      }
      const savedLayout = localStorage.getItem(STORAGE.layout)
      if (savedLayout) {
        const p = JSON.parse(savedLayout)
        if (p.streams) setStreams(p.streams)
        if (p.order) setOrder(p.order)
        if (p.focusedId) setFocusedId(p.focusedId)
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

  useEffect(() => {
    if (!isClient) return
    localStorage.setItem(STORAGE.showChat, String(showChat))
  }, [showChat, isClient])

  useEffect(() => {
    const saved = localStorage.getItem("customStreams")
    if (saved) {
      setCustomStreams(JSON.parse(saved))
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(
      "customStreams",
      JSON.stringify(customStreams)
    )
  }, [customStreams])

  /* ================= API SYNC ================= */
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/live-status")
        const data: Streamer[] = await res.json()

        setStreams(prev => {
          const map = new Map(prev.map(p => [p.channelId, p]))
          const apiStreams = data.map(r => {
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
          const custom = prev.filter(p =>
            p.channelId.startsWith("custom-")
          )
          return [...apiStreams, ...custom]
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

  /* ================= PLAYERS ================= */
  useEffect(() => {
    if (!ytReady) return

    streams.forEach(s => {
      if (!s.liveVideoId || s.status === "offline") return

      const id = s.channelId
      const el = document.getElementById(`player-${id}`)
      if (!el) return

      if (players.current[id]) return

      players.current[id] = new window.YT.Player(el, {
        videoId: s.liveVideoId,
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          rel: 0,
          enablejsapi: 1,
        },
        events: {
          onReady: (e: any) => {
            const isFocused = id === focusedId
            const isMain = !focusedId || isFocused

            const vol = isMain
              ? audioValues.current.masterVolume
              : audioValues.current.audioMode === "mute"
                ? 0
                : Math.round(
                  audioValues.current.masterVolume *
                  audioValues.current.unfocusedVolume / 100
                )

            e.target.setVolume(vol)
            vol === 0 ? e.target.mute() : e.target.unMute()
          },
        },
      })
    })
  }, [ytReady, streams])

  useEffect(() => {
    streams.forEach(s => {
      const id = s.channelId
      if (!s.enabled && players.current[id]) {
        players.current[id].destroy()
        delete players.current[id]
      }
    })
  }, [streams])

  function extractYouTubeVideoId(url: string): string | null {
    try {
      const u = new URL(url)

      // youtu.be/<id>
      if (u.hostname.includes("youtu.be")) {
        return u.pathname.replace("/", "")
      }

      // youtube.com/watch?v=<id>
      if (u.searchParams.has("v")) {
        return u.searchParams.get("v")
      }

      return null
    } catch {
      return null
    }
  }

  function createCustomStreamer(videoId: string): Streamer {
    return {
      name: `Custom Stream`,
      channelId: `custom-${videoId}`,
      status: "live",
      liveVideoId: videoId,
      enabled: true,
      groups: ["Custom"],
    }
  }

  /* ================= AUDIO CONTROL ================= */
  useEffect(() => {
    Object.entries(players.current).forEach(([id, player]) => {
      if (!player) return

      const isFocused = id === focusedId
      const isMain = !focusedId || isFocused

      const vol = isMain
        ? masterVolume
        : audioMode === "mute"
          ? 0
          : Math.round(masterVolume * (unfocusedVolume / 100))

      safeApplyAudio(
        player,
        vol,
        !isMain && audioMode === "mute"
      )
    })
  }, [focusedId, audioMode, unfocusedVolume, masterVolume])


  function safeApplyAudio(
    player: any,
    volume: number,
    mute: boolean
  ) {
    try {
      // Force player into a state where audio changes are accepted
      player.playVideo?.()
    } catch { }

    requestAnimationFrame(() => {
      try {
        if (mute || volume === 0) {
          player.mute?.()
        } else {
          player.unMute?.()
          player.setVolume?.(volume)
        }
      } catch { }
    })
  }

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
    setStreams(prev => {
      const apiStreams = prev.filter(s => !s.channelId.startsWith("custom-"))
      return [...apiStreams, ...customStreams]
    })
  }, [customStreams])

  function addCustomStream() {
    const videoId = extractYouTubeVideoId(streamInput)
    if (!videoId) {
      alert("Invalid YouTube link")
      return
    }

    const channelId = `custom-${videoId}`

    setCustomStreams(prev => {
      if (prev.some(s => s.channelId === channelId)) return prev
      return [...prev, createCustomStreamer(videoId)]
    })

    setStreamInput("")
  }

  function toggleCustomEnabled(id: string) {
    setStreams(prev =>
      prev.map(p =>
        p.channelId === id
          ? { ...p, enabled: !p.enabled }
          : p
      )
    )

    setCustomStreams(prev =>
      prev.map(p =>
        p.channelId === id
          ? { ...p, enabled: !p.enabled }
          : p
      )
    )
  }

  const [selectedCustomId, setSelectedCustomId] =
    useState<string | null>(null)

  function removeCustomStream(id: string) {
    setCustomStreams(prev =>
      prev.filter(s => s.channelId !== id)
    )

    setStreams(prev =>
      prev.filter(s => s.channelId !== id)
    )

    if (players.current[id]) {
      players.current[id].destroy()
      delete players.current[id]
    }

    if (focusedId === id) {
      setFocusedId(null)
    }

    setSelectedCustomId(null)
  }

  function StreamInputCombo({
    streamInput,
    setStreamInput,
    addCustomStream,
    dropdownOpen,
    setDropdownOpen,
    customStreams,
    toggleCustomEnabled,
    removeCustomStream,
  }: any) {
    return (
      <div className="stream-input-combo" style={{ position: "relative" }}>
        <div className="select-like">
          <input
            placeholder="Paste Custom Live link..."
            value={streamInput}
            onChange={e => setStreamInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addCustomStream()}
          />

          <button
            type="button"
            className="dropdown-toggle"
            onClick={() => setDropdownOpen((v: boolean) => !v)}
            aria-label="Toggle dropdown"
          />
        </div>

        {dropdownOpen && (
          <div className="select-dropdown">
            {customStreams.map((s: any) => (
              <div
                key={s.channelId}
                className={`select-item ${s.enabled ? "enabled" : "disabled"}`}
                onClick={() => toggleCustomEnabled(s.channelId)}
              >
                <div
                  className="left"
                >
                  <span className="dot" />
                  <span className="name">{s.name}</span>
                </div>

                <div className="actions">

                  <button
                    title="Remove"
                    onClick={() => removeCustomStream(s.channelId)}
                  >
                    ❌
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  useEffect(() => {
    const check = () => setIsCompactTitle(window.innerWidth < 1120)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 900) setMobileMenuOpen(false)
    }
    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  useEffect(() => {
    const check = () => setIsVerySmall(window.innerWidth < 500);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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
    <div className={`app theme-${theme}`}>
      <header className="header">
        <div className="header-left" onClick={(e) => e.preventDefault()}>
          <div className="logo-tooltip">
            <img
              src="/FULL-LOGO-NMC.png"
              alt="Nakama"
              className="logo"
              draggable={false}
            />
            <h1>{isCompactTitle ? "Nakama YTM" : "Nakama Youtube MultiView"}</h1>
            <span className="tooltip">
              Created by hxnmi for nakama #NFFN
            </span>
          </div>
          <span className="live-count">
            {isCompactTitle ? (
              <span>
                LIVE:<br />
                {liveStreams.length} / {streams.length}
              </span>

            ) : (
              <span>
                LIVE: {liveStreams.length} / {streams.length}
              </span>
            )}
          </span>
          <button
            className="ui-btn"
            onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "🌙 Dark" : "🌞 Light"}
          </button>
          {!isVerySmall && (
            <StreamInputCombo
              streamInput={streamInput}
              setStreamInput={setStreamInput}
              addCustomStream={addCustomStream}
              dropdownOpen={dropdownOpen}
              setDropdownOpen={setDropdownOpen}
              customStreams={customStreams}
              toggleCustomEnabled={toggleCustomEnabled}
              removeCustomStream={removeCustomStream}
            />
          )}
        </div>
        <div className="header-right">
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
              className={`ui-btn ${showOffline ? 'enabled' : 'disabled'}`}
              style={{ background: showOffline ? '#e11d48' : 'var(--panel-2)', border: 'none', color: 'var(--text)', cursor: 'pointer' }}
            >
              {showOffline ? "Hide Offline" : "Show Offline"}
            </button>
          </div>
          <button
            className="ui-btn"
            onClick={() => setShowChat(v => !v)}
            disabled={visibleStreams.length === 0}
          >
            💬 Chat
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="mobile-menu" role="dialog" aria-modal="true">
          <div className="mobile-menu-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <strong>Menu</strong>
          </div>

          <div className="mobile-menu-content" style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {isVerySmall && (
              <>
                <label>
                  Custom Live Stream
                </label>

                <StreamInputCombo
                  streamInput={streamInput}
                  setStreamInput={setStreamInput}
                  addCustomStream={addCustomStream}
                  dropdownOpen={dropdownOpen}
                  setDropdownOpen={setDropdownOpen}
                  customStreams={customStreams}
                  toggleCustomEnabled={toggleCustomEnabled}
                  removeCustomStream={removeCustomStream}
                />
              </>
            )}
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
              <select value={audioMode} onChange={(e) => setAudioMode(e.target.value as any)}>
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

            <div className="mobile-menu-actions">
              <button onClick={() => { setShowOffline(prev => !prev); setMobileMenuOpen(false); }} className={`ui-btn ${showOffline ? 'enabled' : 'disabled'}`} style={{ flex: 1 }}>
                {showOffline ? "Hide Offline" : "Show Offline"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="content">
        <main
          className="canvas"
          style={{
            gridTemplateColumns:
              layout.mode === "sidechat"
                ? "minmax(0, 3fr) minmax(0, 1fr)"
                : `repeat(${layout.cols}, 1fr)`,
            gridTemplateRows: isMobile
              ? "auto"
              : `repeat(${layout.rows}, 1fr)`,
          }}
        >
          {layout.cells.map((cell, i) => {
            if (cell.type === "video") {
              const s = visibleStreams.find(v => v.channelId === cell.channelId)
              if (!s) return <div key={`empty-video-${i}`} />

              const isFocused = s.channelId === focusedId

              return (
                <div
                  key={`video-cell-${cell.channelId}`}
                  className={`stream-card ${isFocused ? "focused" : ""}`}
                  onClick={() =>
                    setFocusedId(prev => (prev === s.channelId ? null : s.channelId))
                  }
                >
                  <div className="video-wrap">
                    <div
                      id={`player-${s.channelId}`}
                      data-channel={s.channelId}
                    />
                  </div>

                  <button
                    className={`stream-label ${isFocused ? "active" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setFocusedId(prev => (prev === s.channelId ? null : s.channelId))
                    }}
                  >
                    <span className={`dot ${s.status}`} />
                    {s.name}
                  </button>

                  {
                    isFocused && subReminders[s.channelId]?.show && (
                      <div className="sub-reminder">
                        ⭐ Support {s.name}<br />
                        ⬆️ Subscribe & 👍 Like<br />
                        By opening the source video!
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            dismissReminder(s.channelId)
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    )
                  }

                  {
                    s.concurrentViewers !== undefined && (
                      <span className="viewer-count">
                        👁 {s.concurrentViewers.toLocaleString()}
                      </span>
                    )
                  }
                </div>
              )
            }
            if (cell.type === "chat") {
              const s = visibleStreams.find(v => v.channelId === cell.channelId)
              if (!s) return <div key={`empty-chat-${i}`} />
              const chatSrc = `https://www.youtube.com/live_chat?v=${s.liveVideoId}&embed_domain=${host}&dark_theme=${theme === "dark" ? 1 : 0}`
              return (
                <div
                  key={`chat-${cell.channelId}`}
                  className={`chat-card ${isMobile ? "mobile-chat" : ""}`}
                  style={
                    isMobile && layout.mode === "mobile-longchat"
                      ? { gridRow: "span 2" }
                      : undefined
                  }
                >
                  <iframe
                    src={chatSrc}
                    allow="autoplay"
                    title={`chat-${s.channelId}`}
                  />
                </div>
              )
            }

            return null
          })}

        </main>
      </div >

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
                <span
                  key={s.channelId}
                  className={`toggle-pill ${s.status} ${s.enabled ? "enabled" : "disabled"}`}
                  onClick={() => {
                    if (s.status === "offline") return
                    setStreams(prev => prev.map(p => p.channelId === s.channelId ? { ...p, enabled: !p.enabled } : p))
                  }}
                >
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

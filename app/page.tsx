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
  showChat: "showChat",
  customStreams: "customStreams",
  theater: "theaterMode",
  theme: "theme",
}

const STATUS_PRIORITY: Record<StreamStatus, number> = {
  live: 0,
  waiting: 1,
  scheduled: 2,
  offline: 3,
}

const PlayerHost = ({ channelId }: { channelId: string }) => {
  return (
    <div
      id={`player-${channelId}`}
      data-channel={channelId}
      style={{ width: "100%", height: "100%" }}
    />
  )
}

export default function Page() {
  const players = useRef<Record<string, any>>({})
  const lastStatusRef = useRef<Record<string, StreamStatus>>({})
  const lastNotifyAtRef = useRef<Record<string, number>>({})
  const lastMainIdRef = useRef<string | null>(null)
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

  const [showChat, setShowChat] = useState<boolean>(false)

  const [theme, setTheme] = useState<"dark" | "light">("dark")
  const [theater, setTheater] = useState(false)
  const [mounted, setMounted] = useState(false)

  const liveCount = streams.filter(s => s.status === "live").length

  const [streamInput, setStreamInput] = useState("")
  const [customStreams, setCustomStreams] = useState<Streamer[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const [viewport, setViewport] = useState({ w: 0 })

  const isMobile = viewport.w <= 768
  const isVerySmall = viewport.w < 500
  const isCompactTitle = viewport.w < 1120

  /* ================= COMPUTED ================= */
  const visibleStreams = useMemo(() => {
    const filtered = streams.filter(
      s => s.enabled && s.liveVideoId && s.status !== "offline"
    )

    return filtered.sort((a, b) => {
      return (STATUS_PRIORITY[a.status] ?? 4) - (STATUS_PRIORITY[b.status] ?? 4)
    })
  }, [streams])

  const streamMap = useMemo(
    () => new Map(visibleStreams.map(s => [s.channelId, s])),
    [visibleStreams]
  )

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
            { type: "chat", channelId: activeId, rowSpan: 2 },
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
      if (videoCount <= 10) {
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
      if (videoCount > 10) {
        const cols = 3
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
    if (videoCount === 1) {
      if (showChat) {
        return {
          cols: 2,
          rows: 1,
          mode: "sidechat" as "sidechat",
          cells: [
            { type: "video" as const, channelId: visibleStreams[0].channelId },
            { type: "chat" as const, channelId: visibleStreams[0].channelId },
          ],
        }
      } else {
        return {
          cols: 1,
          rows: 1,
          mode: "grid" as "grid",
          cells: [
            { type: "video" as const, channelId: visibleStreams[0].channelId },
          ],
        }
      }
    }
    if (theater) {
      if (videoCount > 5) {
        const ids = visibleStreams.map(s => s.channelId)
        const mainId = (focusedId && ids.includes(focusedId))
          ? focusedId
          : (lastMainIdRef.current && ids.includes(lastMainIdRef.current))
            ? lastMainIdRef.current
            : ids[0]

        const thumbs = ids.filter(id => id !== mainId)

        if (showChat) {
          const cells = [
            { type: "video", channelId: mainId, colStart: 1, rowStart: 1, colSpan: 3, rowSpan: 3 },
            { type: "chat", channelId: mainId, colStart: 5, rowStart: 1, rowSpan: 5 },
          ]

          thumbs.forEach((id, j) => {
            const cell: any = { type: "video", channelId: id }
            if (j < 4) {
              cell.colStart = undefined
              cell.rowStart = 4
            } else if (j < 7) {
              cell.colStart = 4
              cell.rowStart = j - 3
            } else {
              cell.colStart = undefined
              cell.rowStart = 5
            }
            cells.push(cell)
          })

          return { cols: 5, rows: 5, mode: "theater", cells }
        } else {
          const mainRowSpan = videoCount === 4 ? 3 : videoCount === 5 ? 4 : 2
          const cols = 4
          const rows = Math.max(mainRowSpan, 2 + Math.ceil(Math.max(0, thumbs.length - 4) / 4))
          const cells: any = [
            { type: "video", channelId: mainId, colStart: 1, rowStart: 1, colSpan: 2, rowSpan: mainRowSpan },
          ]

          thumbs.forEach((id, j) => {
            const cell: any = { type: "video", channelId: id }
            if (j < 2) {
              cell.colStart = 3
              cell.rowStart = j + 1
            } else if (j < 4) {
              cell.colStart = 4
              cell.rowStart = j - 1
            } else {
              cell.colStart = (j - 4) % 4 + 1
              cell.rowStart = 3 + Math.floor((j - 4) / 4)
            }
            cells.push(cell)
          })

          return { cols, rows, mode: "theater", cells }
        }
      }

      if (videoCount > 1) {
        const ids = visibleStreams.map(s => s.channelId)
        const mainId = (focusedId && ids.includes(focusedId))
          ? focusedId
          : (lastMainIdRef.current && ids.includes(lastMainIdRef.current))
            ? lastMainIdRef.current
            : ids[0]

        const thumbs = ids.filter(id => id !== mainId)

        if (showChat) {
          const cells = [
            { type: "video", channelId: mainId, colStart: 1, rowStart: 1, colSpan: 4, rowSpan: 4 },
            { type: "chat", channelId: mainId, colStart: 5, rowStart: 1, rowSpan: 5 },
            ...thumbs.map((id, i) => ({
              type: "video",
              channelId: id,
              colStart: (i % 4) + 1,
              rowStart: 5
            })),
          ]

          return { cols: 5, rows: 5, mode: "theater", cells }
        } else {
          const mainRowSpan = videoCount === 4 ? 3 : videoCount === 5 ? 4 : 2
          const rows = Math.max(mainRowSpan, thumbs.length)
          const cells = [
            { type: "video", channelId: mainId, colStart: 1, rowStart: 1, colSpan: 3, rowSpan: mainRowSpan },
            ...thumbs.map((id, i) => ({
              type: "video",
              channelId: id,
              colStart: 4,
              rowStart: i + 1
            })),
          ]

          return { cols: 4, rows, mode: "theater", cells }
        }
      }
    }
    else {
      if (!showChat || videoCount >= 5) {
        const cols = Math.ceil(Math.sqrt(videoCount))
        const rows = Math.ceil(videoCount / cols)
        return {
          cols,
          rows,
          mode: "grid" as "grid",
          cells: Array.from({ length: videoCount }, (_, i) => ({
            type: "video" as const,
            channelId: visibleStreams[i]?.channelId,
            colStart: (i % cols) + 1,
            rowStart: Math.floor(i / cols) + 1,
          })),
        }
      }
      if (videoCount === 2) {
        const ids = visibleStreams.map(s => s.channelId)
        return {
          cols: 2,
          rows: 2,
          mode: "2-sidechat" as "2-sidechat",
          cells: [
            { type: "video" as const, channelId: ids[0], colStart: 1, rowStart: 1 },
            { type: "chat-column" as const, channelIds: [ids[0], ids[1]], colStart: 2, rowStart: 1, rowSpan: 2 },
            { type: "video" as const, channelId: ids[1], colStart: 1, rowStart: 2 },
          ],
        }
      }
      if (videoCount === 3) {
        const ids = visibleStreams.map(s => s.channelId)
        return {
          cols: 3,
          rows: 2,
          mode: "3-grid" as "3-grid",
          cells: [
            { type: "video" as const, channelId: ids[0], rowStart: 1, colStart: 1 },
            { type: "video" as const, channelId: ids[1], rowStart: 2, colStart: 2 },
            { type: "video" as const, channelId: ids[2], rowStart: 1, colStart: 3 },

            { type: "chat" as const, channelId: ids[0], rowStart: 2, colStart: 1 },
            { type: "chat" as const, channelId: ids[1], rowStart: 1, colStart: 2 },
            { type: "chat" as const, channelId: ids[2], rowStart: 2, colStart: 3 }
          ],
        }
      }
      if (videoCount === 4) {
        const ids = visibleStreams.map(s => s.channelId)
        return {
          cols: 4,
          rows: 2,
          mode: "4-grid" as "4-grid",
          cells: [
            { type: "video" as const, channelId: ids[0], colStart: 1, rowStart: 1 },
            { type: "chat" as const, channelId: ids[0], colStart: 2, rowStart: 1 },
            { type: "video" as const, channelId: ids[1], colStart: 4, rowStart: 1 },
            { type: "chat" as const, channelId: ids[1], colStart: 3, rowStart: 1 },
            { type: "video" as const, channelId: ids[2], colStart: 1, rowStart: 2 },
            { type: "chat" as const, channelId: ids[2], colStart: 2, rowStart: 2 },
            { type: "video" as const, channelId: ids[3], colStart: 4, rowStart: 2 },
            { type: "chat" as const, channelId: ids[3], colStart: 3, rowStart: 2 },

          ],
        }
      }
    }
    return {
      cols: videoCount,
      rows: 1,
      mode: "grid" as "grid",
      cells: Array.from({ length: videoCount }, (_, i) => ({
        type: "video" as const,
        channelId: visibleStreams[i]?.channelId,
        colStart: (i % videoCount) + 1,
        rowStart: 1,
      })),
    }
  }, [visibleStreams, showChat, isMobile, focusedId, theater])

  const gridTemplateColumns = useMemo(() => {
    if (layout.mode === "sidechat") return "minmax(0, 3fr) minmax(0, 1fr)";
    if (isCompactTitle && layout.mode === "2-sidechat") return "minmax(0, 1fr) minmax(0, 1fr)";
    if (layout.mode === "2-sidechat") return "minmax(0, 1.5fr) minmax(0, 1fr)";
    if (layout.mode === "theater") {
      return showChat
        ? "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.36fr)"
        : "repeat(4, 1fr)";
    }
    return `repeat(${layout.cols}, 1fr)`;
  }, [layout.mode, layout.cols, showChat]);

  const gridTemplateRows = useMemo(
    () => (isMobile ? "auto" : `repeat(${layout.rows}, 1fr)`),
    [isMobile, layout.rows]
  );

  const positions = useMemo(() => {
    const m = new Map<string, any>()
    layout.cells.forEach((c: any) => {
      if (c.type === "video") {
        m.set(`video-${c.channelId}`, {
          colStart: c.colStart,
          rowStart: c.rowStart,
          colSpan: c.colSpan,
          rowSpan: c.rowSpan,
        })
      }
      else if (c.type === "chat") {
        m.set(`chat-${c.channelId}`, {
          colStart: c.colStart,
          rowStart: c.rowStart,
          colSpan: c.colSpan,
          rowSpan: c.rowSpan,
        })
      }
      else if (c.type === "chat-column") {
        m.set(`chat-column-${c.channelIds[0]}`, {
          colStart: c.colStart,
          rowStart: c.rowStart,
          colSpan: c.colSpan,
          rowSpan: c.rowSpan,
        })
      }
    })
    return m
  }, [layout])



  /* ================= INITIAL LOAD ================= */
  useEffect(() => {
    setIsClient(true)
    setHost(window.location.hostname)

    try {
      const savedChat = localStorage.getItem(STORAGE.showChat)
      if (savedChat !== null) {
        setShowChat(savedChat === "true")
      }
      const savedTheater = localStorage.getItem(STORAGE.theater)
      if (savedTheater !== null) {
        setTheater(savedTheater === "true")
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

  /* ================= HELPERS ================= */
  const buildChatUrl = (videoId: string) => {
    return `https://www.youtube.com/live_chat?v=${videoId}&embed_domain=${host}&dark_theme=${theme === "dark" ? 1 : 0}`
  }

  const getGridStyle = (pos: any) => {
    if (!pos) return {}
    return {
      ...(pos.colStart ? { gridColumnStart: `${pos.colStart}` } : {}),
      ...(pos.colSpan ? { gridColumnEnd: `span ${pos.colSpan}` } : {}),
      ...(pos.rowStart ? { gridRowStart: `${pos.rowStart}` } : {}),
      ...(pos.rowSpan ? { gridRowEnd: `span ${pos.rowSpan}` } : {}),
    }
  }

  useEffect(() => {
    setMounted(true)
    const saved = localStorage.getItem(STORAGE.theme)
    if (saved === "light" || saved === "dark") {
      setTheme(saved)
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
    if (!mounted) return
    localStorage.setItem(STORAGE.theme, theme)
  }, [theme, mounted])

  useEffect(() => {
    if (!isClient) return
    localStorage.setItem(STORAGE.theater, String(theater))
  }, [theater, isClient])

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE.customStreams)
    if (saved) {
      setCustomStreams(JSON.parse(saved))
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(
      STORAGE.customStreams,
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

  async function fetchYouTubeMeta(videoId: string) {
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
      )
      if (!res.ok) throw new Error("oEmbed failed")
      return await res.json()
    } catch {
      return null
    }
  }
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

      if (u.hostname.includes("youtu.be")) {
        return u.pathname.replace("/", "")
      }
      if (u.searchParams.has("v")) {
        return u.searchParams.get("v")
      }

      return null
    } catch {
      return null
    }
  }

  useEffect(() => {
    const activeIds = new Set(
      streams.filter(s => s.liveVideoId).map(s => s.channelId)
    )

    Object.keys(players.current).forEach(id => {
      if (!activeIds.has(id)) {
        players.current[id].destroy()
        delete players.current[id]
      }
    })
  }, [streams])

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

  async function addCustomStream() {
    const videoId = extractYouTubeVideoId(streamInput)
    if (!videoId) {
      alert("Invalid YouTube link")
      setStreamInput("")
      return
    }

    const meta = await fetchYouTubeMeta(videoId)

    setCustomStreams(prev => {
      if (prev.some(s => s.channelId === `custom-${videoId}`)) {
        return prev
      }

      return [
        ...prev,
        {
          name: meta?.author_name ?? "Custom Stream",
          channelId: `custom-${videoId}`,
          status: "live",
          liveVideoId: videoId,
          enabled: true,
          groups: ["Custom"],
        },
      ]
    })

    setStreamInput("")
  }

  function toggleCustomEnabled(id: string) {
    const updateStreams = (streams: Streamer[]) =>
      streams.map(p =>
        p.channelId === id ? { ...p, enabled: !p.enabled } : p
      )
    setStreams(updateStreams)
    setCustomStreams(updateStreams)
  }

  function removeCustomStream(id: string) {
    const filterStreams = (streams: Streamer[]) =>
      streams.filter(s => s.channelId !== id)
    setCustomStreams(filterStreams)
    setStreams(filterStreams)

    if (players.current[id]) {
      players.current[id].destroy()
      delete players.current[id]
    }

    if (focusedId === id) {
      setFocusedId(null)
    }
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
            id="custom-stream-input"
            name="customStreamUrl"
            type="text"
            placeholder="Paste Custom Live link..."
            value={streamInput}
            onChange={e => setStreamInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault()
                addCustomStream()
              }
            }}
          />
          <button
            className="dropdown-toggle"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDropdownOpen((v: boolean) => !v)
            }}
            onMouseDown={(e) => e.preventDefault()}
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
                    onClick={(e) => {
                      e.stopPropagation()
                      removeCustomStream(s.channelId)
                    }}
                  >
                    ❌
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
        }
      </div >
    );
  }

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      setViewport({ w })
      if (w > 900) setMobileMenuOpen(false)
    }

    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

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
  if (!mounted) {
    return <div className="app theme-dark" />
  }
  return (
    <div className={`app theme-${theme}`}>
      <header className="header">
        <div className="header-left">
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
                {liveCount} / {streams.length}
              </span>

            ) : (
              <span>
                LIVE: {liveCount} / {streams.length}
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
            <button
              className="ui-btn" style={{ display: "flex", alignItems: "center", gap: 8 }}
              onClick={() => {
                setTheater(prev => !prev)
              }}
            >
              {theater === true ? "Theater Mode" : "Default Mode"}
            </button>
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
          style={{ gridTemplateColumns, gridTemplateRows }}
        >
          {visibleStreams.map(s => {
            const cell = positions.get(`video-${s.channelId}`)
            const isFocused = s.channelId === focusedId
            return (
              <div
                key={s.channelId}
                className={`stream-card ${isFocused ? "focused" : ""}`}
                style={layout.mode === "theater" && cell ? getGridStyle(cell) : getGridStyle(cell)}
              >
                <div className="video-wrap">
                  <PlayerHost channelId={s.channelId} />
                </div>
                <button
                  className={`stream-label ${isFocused ? "active" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setFocusedId(prev => {
                      const next = prev === s.channelId ? null : s.channelId

                      if (theater) {
                        if (next === null) {
                          lastMainIdRef.current = prev
                        } else {
                          lastMainIdRef.current = next
                        }
                      }

                      requestAnimationFrame(() => {
                        Object.entries(players.current).forEach(([id, player]) => {
                          if (!player) return

                          const isMain = next === null || id === next
                          const vol = isMain
                            ? audioValues.current.masterVolume
                            : audioValues.current.audioMode === "mute"
                              ? 0
                              : Math.round(
                                audioValues.current.masterVolume *
                                audioValues.current.unfocusedVolume / 100
                              )

                          if (vol === 0) {
                            player.mute?.()
                          } else {
                            player.unMute?.()
                            player.setVolume?.(vol)
                          }
                        })
                      })
                      return next
                    })

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
          })}
          {
            layout.cells.map((cell: any, i: number) => {
              if (cell.type === "chat") {
                const s = streamMap.get(cell.channelId)
                if (!s) return <div key={`empty-chat-${i}`} />
                const pos = positions.get(`chat-${cell.channelId}`)
                return (
                  <div
                    key={`chat-${cell.channelId}`}
                    className={`chat-card ${isMobile ? "mobile-chat" : ""}`}
                    style={getGridStyle(pos)}
                  >
                    <iframe
                      src={buildChatUrl(s.liveVideoId!)}
                      allow="autoplay"
                      title={`chat-${s.channelId}`}
                    />
                  </div>
                )
              }
              if (cell.type === "chat-column") {
                const [idA, idB] = (cell as any).channelIds
                const sA = streamMap.get(idA)
                const sB = streamMap.get(idB)
                const pos = positions.get(`chat-column-${idA}`)

                return (
                  <div
                    key={`chat-column-${i}`}
                    className="chat-column"
                    style={getGridStyle(pos)}
                  >
                    <div className="chat-card" aria-hidden={!sA}>
                      {sA ? (
                        <iframe
                          src={buildChatUrl(sA.liveVideoId!)}
                          title={`chat-${sA.channelId}`}
                          allow="autoplay"
                        />
                      ) : null}
                    </div>

                    <div className="chat-card" aria-hidden={!sB}>
                      {sB ? (
                        <iframe
                          src={buildChatUrl(sB.liveVideoId!)}
                          title={`chat-${sB.channelId}`}
                          allow="autoplay"
                        />
                      ) : null}
                    </div>
                  </div>
                )
              }
              if (cell.type === "empty") {
                return <div key={`empty-${i}`} />
              }

              return null
            })
          }
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
                    if (theater && focusedId === s.channelId) {
                      setFocusedId(null)
                    }
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
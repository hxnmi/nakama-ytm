"use client"

import { useEffect, useRef, useState, useMemo } from "react"

type StreamStatus = "live" | "waiting" | "scheduled" | "offline"

type Streamer = {
  name: string
  channelId: string
  status: StreamStatus
  liveVideoId?: string
  concurrentViewers?: number
  order?: number
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

type HashtagResult = {
  videoId: string
  title: string
  channelName: string
  channelId: string
  thumbnailUrl: string
  viewerCount?: number
}

type ClipChunk = {
  blob: Blob
  timestamp: number
}

type TutorialStep = {
  target: string;
  title: string;
  text: string;
  placement: | "top" | "top-right" | "right" | "bottom-right" | "bottom" | "bottom-left" | "left" | "top-left";
  offsetX?: number;
  offsetY?: number;
  beforeShow?: () => void;
  hideOnMobile?: boolean;
  hideOnDesktop?: boolean;
};

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
  const boxRef = useRef<HTMLDivElement>(null);

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
  const [rampedActivePlayerIds, setRampedActivePlayerIds] = useState<string[]>([])

  const liveCount = streams.filter(s => s.status === "live").length

  const [streamInput, setStreamInput] = useState("")
  const [customStreams, setCustomStreams] = useState<Streamer[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const [showHashtagPanel, setShowHashtagPanel] = useState(false)
  const [hashtagResults, setHashtagResults] = useState<HashtagResult[]>([])
  const [hashtagLoading, setHashtagLoading] = useState(false)

  const [clipMenuOpen, setClipMenuOpen] = useState(false)
  const [clipLengthMinutes, setClipLengthMinutes] = useState(3)
  const [clipStatus, setClipStatus] = useState<string | null>(null)
  const [clipError, setClipError] = useState<string | null>(null)

  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [step, setStep] = useState(0);

  const [viewport, setViewport] = useState({ w: 0 })

  const clipStreamRef = useRef<MediaStream | null>(null)
  const clipRecorderRef = useRef<MediaRecorder | null>(null)
  const clipChunksRef = useRef<ClipChunk[]>([])
  const clipFocusedIdRef = useRef<string | null>(null)
  const clipMimeTypeRef = useRef<string | null>(null)

  const isVerySmall = viewport.w < 364 || (viewport.w > 499 && viewport.w < 600)
  const isSmall = viewport.w < 500
  const isMobile = viewport.w <= 768
  const isCompactTitle = viewport.w < 1120

  /* ================= COMPUTED ================= */
  const visibleStreams = useMemo(() => {
    // const filtered = streams.filter(s => s.enabled && s.liveVideoId && s.status !== "offline")
    const filtered = streams.filter(s => {
      if (s.enabled) {
        return true;
      }
      if (s.enabled && s.status === "offline" && showOffline) {
        return true;
      }
      return false;
    });

    const orderIndex = (channelId: string) => {
      const index = order.indexOf(channelId)
      return index === -1 ? Number.MAX_SAFE_INTEGER : index
    }

    return filtered.sort((a, b) => {
      const orderDiff = orderIndex(a.channelId) - orderIndex(b.channelId)
      if (orderDiff !== 0) return orderDiff
      return (STATUS_PRIORITY[a.status] ?? 4) - (STATUS_PRIORITY[b.status] ?? 4)
    })
  }, [streams, order, showOffline])

  const streamMap = useMemo(
    () => new Map(visibleStreams.map(s => [s.channelId, s])),
    [visibleStreams]
  )

  const focusedStream = useMemo(
    () => streams.find(s => s.channelId === focusedId) ?? null,
    [streams, focusedId]
  )

  const canClipFocusedStream = Boolean(
    // focusedStream && focusedStream.status !== "offline" && focusedStream.liveVideoId
    focusedStream && focusedStream.liveVideoId
  )

  const renderStreams = useMemo(
    // () => streams.filter(s => s.liveVideoId && s.status !== "offline"),
    () => streams.filter(s => s.liveVideoId),
    [streams]
  )

  const rampOrder = useMemo(() => {
    const ids = visibleStreams.map(s => s.channelId)
    if (focusedId && ids.includes(focusedId)) {
      return [focusedId, ...ids.filter(id => id !== focusedId)]
    }

    return ids
  }, [visibleStreams, focusedId])

  const activePlayerIds = useMemo(
    () => rampedActivePlayerIds.filter(id => rampOrder.includes(id)),
    [rampedActivePlayerIds, rampOrder]
  )

  const activePlayerSet = useMemo(
    () => new Set(activePlayerIds),
    [activePlayerIds]
  )

  const streamPlaybackSignature = useMemo(
    () => activePlayerIds.join("|"),
    [activePlayerIds]
  )

  useEffect(() => {
    setRampedActivePlayerIds(prev => {
      const current = prev.filter(id => rampOrder.includes(id))
      if (current.length === 0 && rampOrder.length > 0) {
        return [rampOrder[0]]
      }

      if (current.length === prev.length && current.every((id, index) => id === prev[index])) {
        return prev
      }

      return current
    })
  }, [rampOrder])

  useEffect(() => {
    if (!rampOrder.length) return
    if (rampedActivePlayerIds.length >= rampOrder.length) return

    const delayMs = isMobile ? 1800 : 1000
    const timer = window.setTimeout(() => {
      setRampedActivePlayerIds(prev => {
        const current = prev.filter(id => rampOrder.includes(id))
        if (current.length >= rampOrder.length) return current

        const nextId = rampOrder.find(id => !current.includes(id))
        return nextId ? [...current, nextId] : current
      })
    }, delayMs)

    return () => window.clearTimeout(timer)
  }, [rampOrder, rampedActivePlayerIds.length, isMobile])

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
            // const playable = r.status !== "offline" && !!r.liveVideoId
            // return { ...existing, ...r, liveVideoId: playable ? r.liveVideoId : undefined, enabled: existing?.enabled ?? false }
            return { ...existing, ...r, enabled: existing?.enabled ?? false }
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

  /* ================= HASHTAG SEARCH ================= */
  async function fetchHashtagResults() {
    setHashtagLoading(true)
    try {
      const res = await fetch("/api/hashtag-search")
      const data: HashtagResult[] = await res.json()
      setHashtagResults(data)
    } catch (e) {
      console.error("Hashtag search error:", e)
    } finally {
      setHashtagLoading(false)
    }
  }

  useEffect(() => {
    fetchHashtagResults()

    const interval = setInterval(() => {
      fetchHashtagResults()
    }, 2 * 60 * 60 * 1000)

    return () => clearInterval(interval)
  }, [])

  function addHashtagStreamToCustom(result: HashtagResult) {
    setCustomStreams(prev => {
      if (prev.some(s => s.channelId === `custom-${result.videoId}`)) {
        return prev
      }

      return [
        ...prev,
        {
          name: result.channelName,
          channelId: `custom-${result.videoId}`,
          status: "live",
          liveVideoId: result.videoId,
          enabled: true,
          groups: ["Hashtag Discovery"],
        },
      ]
    })
  }

  /* ================= PLAYERS ================= */
  useEffect(() => {
    if (!ytReady) return

    streams.forEach((s: Streamer) => {
      if (!activePlayerSet.has(s.channelId)) return
      // if (!s.liveVideoId || s.status === "offline") return
      if (!s.liveVideoId) return

      const id = s.channelId
      const el = document.getElementById(`player-${id}`)
      if (!el) return

      const existingPlayer = players.current[id]
      if (existingPlayer) {
        return
      }

      players.current[id] = new window.YT.Player(el, {
        videoId: s.liveVideoId,
        playerVars: {
          autoplay: s.enabled ? 1 : 0,
          playsinline: 1,
          rel: 0,
          enablejsapi: 1,
        },
        events: {
          onReady: (e: any) => {
            e.target.mute()

            if (!s.enabled) {
              return
            }

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
            e.target.playVideo?.()
          },
        },
      })
    })
  }, [streams, activePlayerSet, focusedId, ytReady])

  function safeDestroyPlayer(id: string) {
    const player = players.current[id]
    if (!player) return

    try {
      player.destroy?.()
    } catch { }

    try {
      player.mute?.()
      player.playVideo?.()
    } catch { }

    delete players.current[id]
  }

  useEffect(() => {
    streams.forEach((s: Streamer) => {
      if (s.enabled || activePlayerSet.has(s.channelId)) return

      const player = players.current[s.channelId]
      if (!player) return

      try {
        player.mute?.()
      } catch { }
    })
  }, [streams, activePlayerSet])

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
    const validIds = new Set(streams.map(s => s.channelId));
    Object.keys(players.current).forEach(id => {
      if (!validIds.has(id)) {
        safeDestroyPlayer(id)
      }
    })
  }, [streams]);

  /* ================= CLIP BUFFER ================= */
  function pickClipMimeType() {
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ]

    for (const type of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
        return type
      }
    }

    return ""
  }

  function stopClipBuffer() {
    const recorder = clipRecorderRef.current
    clipRecorderRef.current = null
    clipFocusedIdRef.current = null
    setClipStatus(null)

    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop()
      } catch { }
    }

    const stream = clipStreamRef.current
    clipStreamRef.current = null

    if (stream) {
      stream.getTracks().forEach(track => track.stop())
    }
  }

  async function startClipBuffer() {
    if (!canClipFocusedStream || !focusedId) {
      setClipError("Select a live stream first.")
      return false
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setClipError("This browser does not support screen capture.")
      return false
    }

    if (clipRecorderRef.current?.state === "recording") {
      if (!clipFocusedIdRef.current) {
        clipFocusedIdRef.current = focusedId;
      }
      return true
    }

    try {
      setClipError(null)
      setClipStatus("Waiting for screen-share permission...")

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })

      if (!stream.getVideoTracks().length) {
        stream.getTracks().forEach(track => track.stop())
        setClipStatus(null)
        setClipError("No video track was returned.")
        return false
      }

      const mimeType = pickClipMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

      clipStreamRef.current = stream
      clipRecorderRef.current = recorder
      clipFocusedIdRef.current = focusedId
      clipMimeTypeRef.current = mimeType || "video/webm"
      clipChunksRef.current = []

      recorder.ondataavailable = event => {
        if (!event.data || event.data.size === 0) return

        const timestamp = Date.now()
        clipChunksRef.current.push({ blob: event.data, timestamp })

        const maxWindowMs = 6 * 60 * 1000
        const cutoff = timestamp - maxWindowMs
        clipChunksRef.current = clipChunksRef.current.filter(chunk => chunk.timestamp >= cutoff)
      }

      recorder.onerror = () => {
        setClipError("Recording stopped unexpectedly.")
        setClipStatus(null)
        stopClipBuffer()
      }

      stream.getVideoTracks()[0].onended = () => {
        setClipStatus(null)
        stopClipBuffer()
      }

      recorder.start(2000)
      setClipStatus("Buffering the last few minutes in your browser.")
      return true
    } catch (error: any) {
      setClipStatus(null)
      setClipError(error?.name === "NotAllowedError"
        ? "Screen capture permission was cancelled."
        : error?.message || "Unable to start clip buffering.")
      stopClipBuffer()
      return false
    }
  }

  async function saveClip() {
    if (!focusedStream || !focusedId) {
      setClipError("Select a live stream first.")
      return
    }


    if (clipRecorderRef.current?.state !== "recording") {
      const started = await startClipBuffer()
      if (!started) return
      setClipError("Buffer is still warming up. Try saving again in a few seconds.")
      return
    }

    const cutoff = Date.now() - clipLengthMinutes * 60 * 1000
    const chunks = clipChunksRef.current.filter(chunk => chunk.timestamp >= cutoff)

    if (chunks.length === 0) {
      setClipError("Not enough buffered video yet.")
      return
    }

    const mimeType = clipRecorderRef.current?.mimeType || clipMimeTypeRef.current || "video/webm"
    const blob = new Blob(chunks.map(chunk => chunk.blob), { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    const safeName = focusedStream.name.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || "clip"
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")

    a.href = url
    a.download = `${safeName}_${clipLengthMinutes}m_${stamp}.webm`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    setClipStatus(`Saved the last ${clipLengthMinutes} minute${clipLengthMinutes === 1 ? "" : "s"}.`)

    window.setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 1000)
  }

  /* ================= AUDIO CONTROL ================= */
  useEffect(() => {
    Object.entries(players.current).forEach(([id, player]) => {
      if (!player) return

      const stream = streams.find(s => s.channelId === id)
      if (!stream) return

      if (!activePlayerSet.has(id)) {
        safeApplyAudio(player, 0, true)
        return
      }

      if (!stream.enabled) {
        safeApplyAudio(player, 0, true)
        return
      }

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
  }, [streamPlaybackSignature, activePlayerSet, focusedId, audioMode, unfocusedVolume, masterVolume])

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

  useEffect(() => {
    setOrder(prev => {
      const currentIds = streams.map(s => s.channelId)
      const next = prev.filter(id => currentIds.includes(id))

      currentIds.forEach(id => {
        if (!next.includes(id)) {
          next.push(id)
        }
      })

      if (next.length === prev.length && next.every((id, index) => id === prev[index])) {
        return prev
      }

      return next
    })
  }, [streams])

  const footerGroups = useMemo(() => {
    const map = new Map<string, Streamer[]>()

    streams.forEach(s => {
      s.groups?.forEach(g => {
        const groupKey = (g === "NMC" || g === "EX") ? "NMC" : g
        if (!map.has(groupKey)) map.set(groupKey, [])
        map.get(groupKey)!.push(s)
      })
    })

    const groupOrder = ["A4A", "NMC"]
    const entries = Array.from(map.entries()).sort(([a], [b]) => {
      const aIdx = groupOrder.indexOf(a)
      const bIdx = groupOrder.indexOf(b)
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx)
    })

    return entries.map(([name, groupStreams]) => ({
      name,
      streams: groupStreams
        .filter(s => showOffline || s.status !== "offline")
        .sort((a, b) => {
          const orderDiff = (a.order ?? 9999) - (b.order ?? 9999)
          if (orderDiff !== 0) return orderDiff

          const statusDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
          if (statusDiff !== 0) return statusDiff

          const aIsEX = a.groups.includes("EX")
          const bIsEX = b.groups.includes("EX")
          if (aIsEX !== bIsEX) return aIsEX ? 1 : -1

          return a.name.localeCompare(b.name)
        }),
    }))
  }, [streams, showOffline, order])

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
    if (!focusedId) return

    const focusedStream = streams.find(s => s.channelId === focusedId)
    if (!focusedStream || !focusedStream.enabled) {
      setFocusedId(null)
    }
  }, [focusedId, streams])

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

    if (id.startsWith("custom-")) {
      setCustomStreams(updateStreams)
    }
  }

  function removeCustomStream(id: string) {
    const filterStreams = (streams: Streamer[]) =>
      streams.filter(s => s.channelId !== id)
    setCustomStreams(filterStreams)
    setStreams(filterStreams)

    safeDestroyPlayer(id)

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

  //TUTORIAL/GUIDE
  const tutorialSteps = useMemo(() => {
    const desktopTutorialSteps: TutorialStep[] = [
      {
        target: ".theme-btn",
        title: "Theme switch",
        text: "Switch between Dark and Light themes",
        placement: "bottom-left"
      },
      {
        target: ".stream-input-combo",
        title: "Custom Youtube link",
        text: "Paste a YouTube livestream or video link here. It will be added to the list of dropdown above.",
        placement: "bottom-left",
      },
      {
        target: ".hashtag-btn",
        title: "Hashtag imeroleplay",
        text: "Find livestreams using the #imeroleplay hashtag.",
        placement: "bottom-left",
      },
      {
        target: ".theater-btn",
        title: "Layout mode",
        text: "Switch between Default mode and Theater mode. Theater mode enlarges one stream into a widescreen view.",
        placement: "bottom-left",
      },
      {
        target: ".volume-group",
        title: "Master volume",
        text: "Adjust the volume of all active streams at the same time.",
        placement: "bottom-right",
      },
      {
        target: ".offline-toggle",
        title: "Show offline streamers",
        text: "Show or hide offline streamers in the streamer list footer.",
        placement: "bottom-right",
      },
      {
        target: ".chat-btn",
        title: "Live chat",
        text: "Open the chat for the selected stream. Available when one stream is selected, or with up to four streams in Default mode.",
        placement: "bottom-right",
      },
      {
        target: ".group-streams",
        title: "Streamer toggle buttons",
        text: "Enable or disable streamers here.",
        offsetY: 55,
        placement: "top-left",
      },
      {
        target: ".stream-label.active",
        title: "Focus a source",
        text: "Select a source name label to hear only their audio. You can leave focus mode or save a clip at any time.",
        placement: "top-left",
        offsetY: -5,
        beforeShow: () => {
          if (focusedId) return;

          const first = streams.find(s => s.enabled) ?? streams[0];

          if (!first) return;

          if (!first.enabled) {
            setStreams(prev =>
              prev.map(s => ({
                ...s,
                enabled: s.channelId === first.channelId,
              }))
            );
          }

          setFocusedId(first.channelId);
        }
      },
      {
        target: ".audio-focus-controls",
        title: "Audio focus controls",
        text: "Adjust how other streams sound while one streamer is focused.",
        placement: "bottom-right",
      },
      {
        target: ".clip-toggle",
        title: "Clip recorder",
        text: "Open the clip recorder to capture highlights from a stream.",
        placement: "bottom-right",
      },
      {
        target: ".clip-record",
        title: "Start recording",
        text: "Begin buffering the selected stream. Recording continues even after closing this menu.",
        placement: "left",
        beforeShow: setClipMenuOpen.bind(null, true),
      },

      {
        target: ".clip-length",
        title: "Clip length",
        text: "Choose how much buffered video to include in the saved clip.",
        placement: "left",
      },

      {
        target: ".clip-save",
        title: "Save clip",
        text: "Download the most recent buffered video using the selected clip length.",
        placement: "left",
      },
    ]
    if (viewport.w <= 900) {
      const mobileTutorialSteps: TutorialStep[] = [
        {
          target: ".theme-btn",
          title: "Theme switch",
          text: "Switch between Dark and Light themes",
          placement: "bottom-left"
        },
        {
          target: ".stream-input-combo",
          title: "Custom Youtube link",
          text: "Paste a YouTube livestream or video link here. It will be added to the list of dropdown above.",
          placement: "bottom-left",
        },
        {
          target: ".mobile-menu-button",
          title: "Main Menu",
          text: "Tap here to open the mobile controls.",
          placement: "bottom",
        },
        {
          target: ".chat-btn",
          title: "Live chat",
          text: "Open the chat for the selected stream. Available when one stream is selected, or with up to four streams in Default mode.",
          placement: "bottom-right",
        },
        {
          target: ".mobile-menu",
          title: "Mobile Menu",
          text: "Most controls are grouped inside this menu on smaller screens.",
          placement: "top",
          beforeShow: () => setMobileMenuOpen(true),
        },
        {
          target: ".volume-group-mobile",
          title: "Master volume",
          text: "Adjust the volume of all active streams at the same time.",
          placement: "bottom-right",
        },
        {
          target: ".hashtag-btn-mobile",
          title: "Hashtag imeroleplay",
          text: "Find livestreams using the #imeroleplay hashtag.",
          placement: "bottom-left",
        },
        {
          target: ".offline-toggle-mobile",
          title: "Show offline streamers",
          text: "Show or hide offline streamers in the streamer list footer.",
          placement: "bottom-right",
        },
        {
          target: ".group-streams",
          title: "Streamer toggle buttons",
          text: "Enable or disable streamers here.",
          offsetY: 55,
          placement: "top-left",
        },
        {
          target: ".stream-label.active",
          title: "Focus a source",
          text: "Select a source name label to hear only their audio. You can leave focus mode or save a clip at any time.",
          placement: "top-left",
          offsetY: -5,
          beforeShow: () => {
            if (focusedId) return;

            const first = streams.find(s => s.enabled) ?? streams[0];

            if (!first) return;

            if (!first.enabled) {
              setStreams(prev =>
                prev.map(s => ({
                  ...s,
                  enabled: s.channelId === first.channelId,
                }))
              );
            }

            setFocusedId(first.channelId);
          }
        },
        {
          target: ".audio-focus-controls-mobile",
          title: "Audio focus controls",
          text: "Adjust how other streams sound while one streamer is focused.",
          placement: "bottom-right",
          beforeShow: () => setMobileMenuOpen(true),
        },
      ];

      if (viewport.w < 500) {
        mobileTutorialSteps.splice(1, 1, {
          target: ".mobile-menu-button",
          title: "Main Menu",
          text: "Tap here to open the mobile controls.",
          placement: "bottom",
        });
        mobileTutorialSteps.splice(2, 1, {
          target: ".chat-btn",
          title: "Live chat",
          text: "Open the chat for the selected stream. Available when one stream is selected, or with up to four streams in Default mode.",
          placement: "bottom-right",
        });
        mobileTutorialSteps.splice(3, 1, {
          target: ".mobile-menu",
          title: "Mobile Menu",
          text: "Most controls are grouped inside this menu on smaller screens.",
          placement: "top",
          beforeShow: () => setMobileMenuOpen(true),
        });
        mobileTutorialSteps.splice(4, 1, {
          target: ".stream-input-combo",
          title: "Custom Youtube link",
          text: "Paste a YouTube livestream or video link here. It will be added to the list of dropdown above.",
          placement: "top",
          beforeShow: () => setMobileMenuOpen(true),
        });
        mobileTutorialSteps.splice(9, 1, {
          target: ".stream-label.active",
          title: "Focus a source",
          text: "Select a source name label to hear only their audio. You can leave focus mode or save a clip at any time.",
          placement: "top-left",
          offsetY: -5,
          beforeShow: () => {
            setMobileMenuOpen(false)
            if (focusedId) return;

            const first = streams.find(s => s.enabled) ?? streams[0];

            if (!first) return;

            if (!first.enabled) {
              setStreams(prev =>
                prev.map(s => ({
                  ...s,
                  enabled: s.channelId === first.channelId,
                }))
              );
            }

            setFocusedId(first.channelId);
          }
        });
      }

      return mobileTutorialSteps;
    }

    return desktopTutorialSteps;
  }, [viewport.w, streams, focusedId]);

  const closeTutorial = () => {
    setTutorialOpen(false);
    setStep(0);
  };

  const next = () => {
    if (step === tutorialSteps.length - 1) {
      closeTutorial();
    } else {
      setStep(step + 1);
    }
  };

  function TutorialOverlay({
    step,
  }: {
    step: TutorialStep;
  }) {
    const [rect, setRect] = useState<DOMRect | null>(null);

    useEffect(() => {
      step.beforeShow?.();

      const updatePosition = () => {
        const element = document.querySelector(step.target);

        if (!element) {
          setRect(null);
          return;
        }

        element.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });

        setRect(element.getBoundingClientRect());
      };

      const waitForTarget = () => {
        const element = document.querySelector(step.target);

        if (element) {
          updatePosition();
        } else {
          requestAnimationFrame(waitForTarget);
        }
      };

      requestAnimationFrame(waitForTarget);

      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);

      return () => {
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
      };
    }, [step.target]);

    if (!rect) return null;


    const BOX_WIDTH = boxRef.current?.offsetWidth ?? 320;
    const BOX_HEIGHT = boxRef.current?.offsetHeight ?? 180;
    const GAP = 18;
    const PAD = 12;

    const isMobile = window.innerWidth < 768;

    let left = rect.left + (isMobile ? 100 : 0);
    let top = rect.bottom + GAP + (isMobile ? 100 : 0);

    if (!isMobile) {
      switch (step.placement) {

        case "top":
          left = rect.left + rect.width / 2 - BOX_WIDTH / 2;
          top = rect.top - BOX_HEIGHT - GAP;
          break;

        case "top-left":
          left = rect.left;
          top = rect.top - BOX_HEIGHT - GAP;
          break;

        case "top-right":
          left = rect.right - BOX_WIDTH;
          top = rect.top - BOX_HEIGHT - GAP;
          break;

        case "bottom":
          left = rect.left + rect.width / 2 - BOX_WIDTH / 2;
          top = rect.bottom + GAP;
          break;

        case "bottom-left":
          left = rect.left;
          top = rect.bottom + GAP;
          break;

        case "bottom-right":
          left = rect.right - BOX_WIDTH;
          top = rect.bottom + GAP;
          break;

        case "left":
          left = rect.left - BOX_WIDTH - GAP;
          top = rect.top + rect.height / 2 - BOX_HEIGHT / 2;
          break;

        case "right":
          left = rect.right + GAP;
          top = rect.top + rect.height / 2 - BOX_HEIGHT / 2;
          break;
      }

      left += step.offsetX ?? 0;
      top += step.offsetY ?? 0;

      left = Math.max(
        PAD,
        Math.min(left, window.innerWidth - BOX_WIDTH - PAD)
      );

      top = Math.max(
        PAD,
        Math.min(top, window.innerHeight - BOX_HEIGHT - PAD)
      );
    } else {
      left = PAD;
      top = window.innerHeight - BOX_HEIGHT - PAD - 100;
    }

    return (
      <>
        <div
          className="tutorial-highlight"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />

        <div
          ref={boxRef}
          className="tutorial-box"
          style={{
            left,
            top,
          }}
        >
          <h3>{step.title}</h3>
          <hr />
          <p>{step.text}</p>
          <br></br>
          <small>Click anywhere to continue</small>
        </div>
      </>
    );
  }

  /* ================= LOAD CACHE ================= */
  useEffect(() => {
    if (!focusedId) return

    setStreams(prev => {
      return prev.map(s =>
        s.channelId === focusedId && !s.enabled
          ? { ...s, enabled: true }
          : s
      )
    })
  }, [focusedId])

  useEffect(() => {
    if (!focusedId) {
      if (clipRecorderRef.current) {
        stopClipBuffer()
      }
      setClipMenuOpen(false)
      return
    }

    if (!focusedStream || focusedStream.status === "offline" || !focusedStream.liveVideoId) {
      if (clipRecorderRef.current) {
        stopClipBuffer()
      }
      setClipMenuOpen(false)
      return
    }

    // if (clipFocusedIdRef.current && clipFocusedIdRef.current !== focusedId) {
    //   stopClipBuffer()
    //   setClipMenuOpen(false)
    // }
  }, [focusedId, focusedStream])

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
            />&nbsp;
            <h1>{isMobile ? "Nakama YTM" : "Nakama Youtube MultiView"}</h1>
            <span className="tooltip">
              Created by hxnmi for nakama #NFFN
            </span>
          </div>
          <span className="live-count">
            {isVerySmall ? (
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
            className="ui-btn theme-btn"
            onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "🌙 Dark" : "🌞 Light"}
          </button>
          {!isSmall && (
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
          <button
            className="ui-btn hashtag-btn"
            onClick={() => setShowHashtagPanel(prev => !prev)}
            title="Discover streams with #imeroleplay"
          >
            <span aria-hidden="true">🔍</span>
            <span className="hashtag-btn-text"> #imeroleplay</span>
          </button>
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
              className="ui-btn theater-btn"
              style={{ display: "flex", alignItems: "center", gap: 8 }}
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
              className={`ui-btn ${showOffline ? 'enabled' : 'disabled'} offline-toggle`}
              style={{ background: showOffline ? '#e11d48' : 'var(--panel-2)', border: 'none', color: 'var(--text)', cursor: 'pointer' }}
            >
              {showOffline ? "Hide Offline" : "Show Offline"}
            </button>
          </div>
          <button
            className="ui-btn chat-btn"
            onClick={() => setShowChat(v => !v)}
            disabled={visibleStreams.length === 0}
          >
            💬 Chat
          </button>
          {!isMobile && canClipFocusedStream && (
            <div className="clip-control">
              <button
                className={`ui-btn clip-toggle ${clipRecorderRef.current?.state === "recording" ? "enabled" : ""}`}
                onClick={() => {
                  setClipMenuOpen(prev => !prev)
                }}
                title="Clip the focused live stream"
              >
                ✂ Clip
              </button>

              {clipMenuOpen && (
                <div className="clip-popover" role="dialog" aria-label="Clip focused stream">
                  <button
                    className={`ui-btn clip-record ${clipRecorderRef.current?.state === "recording" ? "recording" : ""
                      }`}
                    onClick={() => {
                      if (clipRecorderRef.current?.state === "recording") {
                        stopClipBuffer();
                      } else {
                        startClipBuffer();
                      }
                    }}
                  >
                    {clipRecorderRef.current?.state === "recording"
                      ? "⏹ Stop Recording"
                      : "⏺ Record"}
                  </button>
                  <label>
                    Length
                    <select className="clip-length"
                      value={clipLengthMinutes}
                      onChange={(e) => setClipLengthMinutes(Number(e.target.value))}
                    >
                      {[1, 2, 3, 4, 5].map(minute => (
                        <option key={minute} value={minute}>
                          {minute} minute{minute === 1 ? "" : "s"}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    className="ui-btn clip-save"
                    disabled={clipRecorderRef.current?.state !== "recording"}
                    onClick={saveClip}
                  >
                    Save clip
                  </button>

                  <div className="clip-hint">
                    {
                      clipRecorderRef.current?.state === "recording"
                        ? clipStatus
                        : "Press Record to begin buffering."
                    }
                  </div>

                  {clipError && <div className="clip-error">{clipError}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="mobile-menu" role="dialog" aria-modal="true">
          <div className="mobile-menu-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <strong>Menu</strong>
          </div>
          <hr />
          <div className="mobile-menu-content" style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {isSmall && (
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
            <div className="volume-group-mobile">
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

            <div className="audio-focus-controls-mobile">
              <label style={{ display: 'flex', marginBottom: 6, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', flexDirection: 'row' }}>Audio behavior
                <select value={audioMode} onChange={(e) => setAudioMode(e.target.value as any)}>
                  <option value="mute">Mute others</option>
                  <option value="reduce">Reduce others</option>
                </select>
              </label>
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
              <button
                onClick={() => {
                  setShowHashtagPanel(prev => !prev)
                  setMobileMenuOpen(false)
                }}
                className="ui-btn hashtag-btn-mobile"
              >
                🔍 #imeroleplay
              </button>
              <button onClick={() => { setShowOffline(prev => !prev); setMobileMenuOpen(false); }} className={`ui-btn ${showOffline ? 'enabled' : 'disabled'} offline-toggle-mobile`} style={{ flex: 1 }}>
                {showOffline ? "Hide Offline" : "Show Offline"}
              </button>
            </div>
          </div>
        </div>
      )
      }

      <div className="content">
        {showHashtagPanel && (
          <aside className="hashtag-panel">
            <div className="hashtag-panel-header">
              <strong>🔍 #imeroleplay</strong>
              <button
                className="hashtag-panel-close"
                onClick={() => setShowHashtagPanel(false)}
              >
                ✕
              </button>
            </div>

            <div className="hashtag-panel-content">
              {hashtagLoading ? (
                <div className="hashtag-panel-loading">
                  Loading...
                </div>
              ) : hashtagResults.length === 0 ? (
                <div className="hashtag-panel-empty">
                  No results found
                </div>
              ) : (
                hashtagResults.map(result => (
                  <button
                    key={result.videoId}
                    className="hashtag-panel-item"
                    onClick={() => addHashtagStreamToCustom(result)}
                  >
                    {result.thumbnailUrl && (
                      <img
                        src={result.thumbnailUrl}
                        alt={result.title}
                      />
                    )}
                    <div>
                      <div className="hashtag-panel-item-title">
                        {result.title.length > 50 ? result.title.substring(0, 50) + "..." : result.title}
                      </div>
                      <div className="hashtag-panel-item-channel">
                        {result.channelName}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>
        )}
        <main
          className="canvas"
          style={{
            gridTemplateColumns,
            gridTemplateRows,
            marginLeft: showHashtagPanel ? 280 : 0,
            transition: "margin-left 0.3s",
          }}
        >
          {renderStreams.map(s => {
            const cell = positions.get(`video-${s.channelId}`)
            const isFocused = s.channelId === focusedId
            const isActive = activePlayerSet.has(s.channelId)
            return (
              <div
                key={s.channelId}
                className={`stream-card ${isFocused ? "focused" : ""} ${s.enabled ? "" : "hidden"}`}
                style={layout.mode === "theater" && cell ? getGridStyle(cell) : getGridStyle(cell)}
              >
                <div className="video-wrap">
                  <div style={{ opacity: isActive ? 1 : 0, pointerEvents: isActive ? "auto" : "none" }}>
                    <PlayerHost channelId={s.channelId} />
                  </div>
                  {!isActive && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "grid",
                        placeItems: "center",
                        background: "rgba(0,0,0,0.55)",
                        color: "var(--muted)",
                        fontSize: 12,
                        textAlign: "center",
                        padding: 12,
                      }}
                    >
                      Loading...
                    </div>
                  )}
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
                if (!activePlayerSet.has(s.channelId)) {
                  return <div key={`chat-placeholder-${cell.channelId}`} className="chat-card" style={getGridStyle(pos)} />
                }
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
                      {sA && activePlayerSet.has(sA.channelId) ? (
                        <iframe
                          src={buildChatUrl(sA.liveVideoId!)}
                          title={`chat-${sA.channelId}`}
                          allow="autoplay"
                        />
                      ) : null}
                    </div>

                    <div className="chat-card" aria-hidden={!sB}>
                      {sB && activePlayerSet.has(sB.channelId) ? (
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
      <div className="toolbar">
        {tutorialOpen && (
          <div className="tutorial-overlay" onClick={next}>
            <TutorialOverlay
              step={tutorialSteps[step]}
            />
          </div>
        )}
        <button
          className="ui-btn tutorial-btn"
          onClick={() => {
            setTutorialOpen(true);
            setStep(0);
          }}
        >
          ⓘ how to use
        </button>
        <button
          className="ui-btn cls-btn"
          onClick={() => {
            setStreams(prev => prev.map(s => ({ ...s, enabled: false })));
            setCustomStreams(prev => prev.map(s => ({ ...s, enabled: false })));
            setFocusedId(null);
            setRampedActivePlayerIds([]);
          }}
        >
          CLS
        </button>
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
                    // if (s.status === "offline") return
                    const nextEnabled = !s.enabled;
                    setStreams(prev => prev.map(p => p.channelId === s.channelId ? { ...p, enabled: nextEnabled } : p));
                    if (s.channelId.startsWith("custom-")) {
                      setCustomStreams(prev => prev.map(p => p.channelId === s.channelId ? { ...p, enabled: nextEnabled } : p));
                    }
                    if (nextEnabled) {
                      setRampedActivePlayerIds(prev => [
                        s.channelId,
                        ...prev.filter(id => id !== s.channelId),
                      ]);
                    } else {
                      const player = players.current[s.channelId];

                      if (player) {
                        try {
                          player.mute?.();
                          player.playVideo?.();
                        } catch { }
                      }
                    }
                    if (focusedId === s.channelId) {
                      setFocusedId(null);
                    }
                    requestAnimationFrame(() => {
                      const player = players.current[s.channelId];
                      if (!player) return;
                      if (nextEnabled) {
                        try { player.unMute?.(); player.setVolume?.(audioValues.current.masterVolume); } catch { }
                      } else {
                        try { player.mute?.(); } catch { }
                      }
                    });
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

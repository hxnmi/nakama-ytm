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

  /* 🔒 ABSOLUTE RULE:
     must be live AND have liveVideoId */
  const liveStreams = streams.filter(
    s => s.isLive && !!s.liveVideoId
  )

  const visibleStreams = liveStreams
    .filter(s => s.enabled)
    .slice(0, 12) // max 12, hard stop

  /* ================= LOAD CACHE ================= */
  useEffect(() => {
    const saved = localStorage.getItem("streamToggles")
    if (saved) {
      try {
        setStreams(JSON.parse(saved))
      } catch { }
    }
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
  useEffect(() => {
    if (!visibleStreams.length) return

    if (!window.YT || !window.YT.Player) {
      const tag = document.createElement("script")
      tag.src = "https://www.youtube.com/iframe_api"
      document.body.appendChild(tag)

      window.onYouTubeIframeAPIReady = () => initPlayers()
      return
    }

    initPlayers()

    function initPlayers() {
      visibleStreams.forEach((s, i) => {
        const id = `player-${i}`

        if (players.current[i]) return

        players.current[i] = new window.YT.Player(id, {
          videoId: s.liveVideoId,
        })
      })
    }
  }, [visibleStreams.map(s => s.liveVideoId).join(",")])


  /* ================= SAVE STATE ================= */
  useEffect(() => {
    localStorage.setItem("streamToggles", JSON.stringify(streams))
  }, [streams])

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

      <main className={`grid grid-${visibleStreams.length}`}>
        {visibleStreams.map((s, i) => (
          <div key={s.channelId} className="card">
            <div className="player">
              <div id={`player-${i}`} />
            </div>
            <span className="label">{s.name}</span>
          </div>
        ))}
      </main>

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
    </div>
  )
}

const GROUPS = {
  A4A: ["yb", "Tepe46", "Tierison", "bang mister aloy", "ibot13", "youKtheo", "Garry Ang", "Bravyson Vconk", "Niko Junius", "GURAISU", "Michelle Christo", "Jessica Prashela", "Derisky Prisadevano", "Juan Herman"],
  NMC: ["Papuy", "ELJAWZ", "MIRJAAA", "Danny", "Sipije", "a bee gel", "zota frz", "Anjasmara7", "Lezype", "Lise Zhang", "Dobori Tensha VT", "Gray Wellington", "Moonears", "Idinzzz", "PaddanG", "tasya", "Sam Wani", "LokiTheHuman"],
}
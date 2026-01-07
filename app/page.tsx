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

    // 🔥 FULL RESET — NO BLACK SCREENS
    players.current.forEach(p => p?.destroy?.())
    players.current = []

    const init = () => {
      visibleStreams.forEach((s, i) => {
        players.current[i] = new window.YT.Player(
          `player-${s.channelId}`,
          {
            videoId: s.liveVideoId,
            playerVars: {
              autoplay: 1,
              playsinline: 1,
            },
          }
        )
      })
    }

    if (window.YT && window.YT.Player) {
      setTimeout(init, 0) // 🔑 DOM SAFE
    } else {
      const tag = document.createElement("script")
      tag.src = "https://www.youtube.com/iframe_api"
      document.body.appendChild(tag)
      window.onYouTubeIframeAPIReady = () => setTimeout(init, 0)
    }

    return () => {
      players.current.forEach(p => p?.destroy?.())
      players.current = []
    }
  }, [visibleStreams.map(s => s.channelId).join(",")])



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
        {order
          .map(id => visibleStreams.find(s => s.channelId === id))
          .filter((s): s is Streamer => Boolean(s))
          .map(s => (
            <div
              key={s.channelId}
              className="card"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("id", s.channelId)
              }}
              onDragOver={(e) => {
                e.preventDefault()
              }}
              onDrop={(e) => {
                const from = e.dataTransfer.getData("id")
                const to = s.channelId
                if (from === to) return

                setOrder(prev => {
                  const next = [...prev]
                  const fromIdx = next.indexOf(from)
                  const toIdx = next.indexOf(to)
                  next.splice(fromIdx, 1)
                  next.splice(toIdx, 0, from)
                  return next
                })
              }}
            >
              <div className="player">
                <div id={`player-${s.channelId}`} />
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
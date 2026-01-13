"use client"

import { useEffect, useState } from "react"
import "./admin.css"

type StreamerConfig = {
    name: string
    channelId: string
    groups: string[]
    enabled: boolean
}

type Config = {
    groups: string[]
    streamers: StreamerConfig[]
}

export default function AdminPage() {
    const [token, setToken] = useState<string | null>(null)
    const [config, setConfig] = useState<Config | null>(null)

    const [name, setName] = useState("")
    const [channelId, setChannelId] = useState("")

    /* ================= LOAD CONFIG ================= */
    useEffect(() => {
        if (!token) return

        fetch("/api/streamers", {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(r => {
                if (!r.ok) throw new Error("unauthorized")
                return r.json()
            })
            .then(setConfig)
            .catch(() => {
                alert("Invalid admin token")
                setToken(null)
                setConfig(null)
            })
    }, [token])

    /* ================= HELPERS ================= */

    function updateStreamer(
        channelId: string,
        patch: Partial<StreamerConfig>
    ) {
        if (!config) return

        const next = {
            ...config,
            streamers: config.streamers.map(s =>
                s.channelId === channelId ? { ...s, ...patch } : s
            ),
        }

        setConfig(next)

        const updated = next.streamers.find(s => s.channelId === channelId)!
        save(updated)
    }

    async function save(streamer: StreamerConfig) {
        await fetch("/api/streamers", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(streamer),
        })
    }

    async function del(channelId: string) {
        if (!confirm("Delete this streamer?")) return

        await fetch("/api/streamers", {
            method: "DELETE",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ channelId }),
        })

        setConfig(c =>
            c
                ? { ...c, streamers: c.streamers.filter(s => s.channelId !== channelId) }
                : c
        )
    }

    async function add() {
        if (!name || !channelId || !config) return

        const streamer: StreamerConfig = {
            name,
            channelId,
            groups: [config.groups[0]],
            enabled: true,
        }

        await save(streamer)

        setConfig({
            ...config,
            streamers: [...config.streamers, streamer],
        })

        setName("")
        setChannelId("")
    }

    /* ================= TOKEN GATE ================= */
    if (!token) {
        return (
            <div className="admin-login">
                <input
                    type="password"
                    placeholder="Admin token"
                    onKeyDown={e => {
                        if (e.key === "Enter") {
                            setToken(e.currentTarget.value)
                        }
                    }}
                />
            </div>
        )
    }

    if (!config) {
        return <div className="admin-loading">Loading…</div>
    }

    /* ================= UI ================= */
    return (
        <div className="admin">
            <h1>Admin – Streamers</h1>

            <div className="admin-add">
                <input
                    placeholder="Name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                />
                <input
                    placeholder="Channel ID"
                    value={channelId}
                    onChange={e => setChannelId(e.target.value)}
                />
                <button onClick={add}>Add</button>
            </div>

            <div className="admin-list">
                {config.streamers.map(s => (
                    <div key={s.channelId} className="admin-row">
                        <div className="admin-main">
                            <input
                                value={s.name}
                                onChange={e =>
                                    updateStreamer(s.channelId, { name: e.target.value })
                                }
                            />
                            <input value={s.channelId} disabled />
                        </div>

                        <div className="admin-groups">
                            {config.groups.map(g => (
                                <label key={g} className="group-option">
                                    <input
                                        type="radio"
                                        name={`group-${s.channelId}`}
                                        checked={s.groups[0] === g}
                                        onChange={() =>
                                            updateStreamer(s.channelId, { groups: [g] })
                                        }
                                    />
                                    <span>{g}</span>
                                </label>
                            ))}
                        </div>

                        <div className="admin-actions">
                            <label className="toggle">
                                <input
                                    type="checkbox"
                                    checked={s.enabled}
                                    onChange={e =>
                                        updateStreamer(s.channelId, { enabled: e.target.checked })
                                    }
                                />
                                <span />
                            </label>

                            <button className="delete" onClick={() => del(s.channelId)}>
                                Delete
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

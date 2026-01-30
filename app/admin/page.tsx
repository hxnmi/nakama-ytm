"use client"

import { useEffect, useState } from "react"
import "./admin.css"

type StreamerConfig = {
    name: string
    channelId: string
    groups: string[]
    enabled: boolean
    order?: number
}

type Config = {
    groups: string[]
    streamers: StreamerConfig[]
}

export default function AdminPage() {
    const [token, setToken] = useState<string | null>(null)
    const [config, setConfig] = useState<Config | null>(null)

    const [group, setGroup] = useState<string>("")
    const [channelId, setChannelId] = useState("")

    const [search, setSearch] = useState("")
    const [sort, setSort] = useState<"order" | "az" | "za" | "group">("order")
    const [dragging, setDragging] = useState<string | null>(null)

    const [isSmall, setIsVerySmall] = useState(false);

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
        if (!channelId || !group || !config) return
        const maxOrder = Math.max(
            0,
            ...config.streamers.map(s => s.order ?? 0)
        )

        await fetch("/api/streamers", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                channelId,
                groups: [group],
                enabled: true,
                order: maxOrder + 1,
            }),
        })

        const res = await fetch("/api/streamers", {
            headers: { Authorization: `Bearer ${token}` },
        })

        const fresh = await res.json()
        setConfig(fresh)

        setChannelId("")
        setGroup("")
    }

    function getVisibleStreamers() {
        if (!config) return []

        let list = [...config.streamers]

        if (search) {
            const q = search.toLowerCase()
            list = list.filter(
                s =>
                    s.name.toLowerCase().includes(q) ||
                    s.channelId.toLowerCase().includes(q)
            )
        }

        switch (sort) {
            case "az":
                list.sort((a, b) => a.name.localeCompare(b.name))
                break
            case "za":
                list.sort((a, b) => b.name.localeCompare(a.name))
                break
            case "group":
                list.sort((a, b) =>
                    (a.groups[0] ?? "").localeCompare(b.groups[0] ?? "")
                )
                break
            case "order":
            default:
                list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        }

        return list
    }

    function onDragStart(channelId: string) {
        setDragging(channelId)
    }

    async function onDrop(targetId: string) {
        if (!config || !dragging || dragging === targetId) return

        const list = [...config.streamers].sort(
            (a, b) => (a.order ?? 0) - (b.order ?? 0)
        )

        const from = list.findIndex(s => s.channelId === dragging)
        const to = list.findIndex(s => s.channelId === targetId)
        if (from < 0 || to < 0) return

        const moved = list.splice(from, 1)[0]
        list.splice(to, 0, moved)

        const next = list.map((s, i) => ({ ...s, order: i }))

        setConfig({ ...config, streamers: next })

        await Promise.all(next.map(async (s) => {
            try {
                await save(s)
            } catch (err) {
                console.error(`Failed to save order for ${s.channelId}:`, err)
            }
        }))

        setDragging(null)
    }

    useEffect(() => {
        const check = () => setIsVerySmall(window.innerWidth < 450);
        check();
        window.addEventListener("resize", check);
        return () => window.removeEventListener("resize", check);
    }, []);

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

            <div className="admin-add" style={{
                flexWrap: isSmall ? "wrap" : "nowrap",
            }}
            >
                <input
                    placeholder="YouTube Channel ID"
                    value={channelId}
                    onChange={e => setChannelId(e.target.value)}
                />

                <div className="admin-groups">
                    {config.groups.map(g => (
                        <label key={g} className="group-option">
                            <input
                                type="radio"
                                name="new-group"
                                checked={group === g}
                                onChange={() => setGroup(g)}
                            />
                            <span>{g}</span>
                        </label>
                    ))}
                </div>

                <button onClick={add}>Add</button>
            </div>

            <div className="admin-toolbar" style={{
                flexWrap: isSmall ? "wrap" : "nowrap",
            }}
            >
                <input
                    placeholder="Search name or channel ID…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />

                <select value={sort} onChange={e => setSort(e.target.value as any)}>
                    <option value="order">Manual order</option>
                    <option value="az">Name A–Z</option>
                    <option value="za">Name Z–A</option>
                    <option value="group">Group</option>
                </select>
            </div>
            {sort !== "order" && (
                <div className="admin-hint">
                    Sorting is active — switch to <b>Manual order</b> to drag
                </div>
            )}
            <div className="admin-list">
                {getVisibleStreamers().map(s => (
                    <div
                        key={s.channelId}
                        className="admin-row"
                        draggable={sort === "order"}
                        onDragStart={() => onDragStart(s.channelId)}
                        onDragOver={e => sort === "order" && e.preventDefault()}
                        onDrop={() => onDrop(s.channelId)}
                    >
                        <div
                            className="admin-main"
                            style={{
                                flexWrap: isSmall ? "wrap" : "nowrap",
                            }}
                        >
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

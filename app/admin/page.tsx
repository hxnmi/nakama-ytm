"use client"

import { useEffect, useRef, useState } from "react"
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
    const [sort, setSort] = useState<"az" | "za" | "group">("group")
    const [orderInputs, setOrderInputs] = useState<Record<string, string>>({})

    const [isSmall, setIsVerySmall] = useState(false);
    const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

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
            .then(data => {
                setConfig(data)
            })
            .catch(() => {
                alert("Invalid admin token")
                setToken(null)
                setConfig(null)
            })
    }, [token])

    /* ================= HELPERS ================= */

    function scheduleSave(streamer: StreamerConfig, delayMs = 450) {
        const existingTimer = saveTimers.current[streamer.channelId]
        if (existingTimer) {
            clearTimeout(existingTimer)
        }

        saveTimers.current[streamer.channelId] = setTimeout(() => {
            void save(streamer)
            delete saveTimers.current[streamer.channelId]
        }, delayMs)
    }

    function updateStreamer(
        channelId: string,
        patch: Partial<StreamerConfig>
    ) {
        if (!config) return

        const oldStreamer = config.streamers.find(
            s => s.channelId === channelId
        )!

        let streamers = config.streamers.map(s =>
            s.channelId === channelId
                ? { ...s, ...patch }
                : s
        )

        if (patch.groups) {
            const affected = [
                oldStreamer.groups[0],
                patch.groups[0],
            ]

            affected.forEach(group => {
                const list = streamers
                    .filter(s => s.groups[0] === group)
                    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999))

                streamers = streamers.map(s => {
                    if (s.groups[0] !== group) return s

                    const index = list.findIndex(x => x.channelId === s.channelId)

                    return index === -1
                        ? s
                        : { ...s, order: index + 1 }
                })
            })
        }

        setConfig({ ...config, streamers })

        const updated = streamers.find(
            s => s.channelId === channelId
        )!
        if (typeof patch.name === "string") {
            scheduleSave(updated)
            return
        }

        void save(updated)
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

    async function saveMany(updates: Array<Partial<StreamerConfig> & { channelId: string }>) {
        if (!updates.length) return

        await fetch("/api/streamers", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ updates }),
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
            ...config.streamers
                .filter(s => s.groups[0] === group)
                .map(s => s.order ?? 0)
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
            default:
                {
                    const groupOrder = ["A4A", "NMC", "EX"]

                    list.sort((a, b) => {
                        const ga = groupOrder.indexOf(a.groups[0] ?? "")
                        const gb = groupOrder.indexOf(b.groups[0] ?? "")

                        if (ga !== gb) return ga - gb

                        return (a.order ?? 9999) - (b.order ?? 9999)
                    })

                    break
                }
        }

        return list
    }

    async function changeOrder(channelId: string, newOrder: number) {
        if (!config) return;

        const streamer = config.streamers.find(
            s => s.channelId === channelId
        );

        if (!streamer) return;

        const group = streamer.groups[0];

        const groupStreamers = config.streamers
            .filter(s => s.groups[0] === group)
            .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));

        const originalGroup = groupStreamers.map(s => ({
            channelId: s.channelId,
            order: s.order,
        }))

        const others = config.streamers.filter(
            s => s.groups[0] !== group
        );

        const currentIndex = groupStreamers.findIndex(
            s => s.channelId === channelId
        );

        const moving = groupStreamers.splice(currentIndex, 1)[0];

        const targetIndex = Math.max(
            0,
            Math.min(newOrder - 1, groupStreamers.length)
        );

        groupStreamers.splice(targetIndex, 0, moving);

        const reorderedGroup = groupStreamers.map((s, i) => ({
            ...s,
            order: i + 1,
        }));

        setConfig(cfg => {
            if (!cfg) return cfg

            return {
                ...cfg,
                streamers: [...others, ...reorderedGroup],
            }
        })

        const updates = reorderedGroup
            .filter(s => {
                const old = originalGroup.find(o => o.channelId === s.channelId)
                return old?.order !== s.order
            })
            .map(s => ({
                channelId: s.channelId,
                order: s.order,
            }))

        console.log({
            originalGroup,
            reorderedGroup,
            updates
        })

        await saveMany(updates)
    }

    async function changeGroup(channelId: string, newGroup: string) {
        if (!config) return

        const streamer = config.streamers.find(
            s => s.channelId === channelId
        )

        if (!streamer) return

        const oldGroup = streamer.groups[0]

        if (oldGroup === newGroup) return

        const oldList = config.streamers
            .filter(s => s.groups[0] === oldGroup && s.channelId !== channelId)
            .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999))
            .map((s, i) => ({
                ...s,
                order: i + 1,
            }))

        const newList = config.streamers
            .filter(s => s.groups[0] === newGroup)
            .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999))

        const moved = {
            ...streamer,
            groups: [newGroup],
            order: newList.length + 1,
        }

        const reorderedNewList = [...newList, moved].map((s, i) => ({
            ...s,
            order: i + 1,
        }))

        const next = {
            ...config,
            streamers: [
                ...config.streamers.filter(
                    s =>
                        s.groups[0] !== oldGroup &&
                        s.groups[0] !== newGroup &&
                        s.channelId !== channelId
                ),
                ...oldList,
                ...reorderedNewList,
            ],
        }

        setConfig(next)

        await saveMany([
            ...oldList.map(s => ({
                channelId: s.channelId,
                order: s.order,
            })),
            ...reorderedNewList.map(s => ({
                channelId: s.channelId,
                order: s.order,
            })),
        ])
    }

    useEffect(() => {
        const check = () => setIsVerySmall(window.innerWidth < 450);
        check();
        window.addEventListener("resize", check);
        return () => window.removeEventListener("resize", check);
    }, []);

    useEffect(() => {
        return () => {
            Object.values(saveTimers.current).forEach(clearTimeout)
        }
    }, [])

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
                    <option value="group">Group</option>
                    <option value="az">Name A–Z</option>
                    <option value="za">Name Z–A</option>
                </select>
            </div>
            <div className="admin-list">
                {getVisibleStreamers().map(s => (
                    <div
                        key={s.channelId}
                        className="admin-row"
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
                                            changeGroup(s.channelId, g)
                                        }
                                    />
                                    <span>{g}</span>
                                </label>
                            ))}
                        </div>

                        <div className="admin-actions">
                            <input
                                className="order-input"
                                type="number"
                                value={orderInputs[s.channelId] ?? String(s.order)}
                                onChange={e => {
                                    setOrderInputs(prev => ({
                                        ...prev,
                                        [s.channelId]: e.target.value,
                                    }))
                                }}
                                onBlur={e => {
                                    const value = Number(orderInputs[s.channelId])

                                    changeOrder(s.channelId, value)

                                    setOrderInputs(prev => {
                                        const next = { ...prev }
                                        delete next[s.channelId]
                                        return next
                                    })
                                }}
                            />
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

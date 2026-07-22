import { NextResponse } from "next/server"
import { XMLParser } from "fast-xml-parser"
import { kv } from "@vercel/kv"
import { Innertube } from "youtubei.js"

export const dynamic = 'force-dynamic'

/* ================= CONFIG ================= */
const API_KEY = process.env.YT_API_KEY!
const FAST_TTL = 90 * 1000
const NORMAL_TTL = 2 * 60 * 1000
const RECENT_RSS_RETRIES = 3
const RECENT_RSS_DEPTH = 3
const INACTIVE_RSS_DEPTH = 1
const OFFLINE_CONFIRM_POLLS = 3
const ACTIVE_WINDOW_MS = 15 * 60 * 1000
const RSS_GRACE_MS = 2 * 60 * 1000
const CHANNEL_STATE_KEY = "channel:states"
const LIVE_CACHE_KEY = "live-status:cache"

/* ================= TYPES ================= */
export type StreamStatus =
    | "live"
    | "waiting"
    | "scheduled"
    | "offline"

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

type ChannelState = {
    offlinePolls?: number
    lastActiveAt?: number
    lastKnownVideoId?: string
}

/* ================= STREAMERS ================= */
type StreamerConfig = {
    name: string
    channelId: string
    groups: string[]
    enabled: boolean
    order?: number
}
async function getStreamers(): Promise<StreamerConfig[]> {
    const config =
        (await kv.get<{ streamers: StreamerConfig[] }>(
            "streamers:config"
        )) ?? { streamers: [] }

    return config.streamers.filter(s => s.enabled)
}

/* ================= HELPERS ================= */
function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size))
    }
    return out
}

async function parallelLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = []
    let i = 0

    async function worker() {
        while (i < items.length) {
            const idx = i++
            results[idx] = await fn(items[idx])
        }
    }

    await Promise.all(Array.from({ length: limit }, worker))
    return results
}

type ChannelStateMap = Record<string, ChannelState>

async function getAllStates(): Promise<ChannelStateMap> {
    return (await kv.get<ChannelStateMap>(CHANNEL_STATE_KEY)) ?? {}
}

async function setAllStates(states: ChannelStateMap) {
    await kv.set(CHANNEL_STATE_KEY, states, { ex: 60 * 60 * 24 })
}

let yt: Innertube | null = null

async function getYT() {
    if (!yt) {
        yt = await Innertube.create()
    }

    return yt
}


/* ================= RSS ================= */
async function fetchRssFeed(
    channelId: string,
    limit: number
): Promise<{
    videoIds: string[]
    channelName?: string
}> {
    const res = await fetch(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
        {
            next: {
                revalidate: 60,
            },
        }
    )
    if (!res.ok) return { videoIds: [] }

    const xml = await res.text()
    const parser = new XMLParser()
    const json = parser.parse(xml)

    const entries = json.feed?.entry
    const arr = entries
        ? (Array.isArray(entries) ? entries : [entries])
        : []

    return {
        videoIds: arr
            .slice(0, limit)
            .map((e: any) => e["yt:videoId"])
            .filter(Boolean),

        channelName: json.feed?.author?.name,
    }
}

/* ================= INNER-TUBE ================= */
async function fetchInnerTubeFeed(
    channelId: string,
    limit = 5
): Promise<{
    videoIds: string[]
    channelName?: string
}> {
    try {
        const yt = await getYT()
        const channel = await yt.getChannel(channelId)

        let feed = channel

        // Prefer Live tab if the channel has one
        if (channel.has_live_streams) {
            feed = await channel.getLiveStreams()
        } else if (channel.has_videos) {
            feed = await channel.getVideos()
        }

        const ids = feed.videos
            .map((v: any) => v.id)
            .filter(Boolean)
            .slice(0, limit)

        return {
            videoIds: ids,
            channelName: feed.title
        }
    } catch (err) {
        console.error("[InnerTube]", channelId, err)

        return {
            videoIds: []
        }
    }
}

/* ================= CORE ================= */
async function fetchLiveStatus(): Promise<Streamer[]> {
    const STREAMERS = await getStreamers()
    const nameUpdates = new Map<string, string>()
    const stateMap = await getAllStates()
    const channelCandidates = new Map<string, string[]>()
    const now = Date.now()

    let stateDirty = false

    await parallelLimit(STREAMERS, 3, async s => {
        const state = stateMap[s.channelId] ?? {}
        const lastActive = state.lastActiveAt ?? 0

        if (
            (state.offlinePolls ?? 0) >= OFFLINE_CONFIRM_POLLS &&
            now - (state.lastActiveAt ?? 0) < 5 * 60 * 1000
        ) {
            return
        }

        const isRecentlyActive =
            now - lastActive < ACTIVE_WINDOW_MS

        const retries = isRecentlyActive
            ? RECENT_RSS_RETRIES
            : 1

        const depth = isRecentlyActive
            ? RECENT_RSS_DEPTH
            : INACTIVE_RSS_DEPTH

        for (let attempt = 1; attempt <= retries; attempt++) {
            const rss = await fetchRssFeed(s.channelId, depth)
            let vids = rss.videoIds

            if (rss.channelName && rss.channelName !== s.name) {
                s.name = rss.channelName
                nameUpdates.set(s.channelId, rss.channelName)
            }

            console.log(
                `[RSS] ${s.name} attempt=${attempt}/${retries} depth=${depth} videos=${vids.length}`
            )

            if (
                attempt === 1 &&
                isRecentlyActive &&
                vids.length < depth
            ) {
                console.log(`[InnerTube] merge ${s.name}`)

                const inner = await fetchInnerTubeFeed(s.channelId, Math.max(5, depth + 2))

                if (inner.channelName && inner.channelName !== s.name) {
                    s.name = inner.channelName
                    nameUpdates.set(s.channelId, inner.channelName)
                }

                vids = [...new Set([
                    ...vids,
                    ...inner.videoIds
                ])]
            }

            if (vids.length > 0) {
                channelCandidates.set(s.channelId, vids)
                break
            }

            if (
                state.lastKnownVideoId &&
                state.lastActiveAt &&
                now - state.lastActiveAt < RSS_GRACE_MS
            ) {
                channelCandidates.set(s.channelId, [state.lastKnownVideoId])
                break
            }

            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 300))
            }
        }
    })

    const allVideoIds = Array.from(
        new Set(Array.from(channelCandidates.values()).flat())
    )

    const chunks = chunk(allVideoIds, 50)
    console.log(
        `[YT] ${new Date().toISOString()} | streamers=${STREAMERS.length}`
    )

    console.log(
        `[YT] videoIds=${allVideoIds.length}, chunks=${chunks.length}`
    )

    const videoInfo = new Map<
        string,
        { status: StreamStatus; viewers?: number }
    >()

    for (const ids of chunks) {
        const res = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${ids.join(",")}&key=${API_KEY}`,
            { cache: "no-store" }
        )
        if (!res.ok) continue

        const data = await res.json()
        for (const v of data.items ?? []) {
            const d = v.liveStreamingDetails
            if (!d) continue

            if (d.actualStartTime && !d.actualEndTime) {
                videoInfo.set(v.id, {
                    status: "live",
                    viewers: Number(d.concurrentViewers || 0),
                })
            } else if (!d.actualStartTime && d.scheduledStartTime) {
                videoInfo.set(v.id, { status: "scheduled" })
            }
        }
    }

    const result: Streamer[] = []
    for (const s of STREAMERS) {
        const state = stateMap[s.channelId] ?? {}
        const vids = channelCandidates.get(s.channelId) ?? []
        const liveHit = vids.find(v => videoInfo.get(v)?.status === "live")
        const scheduledHit = vids.find(v => videoInfo.get(v)?.status === "scheduled")
        const hit = liveHit ?? scheduledHit
        const info = hit ? videoInfo.get(hit) : null

        let status: StreamStatus = "offline"

        if (info?.status === "live" && hit) {
            status = "live"
            stateMap[s.channelId] = {
                ...state,
                offlinePolls: 0,
                lastActiveAt: now,
                lastKnownVideoId: hit
            }
            stateDirty = true
        } else if (info?.status === "scheduled") {
            status = hit ? "waiting" : "scheduled"
            stateMap[s.channelId] = {
                ...state,
                offlinePolls: 0,
                lastActiveAt: now,
                lastKnownVideoId: hit
            }
            stateDirty = true
        } else {
            const count = (state.offlinePolls ?? 0) + 1

            if (count < OFFLINE_CONFIRM_POLLS && !state.lastKnownVideoId) {
                status = "waiting"

                stateMap[s.channelId] = {
                    ...state,
                    offlinePolls: count,
                    lastActiveAt: now
                }

                stateDirty = true

            } else if (count < OFFLINE_CONFIRM_POLLS && state.lastKnownVideoId) {
                status = "live"

                stateMap[s.channelId] = {
                    ...state,
                    offlinePolls: count
                }

                stateDirty = true

            } else if (state.offlinePolls !== OFFLINE_CONFIRM_POLLS) {
                stateMap[s.channelId] = {
                    ...state,
                    offlinePolls: OFFLINE_CONFIRM_POLLS
                }

                stateDirty = true
            }
        }

        result.push({
            ...s,
            status,
            liveVideoId:
                hit ??
                state.lastKnownVideoId,
            concurrentViewers: info?.viewers,
        })
    }

    try {
        if (nameUpdates.size > 0) {
            const config = await kv.get<{ streamers: StreamerConfig[] }>("streamers:config")

            if (config) {
                config.streamers = config.streamers.map(streamer => {
                    const newName = nameUpdates.get(streamer.channelId)

                    return newName
                        ? { ...streamer, name: newName }
                        : streamer
                })

                await kv.set("streamers:config", config)
            }
        }
    } catch (err) {
        console.error("Failed to update streamer names:", err)
    }
    if (stateDirty) {
        await setAllStates(stateMap)
    }
    return result
}


/* ================= API ================= */

function getTTL(cache: Streamer[] | null) {
    if (!cache) return NORMAL_TTL

    return cache.some(
        s => s.status === "live" || s.status === "waiting"
    )
        ? FAST_TTL
        : NORMAL_TTL
}

export async function GET() {
    const cache = await kv.get<Streamer[]>(LIVE_CACHE_KEY)

    if (cache) {
        console.log("[YT] cache hit")
        return NextResponse.json(cache)
    } else
        console.log("[YT] cache miss")

    const lock = await kv.set("live-status:lock", "1", {
        nx: true,
        ex: 20,
    })

    if (!lock) {
        for (let i = 0; i < 5; i++) {
            await new Promise(r => setTimeout(r, 500))

            const cache = await kv.get<Streamer[]>(LIVE_CACHE_KEY)

            if (cache) {
                return NextResponse.json(cache)
            }
        }

        return NextResponse.json(
            { error: "Cache warming" },
            { status: 503 }
        )
    }

    try {
        const result = await fetchLiveStatus()

        await kv.set(
            LIVE_CACHE_KEY,
            result,
            {
                ex: Math.ceil(getTTL(result) / 1000),
            }
        )

        return NextResponse.json(result)
    } finally {
        await kv.del("live-status:lock")
    }
}
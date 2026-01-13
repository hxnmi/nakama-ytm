import { NextResponse } from "next/server"
import { XMLParser } from "fast-xml-parser"
import { kv } from "@vercel/kv"

export const dynamic = 'force-dynamic'

/* ================= CONFIG ================= */
const API_KEY = process.env.YT_API_KEY!
const FAST_TTL = 30 * 1000
const NORMAL_TTL = 90 * 1000
const DEPTH_STEPS = [3, 1]
const OFFLINE_CONFIRM_POLLS = 3
const ACTIVE_WINDOW_MS = 15 * 60 * 1000
const RSS_GRACE_MS = 2 * 60 * 1000

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
}
async function getStreamers(): Promise<StreamerConfig[]> {
    const config =
        (await kv.get<{ streamers: StreamerConfig[] }>(
            "streamers:config"
        )) ?? { streamers: [] }

    return config.streamers.filter(s => s.enabled)
}


/* ================= MEMORY ================= */
let cache: Streamer[] | null = null
let cacheTime = 0
let inflight: Promise<Streamer[]> | null = null

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

function key(channelId: string) {
    return `channel:${channelId}`
}

async function getState(channelId: string): Promise<ChannelState> {
    return (await kv.get<ChannelState>(key(channelId))) ?? {}
}

async function setState(channelId: string, patch: ChannelState) {
    const prev = await getState(channelId)
    await kv.set(key(channelId), { ...prev, ...patch })
}

/* ================= RSS ================= */
async function fetchRssVideoIds(
    channelId: string,
    limit: number
): Promise<string[]> {
    const res = await fetch(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
        { cache: "no-store" }
    )
    if (!res.ok) return []

    const xml = await res.text()
    const parser = new XMLParser()
    const json = parser.parse(xml)

    const entries = json.feed?.entry
    if (!entries) return []

    const arr = Array.isArray(entries) ? entries : [entries]
    return arr.slice(0, limit).map((e: any) => e["yt:videoId"]).filter(Boolean)
}

/* ================= CORE ================= */
async function fetchLiveStatus(): Promise<Streamer[]> {
    const STREAMERS = await getStreamers()
    const stateCache = new Map<string, ChannelState>()
    const channelCandidates = new Map<string, string[]>()
    const now = Date.now()

    await parallelLimit(STREAMERS, 5, async s => {
        const state = await getState(s.channelId)
        stateCache.set(s.channelId, state)
        const lastActive = state.lastActiveAt ?? 0

        const depths =
            now - lastActive < ACTIVE_WINDOW_MS
                ? DEPTH_STEPS
                : [1]

        for (const depth of depths) {
            const vids = await fetchRssVideoIds(s.channelId, depth)

            if (vids.length) {
                channelCandidates.set(s.channelId, vids)
                break
            }

            const lastActive = state.lastActiveAt
            const lastVid = state.lastKnownVideoId

            if (
                !vids.length &&
                lastActive &&
                lastVid &&
                now - lastActive < RSS_GRACE_MS
            ) {
                channelCandidates.set(s.channelId, [lastVid])
                break
            }
        }

    })

    const allVideoIds = Array.from(channelCandidates.values()).flat()
    const chunks = chunk(allVideoIds, 50)

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

    return Promise.all(STREAMERS.map(async s => {
        const state = stateCache.get(s.channelId) ?? {}
        const vids = channelCandidates.get(s.channelId) ?? []
        const hit = vids.find(v => videoInfo.has(v))
        const info = hit ? videoInfo.get(hit) : null

        let status: StreamStatus = "offline"
        if (info?.status === "live" && hit) {
            status = "live"
            await setState(s.channelId, {
                offlinePolls: 0,
                lastActiveAt: Date.now(),
                lastKnownVideoId: hit
            })
        } else if (info?.status === "scheduled") {
            status = hit ? "waiting" : "scheduled"
            await setState(s.channelId, {
                offlinePolls: 0,
                lastActiveAt: Date.now()
            })
        } else {
            const count = (state.offlinePolls ?? 0) + 1

            if (count < OFFLINE_CONFIRM_POLLS) {
                status = "waiting"
                await setState(s.channelId, {
                    offlinePolls: count,
                    lastActiveAt: Date.now()
                })
            } else {
                await setState(s.channelId, {
                    offlinePolls: count
                })
            }
        }

        return {
            ...s,
            status,
            liveVideoId: status !== "offline" ? hit : undefined,
            concurrentViewers: info?.viewers,
        }
    })
    )
}

/* ================= API ================= */

function getTTL(cache: Streamer[] | null) {
    if (!cache) return NORMAL_TTL
    return cache.some(s => s.status === "live" || s.status === "waiting")
        ? FAST_TTL
        : NORMAL_TTL
}

export async function GET() {
    const now = Date.now()
    const ttl = getTTL(cache)

    if (cache && now - cacheTime < ttl) {
        return NextResponse.json(cache)
    }

    if (!inflight) {
        inflight = fetchLiveStatus()
            .then(res => {
                cache = res
                cacheTime = Date.now()
                return res
            })
            .finally(() => {
                inflight = null
            })
    }

    return NextResponse.json(await inflight)
}
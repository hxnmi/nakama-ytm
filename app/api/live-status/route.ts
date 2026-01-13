import { NextResponse } from "next/server"
import { XMLParser } from "fast-xml-parser"
import { kv } from "@vercel/kv"

export const dynamic = 'force-dynamic'

/* ================= CONFIG ================= */
const API_KEY = process.env.YT_API_KEY!
const FAST_TTL = 90 * 1000
const NORMAL_TTL = 5 * 60 * 1000
const DEPTH_STEPS = [3, 1]
const OFFLINE_CONFIRM_POLLS = 3
const ACTIVE_WINDOW_MS = 15 * 60 * 1000
const RSS_GRACE_MS = 2 * 60 * 1000
const CHANNEL_STATE_KEY = "channel:states"

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

type ChannelStateMap = Record<string, ChannelState>

async function getAllStates(): Promise<ChannelStateMap> {
    return (await kv.get<ChannelStateMap>(CHANNEL_STATE_KEY)) ?? {}
}

async function setAllStates(states: ChannelStateMap) {
    await kv.set(CHANNEL_STATE_KEY, states, { ex: 60 * 60 * 24 })
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

            if (
                state.lastActiveAt &&
                state.lastKnownVideoId &&
                now - state.lastActiveAt < RSS_GRACE_MS
            ) {
                channelCandidates.set(s.channelId, [state.lastKnownVideoId])
                break
            }
        }
    })

    const allVideoIds = Array.from(
        new Set(Array.from(channelCandidates.values()).flat())
    )

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

    const result = STREAMERS.map(s => {
        const state = stateMap[s.channelId] ?? {}
        const vids = channelCandidates.get(s.channelId) ?? []
        const hit = vids.find(v => videoInfo.has(v))
        const info = hit ? videoInfo.get(hit) : null

        let status: StreamStatus = "offline"

        if (info?.status === "live" && hit) {
            status = "live"
            stateMap[s.channelId] = {
                offlinePolls: 0,
                lastActiveAt: Date.now(),
                lastKnownVideoId: hit
            }
            stateDirty = true
        } else if (info?.status === "scheduled") {
            status = hit ? "waiting" : "scheduled"
            stateMap[s.channelId] = {
                offlinePolls: 0,
                lastActiveAt: Date.now(),
                lastKnownVideoId: hit
            }
            stateDirty = true
        } else {
            const count = (state.offlinePolls ?? 0) + 1

            if (count < OFFLINE_CONFIRM_POLLS) {
                status = "waiting"
                stateMap[s.channelId] = {
                    ...state,
                    offlinePolls: count,
                    lastActiveAt: Date.now()
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

        return {
            ...s,
            status,
            liveVideoId: status !== "offline" ? hit : undefined,
            concurrentViewers: info?.viewers,
        }
    })

    if (stateDirty) {
        await setAllStates(stateMap)
    }
    return result
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
import { NextResponse } from "next/server"
import { XMLParser } from "fast-xml-parser"

export const dynamic = 'force-dynamic'

/* ================= CONFIG ================= */
const API_KEY = process.env.YT_API_KEY!
const CACHE_TTL = 90 * 1000
const DEPTH_STEPS = [3, 1]
const OFFLINE_CONFIRM_POLLS = 3
const ACTIVE_WINDOW_MS = 15 * 60 * 1000

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

/* ================= STREAMERS ================= */
const STREAMERS: Omit<Streamer, "status">[] = [
    { name: "yb", channelId: "UCCuzDCoI3EUOo_nhCj4noSw" },
    { name: "Tepe46", channelId: "UCkDkZ8PRYXegUJI8lW8f3ig" },
    { name: "Tierison", channelId: "UCMZ36YmdjEvuQyxxiECv-CQ" },
    { name: "bang mister aloy", channelId: "UCDYeXZxVhjz1uGTlfRt4m_A" },
    { name: "ibot13", channelId: "UC2V4Mad4dPbqbXkPFk6iE2w" },
    { name: "youKtheo", channelId: "UCCe64MVAbvs7Uy1SKHtXnZQ" },
    { name: "Garry Ang", channelId: "UCodn3X4h9ShbhR-Q6nB5BXg" },
    { name: "Bravyson Vconk", channelId: "UC-Q4j_hagFgdLnN8XqcXicQ" },
    { name: "Niko Junius", channelId: "UCznR-iWZGqw4j03cjJjBQ1A" },
    { name: "GURAISU", channelId: "UCW5DsRfpDf4Y3WQX4B_woTg" },
    { name: "Michelle Christo", channelId: "UCjxxU-v0C77m2Kes0iKcULw" },
    { name: "Jessica Prashela", channelId: "UCH_8FYTGTcnuEsyDYzszlWg" },
    { name: "Derisky Prisadevano", channelId: "UCluSMW_P1KtJuP1-Hc3qPUA" },
    { name: "Juan Herman", channelId: "UCxki4Fj3RnfeVD-LReduu-A" },
    { name: "JAPETLETSDOIT", channelId: "UCM4STwF-ahP5w3KsnhEpKXA" },
    { name: "Dylan Lauw", channelId: "UC0fbkigSVHeqURIhqWswj-Q" },
    { name: "MODE siNclair", channelId: "UC0iFPwnHPe85muk00ZttRNw" },
    { name: "Papuy", channelId: "UC5BfiJ5IlmvsvOSgxtMuzfA" },
    { name: "ELJAWZ", channelId: "UCrP8AFjHDuBgfdR9ZWfuG0A" },
    { name: "MIRJAAA", channelId: "UCpt7608IxS_70BQjCre3tgQ" },
    { name: "Danny", channelId: "UCZHSRSIP9m2uxOAOlVJGytw" },
    { name: "Sipije", channelId: "UCAmlE2IwQKZ3t5LlNIyqDeQ" },
    { name: "zota frz", channelId: "UChEzBCVwQg3EC7QjsF3iZHw" },
    { name: "a bee gel", channelId: "UCBu6n7CY3k_HdX8THmyEOEw" },
    { name: "Bopeng", channelId: "UCKN2A4ShReXSHJER9_lfwLw" },
    { name: "Anjasmara7", channelId: "UCLHq02qks9tL0AV7zi7mMNw" },
    { name: "Lezype", channelId: "UCRyx3b7jr7yLyPXeFiqFofg" },
    { name: "Gabriel", channelId: "UCFgPfI9b8gYqSOkCNLUvyVQ" },
    { name: "Alesya Nina", channelId: "UCf_n8a6psSuhI08pfz6I5RA" },
    { name: "Chavilangel", channelId: "UCSplGHIcOjIhQ83K8vxF7PQ" },
    { name: "Maeve Soo", channelId: "UCw4KiilP-FOF2XxWfMbMeyg" },
    { name: "Lise Zhang", channelId: "UC3ru50TXTwW_fuN0oyCiIEA" },
    { name: "Dobori Tensha VT", channelId: "UC49Z-uUv47D1Ls2q3PGlbYQ" },
    { name: "Gray Wellington", channelId: "UCmaHGPrL0h_wURwFYgpBN8g" },
    { name: "Apinpalingserius", channelId: "UCHYXqEaPtUwReavS6FIVDcQ" },
    { name: "Idinzzz", channelId: "UCNhLmDbzYe3O06juIuqUtDg" },
    { name: "Kicked417", channelId: "UCpUUrbbl0tjDznAGgkGo7tQ" },
    { name: "Wayne D Veron", channelId: "UCpDAUPDQ74XZMZzq1oKmeiA" },
    { name: "Moonears", channelId: "UCMVkKfDhL_B7QQHiuOYHIMw" },
    { name: "Jaka Triad", channelId: "UCFHBoYW_XUy46ojXPKh_BwQ" },
    { name: "Jacky Jax RP", channelId: "UCWhZw_IsZwYdOyE-UDANwEg" },
    { name: "Risky Prabu", channelId: "UCRUU-6WAHT9jjhxC09ILO-A" },
    { name: "nayrdika", channelId: "UCdPva16vonhTB8omB9zXT0Q" },
    { name: "ihsannn", channelId: "UCFpsNDzOwE6XowRjR6q4GBQ" },
    { name: "PaddanG", channelId: "UCCBHkKFT-XBsBnzVBrXs5Vw" },
    { name: "Sam Wani", channelId: "UCHg77VE2davyHptiOS9XPeg" },
    { name: "SEYA", channelId: "UCHY6HMPiHbHzR7KzutjjTug" },
    { name: "CYYA", channelId: "UCRjUQo8O76sITKSjsQ9SrdQ" },
    { name: "Qune Chan", channelId: "UCBVJqj48yaFYzJvCGCISm_g" },
    { name: "BudyTabootie", channelId: "UCuAhZnRb3b8IOd5o_sEiD_Q" },
    { name: "Happy RP", channelId: "UCcBb71U4E3TxM5FloZWGjqA" },
    { name: "Dipiw", channelId: "UCvrhggVJsdR6uYvuIrX_Grg" },
    { name: "Raihan Dwi", channelId: "UCksYroc-n4zO47PLPyQXaDA" },
    { name: "tasya", channelId: "UC2ZGuCf3yMc3UjBb8r1dLeQ" },
    { name: "LokiTheHuman", channelId: "UC4fWus0_aExGR7NPmfVAwTg" },
    { name: "irfan_4tm", channelId: "UCJQd6FWZrpJNPxL8BbMbLfQ" },
    { name: "Boujee Girl", channelId: "UCoAsqbFsvjwxKxT-50xQKDQ" },
    { name: "NengEidel", channelId: "UCqMTZVc8ig-Izz3UnK79Ejw" },
    { name: "Intannn", channelId: "UC26X1vZpfYwjXdjcd6oAPMg" },
    { name: "Wazowsky", channelId: "UCy7vnQ9e_PT--ajeLRkR3pQ" },
    { name: "KafeeyInHere", channelId: "UCz4s1BgKNXTwOHO0PHQHQxQ" },
    { name: "nenabobo", channelId: "UCUC6Ovlo-UNIGD5lKcLIn6Q" },
    { name: "hi.juenva", channelId: "UCQRryYDuQcShDPxnskgnLuw" },
    { name: "ItsLin", channelId: "UChC9H3kvWlz9-DJa7QmpvYA" },
    { name: "dipanggilcuno", channelId: "UCtw795IKH4fzMWXv0_J-I5Q" },
    { name: "Imed Mettu", channelId: "UCnmnGqHJA0bestWPYeqnJQg" },
    { name: "Ronny Bons", channelId: "UCJTq8YQXj-2_BNgwis4SGsg" },
    { name: "Papa Gejet", channelId: "UCXXnxxYJ5dY_tsOb0ELBc2w" },
    { name: "Nanas Art", channelId: "UCd5u137U1cBtVVDoHf6Utag" },
    { name: "Siberian Husky", channelId: "UCCXRK1-4WaU5Pk8iTkhWPqg" },
    { name: "Ayus Bangga", channelId: "UCMfAAviY4LvvQ2rFx6g_RUw" },
]

/* ================= MEMORY ================= */
const offlinePolls = new Map<string, number>()
const lastActiveAt = new Map<string, number>()

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
    const channelCandidates = new Map<string, string[]>()
    const now = Date.now()

    for (const s of STREAMERS) {
        const lastActive = lastActiveAt.get(s.channelId) ?? 0

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
        }
    }

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

    return STREAMERS.map(s => {
        const vids = channelCandidates.get(s.channelId) ?? []
        const hit = vids.find(v => videoInfo.has(v))
        const info = hit ? videoInfo.get(hit) : null

        let status: StreamStatus = "offline"
        if (info?.status === "live") {
            status = "live"
            offlinePolls.delete(s.channelId)
            lastActiveAt.set(s.channelId, Date.now())
        }
        else if (info?.status === "scheduled") {
            status = hit ? "waiting" : "scheduled"
            offlinePolls.delete(s.channelId)
            lastActiveAt.set(s.channelId, Date.now())
        } else {
            const count = (offlinePolls.get(s.channelId) ?? 0) + 1
            offlinePolls.set(s.channelId, count)

            if (count < OFFLINE_CONFIRM_POLLS) {
                status = "waiting"
                lastActiveAt.set(s.channelId, Date.now())
            }
        }

        return {
            ...s,
            status,
            liveVideoId: status !== "offline" ? hit : undefined,
            concurrentViewers: info?.viewers,
        }
    })
}

/* ================= API ================= */
export async function GET() {
    const now = Date.now()

    if (cache && now - cacheTime < CACHE_TTL) {
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
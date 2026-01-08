import { NextResponse } from "next/server"

type Streamer = {
    name: string
    channelId: string
    isLive: boolean
    liveVideoId?: string
}
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const API_KEY = process.env.YT_API_KEY!

let cache: Streamer[] | null = null
let cacheTime = 0
let inflight: Promise<Streamer[]> | null = null

const STREAMERS: Omit<Streamer, "isLive">[] = [
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
    { name: "Papuy", channelId: "UC5BfiJ5IlmvsvOSgxtMuzfA" },
    { name: "ELJAWZ", channelId: "UCrP8AFjHDuBgfdR9ZWfuG0A" },
    { name: "MIRJAAA", channelId: "UCpt7608IxS_70BQjCre3tgQ" },
    { name: "Danny", channelId: "UCZHSRSIP9m2uxOAOlVJGytw" },
    { name: "Sipije", channelId: "UCAmlE2IwQKZ3t5LlNIyqDeQ" },
    { name: "a bee gel", channelId: "UCBu6n7CY3k_HdX8THmyEOEw" },
    { name: "zota frz", channelId: "UChEzBCVwQg3EC7QjsF3iZHw" },
    { name: "Anjasmara7", channelId: "UCLHq02qks9tL0AV7zi7mMNw" },
    { name: "Lezype", channelId: "UCRyx3b7jr7yLyPXeFiqFofg" },
    { name: "Lise Zhang", channelId: "UC3ru50TXTwW_fuN0oyCiIEA" },
    { name: "Dobori Tensha VT", channelId: "UC49Z-uUv47D1Ls2q3PGlbYQ" },
    { name: "Gray Wellington", channelId: "UCmaHGPrL0h_wURwFYgpBN8g" },
    { name: "Apinpalingserius", channelId: "UCHYXqEaPtUwReavS6FIVDcQ" },
    { name: "Idinzzz", channelId: "UCNhLmDbzYe3O06juIuqUtDg" },
    { name: "Moonears", channelId: "UCMVkKfDhL_B7QQHiuOYHIMw" },
    { name: "PaddanG", channelId: "UCCBHkKFT-XBsBnzVBrXs5Vw" },
    { name: "Sam Wani", channelId: "UCHg77VE2davyHptiOS9XPeg" },
    { name: "tasya", channelId: "UC2ZGuCf3yMc3UjBb8r1dLeQ" },
    { name: "Shroud", channelId: "UCoz3Kpu5lv-ALhR4h9bDvcw" },
    { name: "LokiTheHuman", channelId: "UC4fWus0_aExGR7NPmfVAwTg" },
]

async function fetchJSON(url: string) {
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) throw new Error("YT API error")
    return res.json()
}

async function fetchLiveStatus(): Promise<Streamer[]> {
    const channelIds = STREAMERS.map(s => s.channelId).join(",")

    const channelData = await fetchJSON(
        `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelIds}&key=${API_KEY}`
    )

    const uploadMap = new Map<string, string>()
    for (const c of channelData.items ?? []) {
        const pid = c?.contentDetails?.relatedPlaylists?.uploads
        if (pid) uploadMap.set(c.id, pid)
    }

    const latestVideo = new Map<string, string>()

    await Promise.all(
        STREAMERS.map(async s => {
            const pid = uploadMap.get(s.channelId)
            if (!pid) return

            const data = await fetchJSON(
                `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=1&playlistId=${pid}&key=${API_KEY}`
            )

            const vid = data.items?.[0]?.contentDetails?.videoId
            if (vid) latestVideo.set(s.channelId, vid)
        })
    )

    const videoIds = [...latestVideo.values()].join(",")
    const liveSet = new Set<string>()

    if (videoIds) {
        const videoData = await fetchJSON(
            `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoIds}&key=${API_KEY}`
        )

        for (const v of videoData.items ?? []) {
            const d = v.liveStreamingDetails
            if (d?.actualStartTime && !d?.actualEndTime) {
                liveSet.add(v.id)
            }
        }
    }

    return STREAMERS.map(s => {
        const vid = latestVideo.get(s.channelId)
        const isLive = !!vid && liveSet.has(vid)

        return {
            ...s,
            isLive,
            liveVideoId: isLive ? vid : undefined,
        }
    })
}

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
            .catch(err => {
                console.error("YT fetch failed:", err)
                return cache ?? []
            })
            .finally(() => {
                inflight = null
            })
    }

    const data = await inflight
    return NextResponse.json(data)
}

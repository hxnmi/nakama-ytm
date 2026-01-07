import { NextResponse } from "next/server"

type Streamer = {
    name: string
    channelId: string
    isLive: boolean
    liveVideoId?: string
}

let cachedData: Streamer[] | null = null
let lastFetch = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

const STREAMERS = [
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
    { name: "Idinzzz", channelId: "UCNhLmDbzYe3O06juIuqUtDg" },
    { name: "Moonears", channelId: "UCMVkKfDhL_B7QQHiuOYHIMw" },
    { name: "PaddanG", channelId: "UCCBHkKFT-XBsBnzVBrXs5Vw" },
    { name: "tasya", channelId: "UC2ZGuCf3yMc3UjBb8r1dLeQ" },
    { name: "Sam Wani", channelId: "UCHg77VE2davyHptiOS9XPeg" },
    { name: "LokiTheHuman", channelId: "UC4fWus0_aExGR7NPmfVAwTg" },
]

export async function GET() {
    const now = Date.now()

    if (cachedData && now - lastFetch < CACHE_TTL) {
        return NextResponse.json(cachedData)
    }

    const apiKey = process.env.YT_API_KEY!
    const results: Streamer[] = []

    const channelIds = STREAMERS.map(s => s.channelId).join(",")
    const channelRes = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelIds}&key=${apiKey}`
    )
    const channelData = await channelRes.json()

    const uploadMap = new Map<string, string>()
        ; (channelData.items ?? []).forEach((c: any) => {
            const pid = c?.contentDetails?.relatedPlaylists?.uploads
            if (pid) uploadMap.set(c.id, pid)
        })

    const latestVideoMap = new Map<string, string>()

    for (const s of STREAMERS) {
        const pid = uploadMap.get(s.channelId)
        if (!pid) continue

        const res = await fetch(
            `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=1&playlistId=${pid}&key=${apiKey}`
        )
        const data = await res.json()

        const vid = data.items?.[0]?.contentDetails?.videoId
        if (vid) latestVideoMap.set(s.channelId, vid)
    }

    const videoIds = [...latestVideoMap.values()].join(",")
    const liveSet = new Set<string>()

    if (videoIds) {
        const videoRes = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoIds}&key=${apiKey}`
        )
        const videoData = await videoRes.json()

            ; (videoData.items ?? []).forEach((v: any) => {
                const live = v.liveStreamingDetails

                const isLiveNow =
                    live?.actualStartTime &&
                    !live?.actualEndTime

                if (isLiveNow) {
                    liveSet.add(v.id)
                }
            })
    }

    STREAMERS.forEach(s => {
        const vid = latestVideoMap.get(s.channelId)
        const isLive = !!vid && liveSet.has(vid)

        results.push({
            ...s,
            isLive,
            liveVideoId: isLive ? vid : undefined,
        })
    })

    cachedData = results
    lastFetch = now

    return NextResponse.json(results)
}

import { NextResponse } from "next/server"

type Streamer = {
    name: string
    channelId: string
    isLive: boolean
    liveVideoId?: string
    concurrentViewers?: number
}
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes
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
    { name: "nayrdika", channelId: "UCdPva16vonhTB8omB9zXT0Q" },
    { name: "ihsannn", channelId: "UCFpsNDzOwE6XowRjR6q4GBQ" },
    { name: "PaddanG", channelId: "UCCBHkKFT-XBsBnzVBrXs5Vw" },
    { name: "Sam Wani", channelId: "UCHg77VE2davyHptiOS9XPeg" },
    { name: "SEYA", channelId: "UCHY6HMPiHbHzR7KzutjjTug" },
    { name: "CYYA", channelId: "UCRjUQo8O76sITKSjsQ9SrdQ" },
    { name: "BudyTabootie", channelId: "UCuAhZnRb3b8IOd5o_sEiD_Q" },
    { name: "Happy RP", channelId: "UCcBb71U4E3TxM5FloZWGjqA" },
    { name: "Dipiw", channelId: "UCvrhggVJsdR6uYvuIrX_Grg" },
    { name: "tasya", channelId: "UC2ZGuCf3yMc3UjBb8r1dLeQ" },
    { name: "LokiTheHuman", channelId: "UC4fWus0_aExGR7NPmfVAwTg" },
    { name: "irfan_4tm", channelId: "UCJQd6FWZrpJNPxL8BbMbLfQ" },
    { name: "NengEidel", channelId: "UCqMTZVc8ig-Izz3UnK79Ejw" },
    { name: "Intannn", channelId: "UC26X1vZpfYwjXdjcd6oAPMg" },
    { name: "Wazowsky", channelId: "UCy7vnQ9e_PT--ajeLRkR3pQ" },
    { name: "KafeeyInHere", channelId: "UCz4s1BgKNXTwOHO0PHQHQxQ" },
    { name: "nenabobo", channelId: "UCUC6Ovlo-UNIGD5lKcLIn6Q" },
    { name: "Nanas Art", channelId: "UCd5u137U1cBtVVDoHf6Utag" },
    { name: "Siberian Husky", channelId: "UCCXRK1-4WaU5Pk8iTkhWPqg" },
]

async function fetchJSON(url: string) {
    const res = await fetch(url, { cache: "no-store" })

    if (!res.ok) {
        const text = await res.text()
        throw new Error(`YT API ${res.status}: ${text}`)
    }

    return res.json()
}


function chunk<T>(arr: T[], size: number): T[][] {
    const res: T[][] = []
    for (let i = 0; i < arr.length; i += size) {
        res.push(arr.slice(i, i + size))
    }
    return res
}


async function fetchLiveStatus(): Promise<Streamer[]> {
    const streamerData = STREAMERS.map(s => ({
        ...s,
        playlistId: s.channelId.replace(/^UC/, 'UU')
    }));

    const videoIdPromises = streamerData.map(async (s) => {
        try {
            const data = await fetchJSON(
                `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=1&playlistId=${s.playlistId}&key=${API_KEY}`
            );
            return { channelId: s.channelId, videoId: data.items?.[0]?.contentDetails?.videoId };
        } catch {
            return { channelId: s.channelId, videoId: null };
        }
    });

    const results = await Promise.all(videoIdPromises);
    const latestVideoMap = new Map(results.map(r => [r.channelId, r.videoId]));
    const allVideoIds = results.map(r => r.videoId).filter(Boolean) as string[];

    const liveInfo = new Map<string, number>();
    const videoChunks = chunk(allVideoIds, 50);

    for (const vids of videoChunks) {
        const videoData = await fetchJSON(
            `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${vids.join(",")}&key=${API_KEY}`
        );

        for (const v of videoData.items ?? []) {
            const d = v.liveStreamingDetails;
            if (d?.actualStartTime && !d?.actualEndTime) {
                liveInfo.set(v.id, Number(d.concurrentViewers || 0));
            }
        }
    }

    return STREAMERS.map(s => {
        const vid = latestVideoMap.get(s.channelId);
        const viewers = vid ? liveInfo.get(vid) : undefined;
        const isLive = viewers !== undefined;

        return {
            ...s,
            isLive,
            liveVideoId: isLive ? vid : undefined,
            concurrentViewers: isLive ? viewers : undefined,
        };
    });
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

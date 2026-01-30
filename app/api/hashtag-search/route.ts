import { NextResponse } from "next/server"
import { kv } from "@vercel/kv"

export const dynamic = 'force-dynamic'

const API_KEY = process.env.YT_API_KEY!
const CACHE_TTL = 2 * 60 * 60 * 1000
const HASHTAG_CACHE_KEY = "hashtag:search:imeroleplay"

export type HashtagResult = {
    videoId: string
    title: string
    channelName: string
    channelId: string
    thumbnailUrl: string
    viewerCount?: number
}

async function searchHashtagVideos(hashtag: string): Promise<HashtagResult[]> {
    try {
        const res = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&q=%23${hashtag}&type=video&eventType=live&maxResults=50&order=relevance&key=${API_KEY}`,
            { cache: "no-store" }
        )

        if (!res.ok) {
            console.error("YouTube search failed:", res.status)
            return []
        }

        const data = await res.json()
        const results: HashtagResult[] = []

        for (const item of data.items ?? []) {
            const videoId = item.id.videoId
            const snippet = item.snippet

            results.push({
                videoId,
                title: snippet.title,
                channelName: snippet.channelTitle,
                channelId: snippet.channelId,
                thumbnailUrl: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || "",
            })
        }

        return results
    } catch (error) {
        console.error("Error searching hashtag:", error)
        return []
    }
}

export async function GET() {
    try {
        const cached = await kv.get<HashtagResult[]>(HASHTAG_CACHE_KEY)
        if (cached && Array.isArray(cached)) {
            return NextResponse.json(cached)
        }

        const results = await searchHashtagVideos("imeroleplay")

        if (results.length > 0) {
            await kv.set(HASHTAG_CACHE_KEY, results, { ex: Math.floor(CACHE_TTL / 1000) })
        }

        return NextResponse.json(results)
    } catch (error) {
        console.error("Hashtag search error:", error)
        return NextResponse.json([])
    }
}

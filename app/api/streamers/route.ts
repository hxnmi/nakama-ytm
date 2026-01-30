import { NextResponse } from "next/server"
import { kv } from "@vercel/kv"

const CONFIG_KEY = "streamers:config"

type StreamerConfig = {
    name: string
    channelId: string
    groups: string[]
    enabled: boolean
    order?: number
}

type StreamersConfig = {
    groups: string[]
    streamers: StreamerConfig[]
}

function requireAdmin(req: Request) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${process.env.ADMIN_TOKEN}`) {
        throw new Response("Unauthorized", { status: 401 })
    }
}

export async function GET(req: Request) {
    const url = new URL(req.url)
    const shouldRefresh = url.searchParams.get("refresh") === "true"

    if (shouldRefresh) {
        const secret = url.searchParams.get("secret")
        if (secret !== process.env.CRON_SECRET) {
            return new Response("Unauthorized", { status: 401 })
        }
    } else {
        requireAdmin(req)
    }

    const config: StreamersConfig =
        (await kv.get(CONFIG_KEY)) ?? {
            groups: ["A4A", "NMC"],
            streamers: [],
        }

    if (shouldRefresh) {
        const updatedStreamers = await Promise.all(
            config.streamers.map(async (streamer) => {
                try {
                    const freshName = await fetchChannelName(streamer.channelId)
                    if (freshName && freshName !== streamer.name) {
                        return { ...streamer, name: freshName }
                    }
                    return streamer
                } catch {
                    return streamer
                }
            })
        )

        const updated = { ...config, streamers: updatedStreamers }
        await kv.set(CONFIG_KEY, updated)
        return NextResponse.json({ ok: true, refreshed: true })
    }

    return NextResponse.json(config)
}

async function fetchChannelName(channelId: string) {
    const res = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${process.env.YT_API_KEY}`
    )

    if (!res.ok) return null

    const data = await res.json()
    return data.items?.[0]?.snippet?.title ?? null
}


export async function POST(req: Request) {
    requireAdmin(req)

    const body = await req.json()

    const config: StreamersConfig =
        (await kv.get(CONFIG_KEY)) ?? {
            groups: ["A4A", "NMC"],
            streamers: [],
        }

    const channelName =
        body.name ??
        (await fetchChannelName(body.channelId)) ??
        body.channelId

    const streamer: StreamerConfig = {
        name: channelName,
        channelId: body.channelId,
        groups: body.groups ?? [],
        enabled: body.enabled ?? true,
        order: body.order ?? undefined,
    }

    const idx = config.streamers.findIndex(
        s => s.channelId === streamer.channelId
    )

    if (idx >= 0) {
        config.streamers[idx] = streamer
    } else {
        config.streamers.push(streamer)
    }

    await kv.set(CONFIG_KEY, config)

    return NextResponse.json({ ok: true })
}

export async function PUT(req: Request) {
    requireAdmin(req)

    const config = await kv.get<StreamersConfig>(CONFIG_KEY)

    if (!config || !Array.isArray(config.streamers)) {
        return NextResponse.json({ error: "Config not found" }, { status: 404 })
    }

    let updated = 0
    let failed = 0

    const updatedStreamers = await Promise.all(
        config.streamers.map(async (streamer) => {
            try {
                const freshName = await fetchChannelName(streamer.channelId)

                if (freshName && freshName !== streamer.name) {
                    console.log(`Updated: ${streamer.name} → ${freshName}`)
                    updated++
                    return { ...streamer, name: freshName }
                }

                return streamer
            } catch (error) {
                console.error(`Failed to fetch name for ${streamer.channelId}:`, error)
                failed++
                return streamer
            }
        })
    )

    await kv.set(CONFIG_KEY, { ...config, streamers: updatedStreamers })

    return NextResponse.json({
        ok: true,
        updated,
        failed,
        total: config.streamers.length,
        message: `Refreshed ${config.streamers.length} streamers. Updated: ${updated}, Failed: ${failed}`
    })
}

export async function DELETE(req: Request) {
    requireAdmin(req)

    let body: any
    try {
        body = await req.json()
    } catch {
        return new Response("Invalid JSON body", { status: 400 })
    }

    const { channelId } = body
    if (!channelId || typeof channelId !== "string") {
        return new Response("channelId required", { status: 400 })
    }

    const config = await kv.get<StreamersConfig>(CONFIG_KEY)

    if (!config || !Array.isArray(config.streamers)) {
        return new Response("Config not found", { status: 404 })
    }

    const before = config.streamers.length

    const next = {
        ...config,
        streamers: config.streamers.filter(
            s => s.channelId !== channelId
        ),
    }

    if (next.streamers.length === before) {
        return new Response("Streamer not found", { status: 404 })
    }

    await kv.set(CONFIG_KEY, next)
    return NextResponse.json({ ok: true })
}


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

type StreamerPatch = Partial<Pick<StreamerConfig, "name" | "groups" | "enabled" | "order">> & {
    channelId: string
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

    let config: StreamersConfig =
        (await kv.get(CONFIG_KEY)) ?? {
            groups: ["A4A", "NMC", "EX"],
            streamers: [],
        }

    if (!config.groups.includes("EX")) {
        config = { ...config, groups: [...config.groups, "EX"] }
        await kv.set(CONFIG_KEY, config)
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

    let config: StreamersConfig =
        (await kv.get(CONFIG_KEY)) ?? {
            groups: ["A4A", "NMC", "EX"],
            streamers: [],
        }

    if (!config.groups.includes("EX")) {
        config = { ...config, groups: [...config.groups, "EX"] }
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

export async function PATCH(req: Request) {
    requireAdmin(req)

    const body = await req.json().catch(() => null)
    const rawUpdates = body?.updates

    if (!Array.isArray(rawUpdates)) {
        return NextResponse.json({ error: "updates must be an array" }, { status: 400 })
    }

    if (rawUpdates.length > 500) {
        return NextResponse.json({ error: "Too many updates in one request" }, { status: 413 })
    }

    const config = await kv.get<StreamersConfig>(CONFIG_KEY)

    if (!config || !Array.isArray(config.streamers)) {
        return NextResponse.json({ error: "Config not found" }, { status: 404 })
    }

    const patchByChannelId = new Map<string, StreamerPatch>()

    for (const item of rawUpdates) {
        if (!item || typeof item.channelId !== "string") continue

        const patch: StreamerPatch = { channelId: item.channelId }

        if (typeof item.name === "string") patch.name = item.name
        if (Array.isArray(item.groups)) patch.groups = item.groups
        if (typeof item.enabled === "boolean") patch.enabled = item.enabled
        if (typeof item.order === "number") patch.order = item.order

        patchByChannelId.set(item.channelId, patch)
    }

    if (!patchByChannelId.size) {
        return NextResponse.json({ error: "No valid updates provided" }, { status: 400 })
    }

    let updated = 0

    const nextStreamers = config.streamers.map((streamer) => {
        const patch = patchByChannelId.get(streamer.channelId)
        if (!patch) return streamer

        const next = {
            ...streamer,
            ...patch,
            channelId: streamer.channelId,
        }

        if (
            next.name !== streamer.name ||
            next.enabled !== streamer.enabled ||
            next.order !== streamer.order ||
            JSON.stringify(next.groups) !== JSON.stringify(streamer.groups)
        ) {
            updated++
        }

        return next
    })

    if (updated > 0) {
        await kv.set(CONFIG_KEY, { ...config, streamers: nextStreamers })
    }

    return NextResponse.json({
        ok: true,
        requested: patchByChannelId.size,
        updated,
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


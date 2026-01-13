import { NextResponse } from "next/server"
import { kv } from "@vercel/kv"

const CONFIG_KEY = "streamers:config"

type StreamerConfig = {
    name: string
    channelId: string
    groups: string[]
    enabled: boolean
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
    requireAdmin(req)

    const config: StreamersConfig =
        (await kv.get(CONFIG_KEY)) ?? {
            groups: ["A4A", "NMC"],
            streamers: [],
        }

    return NextResponse.json(config)
}

export async function POST(req: Request) {
    requireAdmin(req)

    const body = await req.json()

    const config: StreamersConfig =
        (await kv.get(CONFIG_KEY)) ?? {
            groups: ["A4A", "NMC"],
            streamers: [],
        }

    const streamer: StreamerConfig = {
        name: body.name,
        channelId: body.channelId,
        groups: body.groups ?? [],
        enabled: body.enabled ?? true,
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


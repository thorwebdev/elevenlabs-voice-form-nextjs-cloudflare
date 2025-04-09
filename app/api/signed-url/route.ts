import { NextResponse } from "next/server";
import { ElevenLabsClient } from "elevenlabs";
import { getRequestContext } from "@cloudflare/next-on-pages";

export interface Env {
  ELEVENLABS_AGENT_ID: string;
  ELEVENLABS_API_KEY: string;
}

export const runtime = "edge";

export async function GET() {
  const env = getRequestContext().env as Env;
  const agentId = env.ELEVENLABS_AGENT_ID;
  if (!agentId) {
    throw Error("ELEVENLABS_AGENT_ID is not set");
  }
  try {
    const client = new ElevenLabsClient();
    const response = await client.conversationalAi.getSignedUrl({
      agent_id: agentId,
    });
    return NextResponse.json({ signedUrl: response.signed_url });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: "Failed to get signed URL" },
      { status: 500 }
    );
  }
}

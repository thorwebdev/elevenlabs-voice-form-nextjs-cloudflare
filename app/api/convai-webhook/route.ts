import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
// import crypto from "node:crypto"; TODO: fix this
import { ElevenLabsClient } from "elevenlabs";
import { Resend } from "resend";
import { EmailTemplate } from "@/components/email/post-call-webhook-email";
import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

interface Env {
  RESEND_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_CONVAI_WEBHOOK_SECRET: string;
  ELEVENLABS_AGENT_ID: string;
  RESEND_FROM_EMAIL: string;
}

// Initialize Redis
// const redis = Redis.fromEnv(); TODO: replace with durable objects

export async function GET() {
  return NextResponse.json({ status: "webhook listening" }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const env = getRequestContext().env as Env;
  // Initialize Resend
  const resend = new Resend(env.RESEND_API_KEY);

  const elevenLabsClient = new ElevenLabsClient({
    apiKey: env.ELEVENLABS_API_KEY,
  });

  const secret = env.ELEVENLABS_CONVAI_WEBHOOK_SECRET; // Add this to your env variables
  const { event, error } = await constructWebhookEvent(req, secret);
  if (error) {
    return NextResponse.json({ error: error }, { status: 401 });
  }

  if (event.type === "post_call_transcription") {
    const { conversation_id, analysis, agent_id } = event.data;

    if (
      agent_id === env.ELEVENLABS_AGENT_ID &&
      analysis.evaluation_criteria_results.all_data_provided?.result ===
        "success" &&
      analysis.data_collection_results.voice_description?.value
    ) {
      try {
        // Design the voice
        // @ts-ignore https://github.com/elevenlabs/elevenlabs-js/issues/161
        const voicePreview = await elevenLabsClient.textToVoice.createPreviews({
          voice_description:
            analysis.data_collection_results.voice_description.value,
          text: "The night air carried whispers of betrayal, thick as London fog. I adjusted my cufflinks - after all, even spies must maintain appearances, especially when the game is afoot.",
          // seed: conversation_id,
        });
        const voice = await elevenLabsClient.textToVoice.createVoiceFromPreview(
          {
            voice_name: `voice-${conversation_id}`,
            voice_description: `Voice for ${conversation_id}`,
            generated_voice_id: voicePreview.previews[0].generated_voice_id,
          }
        );

        // Get the knowledge base from redis
        const redisRes = await getRedisDataWithRetry(conversation_id);
        if (!redisRes) throw new Error("Conversation data not found!");
        // Handle agent creation
        const agent = await elevenLabsClient.conversationalAi.createAgent({
          name: `Agent for ${conversation_id}`,
          conversation_config: {
            tts: { voice_id: voice.voice_id },
            agent: {
              prompt: {
                prompt:
                  analysis.data_collection_results.agent_description?.value ??
                  "You are a helpful assistant.",
                knowledge_base: redisRes.knowledgeBase,
              },
              first_message: "Hello, how can I help you today?",
            },
          },
        });
        console.log("Agent created", { agent: agent.agent_id });
        // Send email to user
        console.log("Sending email to", redisRes.email);
        await resend.emails.send({
          from: env.RESEND_FROM_EMAIL!,
          to: redisRes.email,
          subject: "Your Conversational AI agent is ready to chat!",
          react: EmailTemplate({ agentId: agent.agent_id }),
        });
      } catch (error) {
        console.error(error);
        return NextResponse.json({ error }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

const constructWebhookEvent = async (req: NextRequest, secret?: string) => {
  const body = await req.text();
  const signature_header = req.headers.get("ElevenLabs-Signature");

  if (!signature_header) {
    return { event: null, error: "Missing signature header" };
  }

  const headers = signature_header.split(",");
  const timestamp = headers.find((e) => e.startsWith("t="))?.substring(2);
  const signature = headers.find((e) => e.startsWith("v0="));

  if (!timestamp || !signature) {
    return { event: null, error: "Invalid signature format" };
  }

  // Validate timestamp
  const reqTimestamp = Number(timestamp) * 1000;
  const tolerance = Date.now() - 30 * 60 * 1000;
  if (reqTimestamp < tolerance) {
    return { event: null, error: "Request expired" };
  }

  // Validate hash
  const message = `${timestamp}.${body}`;

  if (!secret) {
    return { event: null, error: "Webhook secret not configured" };
  }

  const digest =
    "v0=" + crypto.createHmac("sha256", secret).update(message).digest("hex");

  if (signature !== digest) {
    return { event: null, error: "Invalid signature" };
  }

  const event = JSON.parse(body);
  return { event, error: null };
};

async function getRedisDataWithRetry(
  conversationId: string,
  maxRetries = 5
): Promise<{
  email: string;
  knowledgeBase: Array<{
    id: string;
    type: "file" | "url";
    name: string;
  }>;
} | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // const data = await redis.get(conversationId); TODO: replace with durable objects
      // return data as any;
      return {
        email: "test@test.com",
        knowledgeBase: [],
      };
    } catch (error) {
      if (attempt === maxRetries) throw error;
      console.log(`Redis get attempt ${attempt} failed, retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return null;
}

// SocialNow AI Hub - YouTube Transcript Edge Function
// Fetches YouTube video transcripts via the Innertube API (free, no API key needed)
// Deploy: supabase functions deploy youtube-transcript

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ============================================
// Step 1: Get caption tracks via Innertube /player
// ============================================
async function getCaptionTracks(videoId: string) {
  const response = await fetch(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "20.10.38",
            hl: "en",
          },
        },
        videoId,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`YouTube player API returned ${response.status}`);
  }

  const data = await response.json();

  // Extract video info
  const videoDetails = data.videoDetails || {};
  const title = videoDetails.title || "";
  const channel = videoDetails.author || "";
  const lengthSeconds = parseInt(videoDetails.lengthSeconds || "0");
  const thumbnail =
    videoDetails.thumbnail?.thumbnails?.slice(-1)[0]?.url || "";

  // Extract caption tracks
  const captionTracks =
    data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  if (captionTracks.length === 0) {
    return {
      videoDetails: { title, channel, lengthSeconds, thumbnail },
      captionTracks: [],
    };
  }

  return {
    videoDetails: { title, channel, lengthSeconds, thumbnail },
    captionTracks: captionTracks.map(
      (track: {
        baseUrl: string;
        languageCode: string;
        kind?: string;
        name?: { simpleText?: string };
      }) => ({
        baseUrl: track.baseUrl,
        languageCode: track.languageCode,
        kind: track.kind || "manual",
        name: track.name?.simpleText || track.languageCode,
      })
    ),
  };
}

// ============================================
// Step 2: Fetch transcript content from caption URL
// ============================================
async function fetchTranscriptContent(baseUrl: string) {
  // Add json3 format for structured JSON
  const url = baseUrl.includes("fmt=")
    ? baseUrl
    : `${baseUrl}&fmt=json3`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Caption fetch returned ${response.status}`);
  }

  const data = await response.json();

  // Parse events into transcript segments
  const segments: Array<{
    text: string;
    start: number;
    duration: number;
  }> = [];

  if (data.events) {
    for (const event of data.events) {
      if (!event.segs) continue;

      const text = event.segs
        .map((seg: { utf8?: string }) => seg.utf8 || "")
        .join("")
        .replace(/\n/g, " ")
        .trim();

      if (!text) continue;

      segments.push({
        text,
        start: Math.round((event.tStartMs || 0) / 1000 * 100) / 100,
        duration: Math.round((event.dDurationMs || 0) / 1000 * 100) / 100,
      });
    }
  }

  return segments;
}

// ============================================
// Step 3: Build full transcript text + summaries
// ============================================
function buildTranscriptText(
  segments: Array<{ text: string; start: number; duration: number }>
) {
  return segments.map((s) => s.text).join(" ");
}

function buildTimedTranscript(
  segments: Array<{ text: string; start: number; duration: number }>
) {
  return segments.map((s) => {
    const mins = Math.floor(s.start / 60);
    const secs = Math.floor(s.start % 60);
    const timestamp = `${mins}:${secs.toString().padStart(2, "0")}`;
    return `[${timestamp}] ${s.text}`;
  }).join("\n");
}

function extractKeyPoints(fullText: string): string[] {
  // Simple extraction: split into sentences and pick key ones
  const sentences = fullText
    .replace(/([.!?])\s/g, "$1|")
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 300);

  // Pick sentences that contain important keywords
  const importantKeywords = [
    "important", "key", "main", "essential", "critical", "must",
    "should", "need", "first", "best", "tip", "trick", "step",
    "belangrijk", "tip", "stap", "moet", "beste", "essentieel",
    "how to", "hoe", "waarom", "because", "therefore", "dus",
  ];

  const keyPointSentences = sentences.filter((sentence) => {
    const lower = sentence.toLowerCase();
    return importantKeywords.some((kw) => lower.includes(kw));
  });

  // Return top 5-10 key points, or first 5 sentences if no keywords match
  const points =
    keyPointSentences.length >= 3
      ? keyPointSentences.slice(0, 10)
      : sentences.slice(0, 5);

  return points;
}

function generateSummaries(fullText: string) {
  const words = fullText.split(/\s+/);
  const totalWords = words.length;

  // Short summary: first ~50 words
  const summaryShort =
    words.slice(0, 50).join(" ") + (totalWords > 50 ? "..." : "");

  // Medium summary: first ~150 words
  const summaryMedium =
    words.slice(0, 150).join(" ") + (totalWords > 150 ? "..." : "");

  // Detailed: first ~500 words
  const summaryDetailed =
    words.slice(0, 500).join(" ") + (totalWords > 500 ? "..." : "");

  return {
    summary_short: summaryShort,
    summary_medium: summaryMedium,
    summary_detailed: summaryDetailed,
  };
}

// ============================================
// Main handler
// ============================================
serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get video ID from query params or body
    let videoId: string | null = null;
    let lang = "en"; // preferred language

    if (req.method === "GET") {
      const url = new URL(req.url);
      videoId = url.searchParams.get("videoId") || url.searchParams.get("v");
      lang = url.searchParams.get("lang") || "en";
    } else if (req.method === "POST") {
      const body = await req.json();
      videoId = body.videoId || body.v;
      lang = body.lang || "en";
    }

    if (!videoId) {
      return new Response(
        JSON.stringify({ error: "Missing videoId parameter" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Clean video ID (extract from URL if needed)
    videoId = extractVideoId(videoId);

    if (!videoId) {
      return new Response(
        JSON.stringify({ error: "Invalid video ID or URL" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Step 1: Get caption tracks
    const { videoDetails, captionTracks } = await getCaptionTracks(videoId);

    if (captionTracks.length === 0) {
      return new Response(
        JSON.stringify({
          videoId,
          videoDetails,
          transcript: null,
          error: "No captions available for this video",
          available_languages: [],
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Step 2: Pick best caption track
    // Priority: manual in preferred lang > auto in preferred lang > manual in any > auto in any
    let selectedTrack = captionTracks.find(
      (t: { languageCode: string; kind: string }) =>
        t.languageCode === lang && t.kind !== "asr"
    );
    if (!selectedTrack) {
      selectedTrack = captionTracks.find(
        (t: { languageCode: string }) => t.languageCode === lang
      );
    }
    if (!selectedTrack) {
      selectedTrack = captionTracks.find(
        (t: { kind: string }) => t.kind !== "asr"
      );
    }
    if (!selectedTrack) {
      selectedTrack = captionTracks[0];
    }

    // Step 3: Fetch transcript
    const segments = await fetchTranscriptContent(selectedTrack.baseUrl);

    if (segments.length === 0) {
      return new Response(
        JSON.stringify({
          videoId,
          videoDetails,
          transcript: null,
          error: "Transcript is empty",
          available_languages: captionTracks.map(
            (t: { languageCode: string }) => t.languageCode
          ),
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Step 4: Build output
    const fullText = buildTranscriptText(segments);
    const timedTranscript = buildTimedTranscript(segments);
    const keyPoints = extractKeyPoints(fullText);
    const summaries = generateSummaries(fullText);

    const result = {
      videoId,
      videoDetails,
      language: selectedTrack.languageCode,
      captionType: selectedTrack.kind === "asr" ? "auto-generated" : "manual",
      segments,
      transcript: fullText,
      timed_transcript: timedTranscript,
      key_points: keyPoints,
      ...summaries,
      word_count: fullText.split(/\s+/).length,
      available_languages: captionTracks.map(
        (t: { languageCode: string; kind: string; name: string }) => ({
          code: t.languageCode,
          name: t.name,
          type: t.kind === "asr" ? "auto" : "manual",
        })
      ),
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Transcript fetch error:", message);

    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// ============================================
// Utility: Extract video ID from URL or ID string
// ============================================
function extractVideoId(input: string): string | null {
  // Already a video ID (11 chars)
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return input;
  }

  // Try parsing as URL
  try {
    const url = new URL(input);
    const hostname = url.hostname.replace("www.", "");

    if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      // /watch?v=ID
      const v = url.searchParams.get("v");
      if (v) return v;

      // /embed/ID or /shorts/ID
      const pathMatch = url.pathname.match(
        /\/(embed|shorts|v)\/([a-zA-Z0-9_-]{11})/
      );
      if (pathMatch) return pathMatch[2];
    }

    if (hostname === "youtu.be") {
      return url.pathname.slice(1).split("/")[0] || null;
    }
  } catch {
    // Not a valid URL
  }

  // Try regex as fallback
  const match = input.match(/(?:v=|\/)([\w-]{11})(?:\?|&|$|\/)/);
  return match ? match[1] : null;
}

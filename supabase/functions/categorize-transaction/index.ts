import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH_SIZE = 100;
const DEFAULT_MAX_TRANSACTIONS = 200;

const FALLBACK_CATEGORIES =
  "Income, Housing, Utilities & Phone, Groceries, Dining & Coffee, Transport & Auto, E-Transfer, Debt & Interest, Entertainment & Subs, Travel, Household & Shopping, Health & Wellness, Financial & Investing, Miscellaneous";

let cachedCategoriesString: string | null = null;
let cachedCategoriesDebug: { source: string; count: number; preview: string; url?: string } | null = null;

async function loadCategories(): Promise<{ categories: string; debug: { source: string; count: number; preview: string; url?: string } }> {
  if (cachedCategoriesString && cachedCategoriesDebug) {
    return { categories: cachedCategoriesString, debug: cachedCategoriesDebug };
  }
  const baseUrl = Deno.env.get("CATEGORIES_URL")?.replace(/\/$/, "");
  if (!baseUrl) {
    cachedCategoriesString = FALLBACK_CATEGORIES;
    const count = (FALLBACK_CATEGORIES.match(/,/g)?.length ?? 0) + 1;
    cachedCategoriesDebug = { source: "fallback", count, preview: FALLBACK_CATEGORIES.slice(0, 120) + "..." };
    return { categories: cachedCategoriesString, debug: cachedCategoriesDebug };
  }
  const categoriesUrl = `${baseUrl}/api/categories`;
  try {
    const res = await fetch(categoriesUrl);
    if (!res.ok) {
      throw new Error(`Categories API ${res.status}`);
    }
    const data = (await res.json()) as { categories?: { name: string }[] };
    const names = (data.categories ?? []).map((c) => c.name);
    cachedCategoriesString =
      names.length > 0 ? `${names.join(", ")}, Uncategorized` : "Uncategorized";
    cachedCategoriesDebug = {
      source: "api",
      count: names.length + 1,
      preview: cachedCategoriesString.slice(0, 200) + (cachedCategoriesString.length > 200 ? "..." : ""),
      url: categoriesUrl,
    };
    return { categories: cachedCategoriesString, debug: cachedCategoriesDebug };
  } catch (e) {
    cachedCategoriesString = FALLBACK_CATEGORIES;
    const count = (FALLBACK_CATEGORIES.match(/,/g)?.length ?? 0) + 1;
    cachedCategoriesDebug = {
      source: "fallback_after_error",
      count,
      preview: FALLBACK_CATEGORIES.slice(0, 120) + "...",
      url: categoriesUrl,
    };
    return { categories: cachedCategoriesString, debug: cachedCategoriesDebug };
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RequestBody {
  user_id?: string;
  max_transactions?: number;
}

interface TransactionRow {
  id: string;
  description: string;
  amount: number;
  date: string;
}

interface AiResultItem {
  id: string;
  category: string;
  clean_merchant: string;
  is_fixed_cost: boolean;
  confidence_score: number;
}

interface SummaryResponse {
  user_id: string;
  selected: number;
  updated: number;
  chunks: number;
  has_more: boolean;
  errors: string[];
  categories_debug?: { source: string; count: number; preview: string; url?: string };
  debug?: { first_chunk_raw: string; first_chunk_parsed: AiResultItem[] };
}

function jsonResponse(body: unknown, status: number, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...headers },
  });
}

function getLocationContext(province: string | null, address: string | null): string {
  const parts: string[] = [];
  if (address?.trim()) {
    const trimmed = address.trim();
    const cityMatch = trimmed.match(/^([^,]+)/);
    if (cityMatch) parts.push(cityMatch[1].trim());
  }
  if (province?.trim()) parts.push(province.trim());
  if (parts.length === 0) return "Canada";
  return `${parts.join(", ")}, Canada`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!apiKey || !supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        { error: "Missing required environment variables (GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)" },
        500
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
    }

    // Defensive body parsing: avoid req.json() on empty body (e.g. OPTIONS preflight
    // misrouted or runtime parsing) which can throw "Unexpected end of JSON input".
    const contentLength = req.headers.get("Content-Length");
    const rawBody = await req.text();
    if (contentLength === "0" || !rawBody || rawBody.trim() === "") {
      return jsonResponse({ error: "Invalid or empty JSON body" }, 400);
    }
    let body: RequestBody;
    try {
      body = JSON.parse(rawBody) as RequestBody;
    } catch {
      return jsonResponse({ error: "Invalid or empty JSON body" }, 400);
    }

    const userId = body?.user_id;
    if (!userId || typeof userId !== "string") {
      return jsonResponse({ error: "Missing or invalid user_id in request body" }, 400);
    }

    const authClient = anonKey
      ? createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
      : createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();
    if (authError || !user) {
      console.error("Auth failed:", authError?.message ?? "No user");
      return jsonResponse(
        { error: authError?.message ?? "Invalid or expired token" },
        401
      );
    }
    if (user.id !== userId) {
      return jsonResponse({ error: "user_id does not match authenticated user" }, 403);
    }

    const maxTransactions = Math.min(
      Math.max(1, Number(body.max_transactions) || DEFAULT_MAX_TRANSACTIONS),
      500
    );
    const errors: string[] = [];
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile } = await adminClient
      .from("profiles")
      .select("province, address")
      .eq("id", userId)
      .single();

    const locationContext = getLocationContext(
      profile?.province ?? null,
      profile?.address ?? null
    );

    const { data: rows, error: selectError } = await adminClient
      .from("transactions")
      .select("id, description, amount, date")
      .eq("user_id", userId)
      .or("category.is.null,category.eq.Uncategorized,category.eq.''")
      .order("date", { ascending: true })
      .limit(maxTransactions);

    if (selectError) {
      return jsonResponse({ error: selectError.message }, 500);
    }

    const transactions = (rows ?? []) as TransactionRow[];
    if (transactions.length === 0) {
      const { count } = await adminClient
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .or("category.is.null,category.eq.Uncategorized,category.eq.''");
      const { debug: categoriesDebug } = await loadCategories();
      return jsonResponse(
        {
          user_id: userId,
          selected: 0,
          updated: 0,
          chunks: 0,
          has_more: (count ?? 0) > 0,
          errors: [],
          categories_debug: categoriesDebug,
        } satisfies SummaryResponse,
        200
      );
    }

    const { categories, debug: categoriesDebug } = await loadCategories();
    const systemInstruction = `You are a Canadian Financial Analyst (bank-grade accuracy, conservative, compliance-minded) for the app 'Two Loonies'.
Your task is to categorize banking transactions.
Allowed categories (use exactly): ${categories}.
Merchant normalization: strip store numbers (e.g. #1234), terminal IDs, trailing location blobs; remove legal suffixes (Inc, Ltd, Corp, etc.).
Return a JSON array. Each element must have: "id" (exact UUID from input), "category", "clean_merchant", "is_fixed_cost" (boolean), "confidence_score" (number 0-1).
You MUST return the exact ID for each transaction. Do not omit any transaction.`;

    const chunks = chunk(transactions, BATCH_SIZE);
    const allResults: AiResultItem[] = [];
    let firstChunkRaw: string | null = null;
    let firstChunkParsed: AiResultItem[] | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const chunkRows = chunks[i];
      const prompt = `User location context: ${locationContext}

Categorize these transactions. Return a JSON array of objects with: id, category, clean_merchant, is_fixed_cost, confidence_score (0-1).

Transactions:
${chunkRows.map((t) => `- id: ${t.id}, description: "${t.description}", amount: ${t.amount}, date: ${t.date}`).join("\n")}`;

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          systemInstruction: { role: "user", parts: [{ text: systemInstruction }] },
          tools: [{ google_search: {} }],
        }),
      });

      const data = await response.json();
      if (data.error) {
        const errMsg = data.error.message ?? JSON.stringify(data.error);
        if (errMsg.includes("You exceeded your current quota") || (errMsg.includes("exceeded") && errMsg.includes("quota"))) {
          return jsonResponse(
            { error: "You exceeded your current quota. Please try again later." },
            429
          );
        }
        errors.push(`Chunk ${i + 1}: ${errMsg}`);
        for (const t of chunkRows) {
          allResults.push({
            id: t.id,
            category: "Uncategorized",
            clean_merchant: t.description?.slice(0, 255) ?? "Unknown",
            is_fixed_cost: false,
            confidence_score: 0,
          });
        }
        continue;
      }

      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      console.error(`[categorize-transaction] Chunk ${i + 1}/${chunks.length} raw length: ${rawText?.length ?? 0}`);
      if (rawText) {
        if (i === 0) firstChunkRaw = rawText;
        console.error(`[categorize-transaction] Chunk ${i + 1} raw response:`, rawText);
      }
      if (!rawText) {
        errors.push(`Chunk ${i + 1}: Empty model response`);
        for (const t of chunkRows) {
          allResults.push({
            id: t.id,
            category: "Uncategorized",
            clean_merchant: t.description?.slice(0, 255) ?? "Unknown",
            is_fixed_cost: false,
            confidence_score: 0,
          });
        }
        continue;
      }

      const cleaned = rawText.replace(/```json|```/g, "").trim();
      let parsed: AiResultItem[];
      try {
        const parsedUnknown = JSON.parse(cleaned) as unknown;
        if (Array.isArray(parsedUnknown)) {
          parsed = parsedUnknown as AiResultItem[];
        } else if (parsedUnknown && typeof parsedUnknown === "object") {
          const arr = (parsedUnknown as Record<string, unknown>).results
            ?? (parsedUnknown as Record<string, unknown>).transactions
            ?? (parsedUnknown as Record<string, unknown>).data
            ?? (parsedUnknown as Record<string, unknown>).categorizations
            ?? Object.values(parsedUnknown).find((v) => Array.isArray(v));
          parsed = Array.isArray(arr) ? (arr as AiResultItem[]) : [];
        } else {
          parsed = [];
        }
        if (i === 0) {
          firstChunkRaw = rawText;
          firstChunkParsed = parsed;
        }
        console.error(`[categorize-transaction] Chunk ${i + 1} parsed ${parsed.length} items:`, JSON.stringify(parsed));
        if (parsed.length === 0) {
          errors.push(`Chunk ${i + 1}: No array in response`);
          for (const t of chunkRows) {
            allResults.push({
              id: t.id,
              category: "Uncategorized",
              clean_merchant: t.description?.slice(0, 255) ?? "Unknown",
              is_fixed_cost: false,
              confidence_score: 0,
            });
          }
          continue;
        }
      } catch (e) {
        errors.push(`Chunk ${i + 1}: Invalid JSON - ${String(e)}`);
        for (const t of chunkRows) {
          allResults.push({
            id: t.id,
            category: "Uncategorized",
            clean_merchant: t.description?.slice(0, 255) ?? "Unknown",
            is_fixed_cost: false,
            confidence_score: 0,
          });
        }
        continue;
      }

      const idSet = new Set(chunkRows.map((r) => r.id));
      for (const item of parsed) {
        const row = chunkRows.find((r) => r.id === item.id);
        const score = typeof item.confidence_score === "number" ? item.confidence_score : 0;
        const category =
          typeof item.category === "string" && item.category.trim()
            ? item.category.trim()
            : "Uncategorized";
        const cleanMerchant =
          typeof item.clean_merchant === "string" && item.clean_merchant.trim()
            ? item.clean_merchant.trim().slice(0, 255)
            : row?.description?.slice(0, 255) ?? "Unknown";
        const isFixedCost = Boolean(item.is_fixed_cost);
        allResults.push({
          id: item.id,
          category,
          clean_merchant: cleanMerchant,
          is_fixed_cost: isFixedCost,
          confidence_score: score,
        });
        idSet.delete(item.id);
      }
      for (const missingId of idSet) {
        const t = chunkRows.find((r) => r.id === missingId);
        allResults.push({
          id: missingId,
          category: "Uncategorized",
          clean_merchant: t?.description?.slice(0, 255) ?? "Unknown",
          is_fixed_cost: false,
          confidence_score: 0,
        });
      }
    }

    const txById = new Map(transactions.map((t) => [t.id, t]));
    const updates = allResults.map((r) => {
      const tx = txById.get(r.id);
      return {
        id: r.id,
        user_id: userId,
        date: tx?.date ?? "",
        description: tx?.description ?? "Unknown",
        amount: tx?.amount ?? 0,
        category: r.category,
        clean_merchant: r.clean_merchant,
        is_fixed_cost: r.is_fixed_cost,
        needs_review: r.confidence_score < 0.7,
      };
    });

    if (updates.length > 0) {
      const { error: upsertError } = await adminClient
        .from("transactions")
        .upsert(updates, { onConflict: "id" });

      if (upsertError) {
        return jsonResponse({ error: upsertError.message }, 500);
      }
    }

    const { count: remainingCount } = await adminClient
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .or("category.is.null,category.eq.Uncategorized,category.eq.''");

    const summary: SummaryResponse = {
      user_id: userId,
      selected: transactions.length,
      updated: updates.length,
      chunks: chunks.length,
      has_more: (remainingCount ?? 0) > 0,
      errors,
      categories_debug: categoriesDebug,
      debug:
        firstChunkRaw != null
          ? { first_chunk_raw: firstChunkRaw, first_chunk_parsed: firstChunkParsed ?? [] }
          : undefined,
    };

    return jsonResponse(summary, 200);
  } catch (err) {
    console.error("categorize-transaction error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500
    );
  }
});

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

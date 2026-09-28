import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
const serviceHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...serviceHeaders, ...(init.headers || {}) } });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
  return text ? JSON.parse(text) : null;
}

async function authenticatedUser(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: authorization } });
  if (!response.ok) throw new Error("A munkamenet nem érvényes.");
  return response.json();
}

async function profileFor(userId: string) {
  const rows = await rest(`profiles?id=eq.${encodeURIComponent(userId)}&select=id,display_name,role&limit=1`);
  if (!rows?.[0]) throw new Error("A felhasználói profil nem található.");
  return rows[0];
}

function manager(profile: any) {
  return profile.role === "manager" && ["Ági", "Tamás"].includes(profile.display_name);
}

function validSubscription(value: any) {
  return value && typeof value.endpoint === "string" && value.endpoint.startsWith("https://") &&
    typeof value.keys?.p256dh === "string" && value.keys.p256dh.length > 20 &&
    typeof value.keys?.auth === "string" && value.keys.auth.length > 8;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return Response.json({ error: "Nem támogatott kérés." }, { status: 405, headers: corsHeaders });
  try {
    const user = await authenticatedUser(request);
    const profile = await profileFor(user.id);
    const body = await request.json();
    const action = body?.action;

    if (action === "public-key") {
      if (!manager(profile)) return Response.json({ error: "Nincs jogosultság." }, { status: 403, headers: corsHeaders });
      const [keys] = await rest("rpc/cash_get_web_push_secrets", { method: "POST", body: "{}" });
      if (!keys?.public_key) throw new Error("Az értesítési kulcs nem érhető el.");
      return Response.json({ publicKey: keys.public_key }, { headers: corsHeaders });
    }

    if (action === "subscribe") {
      if (!manager(profile)) return Response.json({ error: "Nincs jogosultság." }, { status: 403, headers: corsHeaders });
      const subscription = body?.subscription;
      if (!validSubscription(subscription)) return Response.json({ error: "Az értesítési adatok hibásak." }, { status: 400, headers: corsHeaders });
      await rest("cash_push_subscriptions?on_conflict=endpoint", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ owner_id: user.id, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, device_name: String(body?.deviceName || "").slice(0, 180), enabled: true, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      });
      return Response.json({ subscribed: true }, { headers: corsHeaders });
    }

    if (action !== "alert") return Response.json({ error: "Ismeretlen művelet." }, { status: 400, headers: corsHeaders });
    if (manager(profile)) return Response.json({ ignored: true }, { headers: corsHeaders });

    const attempt = body?.attempt || {};
    const attemptedAction = attempt.action === "update" ? "update" : attempt.action === "create" ? "create" : "";
    const entryDate = String(attempt.entryDate || "");
    const direction = attempt.direction === "income" ? "income" : attempt.direction === "expense" ? "expense" : "";
    const amount = Number(attempt.amount);
    if (!attemptedAction || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || !direction || !Number.isSafeInteger(amount) || amount <= 0) return Response.json({ error: "A mentési kísérlet adatai hibásak." }, { status: 400, headers: corsHeaders });
    const protectedDate = await rest("rpc/cash_date_requires_override", { method: "POST", body: JSON.stringify({ p_date: entryDate }) });
    if (protectedDate !== true) return Response.json({ ignored: true }, { headers: corsHeaders });

    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const recent = await rest(`cash_protected_date_attempts?actor_id=eq.${encodeURIComponent(user.id)}&entry_date=eq.${entryDate}&attempted_action=eq.${attemptedAction}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`);
    if (recent?.length) return Response.json({ duplicate: true }, { headers: corsHeaders });

    await rest("cash_protected_date_attempts", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ actor_id: user.id, actor_name: profile.display_name, attempted_action: attemptedAction, entry_date: entryDate, direction, amount }) });

    const [keys] = await rest("rpc/cash_get_web_push_secrets", { method: "POST", body: "{}" });
    if (!keys?.public_key || !keys?.private_key) throw new Error("A Web Push kulcsok hiányoznak.");
    webpush.setVapidDetails("https://agnesgeller.github.io/kassza/", keys.public_key, keys.private_key);
    const profiles = await rest("profiles?role=eq.manager&select=id,display_name,role");
    const managerIds = (profiles || []).filter(manager).map((item: any) => item.id);
    if (!managerIds.length) return Response.json({ logged: true, delivered: 0 }, { headers: corsHeaders });
    const subscriptions = await rest(`cash_push_subscriptions?owner_id=in.(${managerIds.join(",")})&enabled=eq.true&select=id,endpoint,p256dh,auth`);
    const verb = attemptedAction === "update" ? "módosítani" : "rögzíteni";
    const kind = direction === "income" ? "bevételt" : "kiadást";
    let delivered = 0;
    for (const subscription of subscriptions || []) {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ title: "Kassza – védett dátum", body: `${profile.display_name} ${entryDate} dátummal próbált ${kind} ${verb} (${amount.toLocaleString("hu-HU")} Ft). A mentéshez vezetői PIN szükséges.`, url: "./", tag: `cash-protected-${user.id}-${entryDate}` }), { TTL: 3600, urgency: "high" });
        delivered += 1;
      } catch (error: any) {
        const status = Number(error?.statusCode || 0);
        if (status === 404 || status === 410) await rest(`cash_push_subscriptions?id=eq.${subscription.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ enabled: false, updated_at: new Date().toISOString() }) });
      }
    }
    return Response.json({ logged: true, delivered }, { headers: corsHeaders });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "A Kassza-értesítés feldolgozása sikertelen." }, { status: 500, headers: corsHeaders });
  }
});

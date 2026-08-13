(function () {
  const PROFILE_KEY = "diszkertek-kassza-profile-v1";
  const EMAILS = {
    "Ági": "agi@kassza.diszkertek.hu", "Bendegúz": "bendeguz@kassza.diszkertek.hu",
    "Marci": "marci@kassza.diszkertek.hu", "Márk": "mark@kassza.diszkertek.hu",
    "Tamás": "tamas@kassza.diszkertek.hu"
  };
  let client = null, channel = null;
  const config = window.KASSZA_SUPABASE || {};
  const configured = Boolean(config.url && config.publishableKey && !config.url.startsWith("IDE_"));
  if (configured && window.supabase) client = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  const mapEntry = row => ({ id: row.id, userId: row.user_id, leader: row.leader_name,
    direction: row.direction, category: row.category, transferType: row.transfer_type,
    designation: row.designation, receipt: row.receipt, date: row.entry_date,
    amount: Number(row.amount), partner: row.partner, address: row.address, note: row.note,
    createdAt: row.created_at, updatedAt: row.updated_at });
  const toRow = (item, userId) => ({ user_id: userId, leader_name: item.leader,
    direction: item.direction, category: item.category, transfer_type: item.transferType || "",
    designation: item.designation || "", receipt: item.receipt || "", entry_date: item.date,
    amount: Number(item.amount), partner: item.partner || "", address: item.address || "", note: item.note || "" });

  async function profileFor(user) {
    const { data, error } = await client.from("profiles").select("id,display_name,role").eq("id", user.id).single();
    if (error) throw error;
    const profile = { userId: data.id, name: data.display_name, role: data.role };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    return profile;
  }
  window.KasszaDB = {
    configured,
    async login(name, pin) {
      if (!client) throw new Error("A Supabase kapcsolat még nincs beállítva.");
      const { data, error } = await client.auth.signInWithPassword({ email: EMAILS[name], password: pin });
      if (error) throw new Error("Hibás PIN-kód.");
      return profileFor(data.user);
    },
    async restore() {
      if (!client) return null;
      const { data } = await client.auth.getSession();
      if (!data.session) { localStorage.removeItem(PROFILE_KEY); return null; }
      try {
        const cached = JSON.parse(localStorage.getItem(PROFILE_KEY));
        if (cached?.userId === data.session.user.id) return cached;
      } catch (_) { localStorage.removeItem(PROFILE_KEY); }
      return profileFor(data.session.user);
    },
    async logout() { if (channel) await client.removeChannel(channel); channel = null; localStorage.removeItem(PROFILE_KEY); if (client) await client.auth.signOut(); },
    async list() { const { data, error } = await client.from("entries").select("*").order("entry_date", { ascending: false }).order("created_at", { ascending: false }); if (error) throw error; return data.map(mapEntry); },
    async create(item, userId) { const { data, error } = await client.from("entries").insert(toRow(item, userId)).select().single(); if (error) throw error; return mapEntry(data); },
    async update(id, item, userId) { const row=toRow(item,userId); delete row.user_id; delete row.leader_name; const { data, error } = await client.from("entries").update(row).eq("id",id).select().single(); if (error) throw error; return mapEntry(data); },
    async remove(id) { const { error } = await client.from("entries").delete().eq("id",id); if (error) throw error; },
    subscribe(onChange) { if (!client) return; channel=client.channel("kassza-live").on("postgres_changes",{event:"*",schema:"public",table:"entries"},onChange).subscribe(); }
  };
})();

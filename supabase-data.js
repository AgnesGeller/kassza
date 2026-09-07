(function () {
  const PROFILE_KEY = "diszkertek-kassza-profile-v1";
  const EMAILS = {
    "Ági": "agi@kassza.diszkertek.hu", "Bendegúz": "bendeguz@kassza.diszkertek.hu",
    "Ádám": "adam@kassza.diszkertek.hu", "Márk": "mark@kassza.diszkertek.hu",
    "Tamás": "tamas@kassza.diszkertek.hu"
  };
  const MANAGERS = new Set(["Ági", "Tamás"]);
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
    sourceType: row.source_type || "", sourceId: row.source_id || "",
    createdAt: row.created_at, updatedAt: row.updated_at });
  const toRow = (item, userId) => ({ user_id: userId, leader_name: item.leader,
    direction: item.direction, category: item.category, transfer_type: item.transferType || "",
    designation: item.designation || "", receipt: item.receipt || "", entry_date: item.date,
    amount: Number(item.amount), partner: item.partner || "", address: item.address || "", note: item.note || "" });
  function profileFrom(name,userId){const profile={userId,name,role:MANAGERS.has(name)?"manager":"worker"};localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));return profile;}

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
      return profileFrom(name,data.user.id);
    },
    async profiles(){const {data,error}=await client.from("profiles").select("id,display_name,role").order("display_name");if(error)throw error;return data.map(item=>({userId:item.id,name:item.display_name,role:item.role}));},
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
    async list() { const [{data,error},linksResult]=await Promise.all([client.from("entries").select("*").order("entry_date",{ascending:false}).order("created_at",{ascending:false}),client.rpc("list_recurring_cash_entry_links")]);if(error)throw error;const linked=new Map((linksResult.error?[]:linksResult.data||[]).map(item=>[item.entry_id,item.expense_code]));return data.map(row=>{const entry=mapEntry(row);if(linked.has(entry.id)){entry.sourceType="recurring_expense";entry.sourceId=linked.get(entry.id);}return entry;}); },
    async create(item, userId, overridePin="") { const row=toRow(item,userId);const {data,error}=overridePin?await client.rpc("save_historical_cash_entry",{p_entry_id:null,p_user_id:userId,p_leader_name:item.leader,p_entry:row,p_pin:overridePin}):await client.from("entries").insert(row).select().single();if(error)throw error;return mapEntry(data); },
    async update(id, item, userId, overridePin="") { const row=toRow(item,userId);delete row.user_id;delete row.leader_name;const {data,error}=overridePin?await client.rpc("save_historical_cash_entry",{p_entry_id:id,p_user_id:userId,p_leader_name:item.leader,p_entry:row,p_pin:overridePin}):await client.from("entries").update(row).eq("id",id).select().single();if(error)throw error;return mapEntry(data); },
    async remove(id, overridePin="") { const {error}=overridePin?await client.rpc("delete_historical_cash_entry",{p_entry_id:id,p_pin:overridePin}):await client.from("entries").delete().eq("id",id);if(error)throw error; },
    async ensureRecurringExpenses() { const {data,error}=await client.rpc("generate_recurring_cash_expenses_for_cash");if(error)throw error;return Number(data||0); },
    async recurringExpenses() { const {data,error}=await client.rpc("list_recurring_cash_expenses");if(error)throw error;return (data||[]).map(row=>({code:row.code,designation:row.designation,category:row.category,note:row.note,amount:Number(row.amount),startMonth:row.start_month,active:row.active,updatedAt:row.updated_at})); },
    async saveRecurringExpense(rule) { const {data,error}=await client.rpc("save_recurring_cash_expense",{p_code:rule.code||null,p_designation:rule.designation,p_category:rule.category,p_note:rule.note||"",p_amount:Number(rule.amount),p_start_month:rule.startMonth,p_active:rule.active});if(error)throw error;return data; },
    async removeRecurringExpense(code) { const {error}=await client.rpc("delete_recurring_cash_expense",{p_code:code});if(error)throw error; },
    subscribe(onChange) { if (!client) return; if(channel)client.removeChannel(channel);channel=client.channel("kassza-live").on("postgres_changes",{event:"*",schema:"public",table:"entries"},onChange).subscribe(); }
  };
})();

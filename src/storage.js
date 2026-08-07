// Drop-in replacement for the window.storage API that Shiftly's code already calls
// (window.storage.get/set/delete/list). Nothing in App.jsx needs to change.
//
// - shared === true  -> stored in Supabase (a real cloud table everyone reads/writes)
// - shared === false -> stored in this browser's localStorage (per-device only, e.g.
//   "which employee is logged in on this phone", "is sound muted here")
//
// This file has a side effect: importing it defines `window.storage`. Import it once,
// before rendering the app (see main.jsx).

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

if (!supabase) {
  // eslint-disable-next-line no-console
  console.error(
    "Shiftly: missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. " +
      "Shared data (attendance, users, settings) will not save. Check your .env file."
  );
}

const TABLE = "kv_store";

function localGet(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    return { key, value: raw, shared: false };
  } catch {
    return null;
  }
}

function localSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return { key, value, shared: false };
  } catch {
    return null;
  }
}

function localDelete(key) {
  try {
    window.localStorage.removeItem(key);
    return { key, deleted: true, shared: false };
  } catch {
    return null;
  }
}

async function remoteGet(key) {
  if (!supabase) return null;
  const { data, error } = await supabase.from(TABLE).select("value").eq("key", key).maybeSingle();
  if (error || !data) return null;
  return { key, value: data.value, shared: true };
}

async function remoteSet(key, value) {
  if (!supabase) return null;
  const { error } = await supabase.from(TABLE).upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) {
    // eslint-disable-next-line no-console
    console.error("Shiftly storage set failed:", error.message);
    return null;
  }
  return { key, value, shared: true };
}

async function remoteDelete(key) {
  if (!supabase) return null;
  const { error } = await supabase.from(TABLE).delete().eq("key", key);
  if (error) return null;
  return { key, deleted: true, shared: true };
}

async function remoteList(prefix) {
  if (!supabase) return null;
  let query = supabase.from(TABLE).select("key");
  if (prefix) query = query.like("key", `${prefix}%`);
  const { data, error } = await query;
  if (error) return null;
  return { keys: (data || []).map((r) => r.key), prefix, shared: true };
}

window.storage = {
  async get(key, shared = false) {
    return shared ? remoteGet(key) : localGet(key);
  },
  async set(key, value, shared = false) {
    return shared ? remoteSet(key, value) : localSet(key, value);
  },
  async delete(key, shared = false) {
    return shared ? remoteDelete(key) : localDelete(key);
  },
  async list(prefix, shared = false) {
    return shared ? remoteList(prefix) : null; // not used by this app
  },
};

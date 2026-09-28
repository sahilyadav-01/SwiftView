/**
 * Supabase Client & Backend Integration Helper
 * Provides database persistence, fleet registration, and session logging for SwiftView.
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

let supabase = null;

if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
    console.log('[Supabase] Client initialized successfully for URL:', supabaseUrl);
  } catch (err) {
    console.warn('[Supabase] Initialization failed:', err.message);
  }
} else {
  console.log('[Supabase] No SUPABASE_URL / key found. Running in standalone local mode.');
}

/**
 * Register or update device status in Supabase
 */
async function syncDevicePresence(publicId, meta = {}, status = 'online') {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('devices')
      .upsert({
        public_id: publicId,
        name: meta.name || 'Remote Host',
        hostname: meta.hostname || meta.name || 'localhost',
        platform: meta.os || 'Windows',
        agent_version: meta.agentVersion || '0.2.0',
        status: status,
        last_seen_at: new Date().toISOString()
      }, { onConflict: 'public_id' })
      .select()
      .single();

    if (error) {
      console.warn('[Supabase] Failed to sync device:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('[Supabase] Device sync exception:', err.message);
    return null;
  }
}

/**
 * Log an immutable security audit event
 */
async function logAuditEvent({ action, actorType = 'system', actorId = null, deviceId = null, sessionId = null, outcome = 'success', metadata = {}, ipAddress = null }) {
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('audit_events')
      .insert({
        action,
        actor_type: actorType,
        actor_id: actorId,
        device_id: deviceId,
        session_id: sessionId,
        outcome,
        ip_address: ipAddress,
        correlation_id: crypto.randomUUID ? crypto.randomUUID() : undefined,
        metadata
      });
    if (error) {
      console.warn('[Supabase] Audit event error:', error.message);
    }
  } catch (err) {
    console.warn('[Supabase] Audit logging exception:', err.message);
  }
}

module.exports = {
  supabase,
  isConfigured: () => !!supabase,
  syncDevicePresence,
  logAuditEvent
};

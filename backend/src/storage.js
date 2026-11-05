import { config } from './config.js';
import { supabaseAdmin } from './supabase.js';

const bucket = () => supabaseAdmin.storage.from(config.statementBucket);

/** Make sure the private bucket for uploaded fee statements exists (called once at start-up). */
export async function ensureStatementBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(config.statementBucket);
  if (data) return;
  const { error } = await supabaseAdmin.storage.createBucket(config.statementBucket, {
    public: false, // statements are personal financial documents: only reachable through short-lived signed links
    fileSizeLimit: config.maxStatementBytes,
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

export async function saveStatementFile(path, buffer, contentType) {
  const { error } = await bucket().upload(path, buffer, { contentType, upsert: false });
  if (error) throw error;
}

/** A link to a stored statement that stops working after `seconds`. */
export async function statementSignedUrl(path, seconds = 300) {
  const { data, error } = await bucket().createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
}

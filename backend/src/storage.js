import { config } from './config.js';
import { supabaseAdmin } from './supabase.js';

const bucket = () => supabaseAdmin.storage.from(config.statementBucket);

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

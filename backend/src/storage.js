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

const ticketEvidenceBucket = () => supabaseAdmin.storage.from('ticket-evidence');

export async function saveTicketEvidenceFile(path, buffer, contentType) {
  const { error } = await ticketEvidenceBucket().upload(path, buffer, { contentType, upsert: false });
  if (error) throw error;
}

export async function removeTicketEvidenceFile(path) {
  const { error } = await ticketEvidenceBucket().remove([path]);
  if (error) throw error;
}

export async function ticketEvidenceSignedUrl(path, seconds = 300) {
  const { data, error } = await ticketEvidenceBucket().createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
}

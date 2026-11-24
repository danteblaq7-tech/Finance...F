const actions = new Set([
  'ticket_response_added',
  'ticket_assignment_changed',
  'staff_account_created',
  'staff_role_changed',
  'staff_deactivated',
  'staff_reactivated',
  'student_deactivated',
  'student_reactivated',
  'student_password_reset_requested',
  'fee_records_imported',
  'fee_exception_granted',
  'exam_card_approved',
  'exam_card_revoked',
]);

export async function auditStaffAction(client, { actorId, action, entityType, entityId, metadata = {} }) {
  if (!actions.has(action)) throw new Error('Unsupported staff audit action.');
  await client.query(
    `INSERT INTO public.staff_action_audit_log
       (actor_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actorId, action, entityType, entityId, JSON.stringify(metadata)],
  );
}

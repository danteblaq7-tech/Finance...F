// The rules that turn fee figures into "approve / deny / needs a human".
// Pure functions: the same rules are mirrored in SQL (trg_application_reconcile in schema.sql) for official fee records.

export const ksh = (n) => `KSh ${Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

/**
 * Is a student cleared for exams on these figures?
 * Cleared when nothing is owed, or when they have paid at least `minPercent` % of the total fee.
 * @returns {{ cleared: boolean|null, paidPercent: number|null }}  cleared === null means "can't tell from these figures"
 */
export function evaluateFigures({ totalFee, amountPaid, balance }, minPercent = 100) {
  const paidPercent = totalFee > 0 && amountPaid !== null ? (amountPaid / totalFee) * 100 : null;
  if (balance !== null && balance <= 0) return { cleared: true, paidPercent };
  if (totalFee > 0 && amountPaid !== null) return { cleared: amountPaid * 100 >= totalFee * minPercent, paidPercent };
  // Only a balance is known. With a 100% requirement any balance owed means "not cleared"; otherwise we can't tell.
  if (balance !== null && minPercent >= 100) return { cleared: false, paidPercent };
  return { cleared: null, paidPercent };
}

export function rejectionMessage({ totalFee, amountPaid, balance }, minPercent, paidPercent) {
  const parts = [`Your fee statement shows an outstanding balance of ${ksh(balance)}`];
  if (totalFee > 0 && amountPaid !== null) {
    parts.push(` (paid ${ksh(amountPaid)} of ${ksh(totalFee)}, ${Math.floor(paidPercent ?? 0)}%)`);
  }
  parts.push(
    minPercent >= 100
      ? '. Your fees must be fully cleared for this exam period.'
      : `. At least ${minPercent}% of fees must be paid for this exam period.`,
    ' Please pay, then upload a new statement and re-apply.',
  );
  return parts.join('');
}

/**
 * Decide an application from an UPLOADED statement (used only when the finance office has no official record
 * for this student and term; an official record always wins).
 *
 * mode 'verify' (default): a statement can DENY on its own, but a statement that looks cleared only moves the application
 *                          to "pending" for the finance office to verify. A forged PDF therefore can't print a card.
 * mode 'trust':            a cleared statement for the right student/period is approved immediately (card marked provisional).
 *
 * @returns {{ status: 'approved'|'rejected'|'pending', reason: string|null, note: string|null, needsReview: boolean,
 *             outcome: 'cleared'|'not_cleared'|'needs_review' }}
 */
export function decideFromStatement({ parsed, flags, minPercent, mode = 'verify', identity }) {
  const figures = { totalFee: parsed.totalFee, amountPaid: parsed.amountPaid, balance: parsed.balance };
  const review = (note, outcome = 'needs_review') => ({ status: 'pending', reason: null, note, needsReview: true, outcome });

  if (parsed.balance === null && parsed.totalFee === null) {
    return review('We could not read the figures on your statement automatically. The finance office will review it.');
  }
  if (flags.includes('inconsistent') || flags.includes('wrong_period')) {
    return review(
      flags.includes('wrong_period')
        ? 'Your statement does not appear to be for this academic year. The finance office will review it.'
        : 'The figures on your statement do not add up. The finance office will review it.',
    );
  }

  const { cleared, paidPercent } = evaluateFigures(figures, minPercent);
  if (cleared === null) return review('We could not work out your payment percentage from the statement. The finance office will review it.');

  if (!cleared) {
    return { status: 'rejected', reason: rejectionMessage(figures, minPercent, paidPercent), note: null, needsReview: false, outcome: 'not_cleared' };
  }
  if (mode === 'trust' && identity === 'matched') {
    return {
      status: 'approved',
      reason: null,
      note: 'Cleared from your uploaded fee statement. Your card is provisional until the finance office verifies the statement.',
      needsReview: false,
      outcome: 'cleared',
    };
  }
  return review('Your statement shows your fees are cleared. The finance office will verify it before your card is released.', 'cleared');
}

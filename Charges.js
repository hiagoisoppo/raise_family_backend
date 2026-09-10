/**
 * Rai$e Family — Charges.gs
 *
 * Gerencia cobranças de terceiros ("cobranças que devo realizar") de
 * forma totalmente isolada do restante do sistema — não referencia nem é
 * referenciado por TRANSACTION, RESERVE, CATEGORY ou qualquer outra
 * entidade existente.
 *
 * DECISÃO DE DESIGN: assim como o saldo de uma reserva, o "valor pago até
 * o momento" de uma cobrança NUNCA é um campo editável diretamente — ele é
 * sempre derivado da soma dos lançamentos ativos em CHARGE_PAYMENT. Isso
 * evita o mesmo problema que já resolvemos nas Reservas: um número solto
 * que alguém edita à mão e que pode ficar dessincronizado do histórico
 * real de pagamentos recebidos.
 */

function getCharges_() {
  const charges = readAll_('CHARGE').filter((c) => c.charge_deleted !== true);
  const payments = readAll_('CHARGE_PAYMENT').filter((p) => p.charge_payment_deleted !== true);

  const enriched = charges.map((charge) => {
    const chargePayments = payments.filter((p) => String(p.charge_id) === String(charge.charge_id));
    const paidValue = chargePayments.reduce((sum, p) => sum + (Number(p.charge_payment_value) || 0), 0);
    const lastPaymentDate = chargePayments.reduce((latest, p) => {
      return (!latest || p.charge_payment_date > latest) ? p.charge_payment_date : latest;
    }, '');

    return Object.assign({}, charge, {
      charge_paid_value: paidValue,
      charge_last_payment_date: lastPaymentDate || '',
      charge_status: paidValue >= Number(charge.charge_total_value) ? 'paid' : 'open'
    });
  });

  stripInternalFields_(enriched);
  return successResponse_(enriched);
}

function getChargePayments_(payload) {
  if (!payload.charge_id) return errorResponse_('ID da cobrança é obrigatório.');

  const rows = readAll_('CHARGE_PAYMENT').filter((p) =>
    String(p.charge_id) === String(payload.charge_id) && p.charge_payment_deleted !== true
  );

  rows.sort((a, b) => (a.charge_payment_date < b.charge_payment_date ? 1 : -1));
  stripInternalFields_(rows);
  return successResponse_(rows);
}

function createCharge_(payload) {
  const description = (payload.charge_description || '').trim();
  if (!description) return errorResponse_('Descrição é obrigatória.');

  const debtorName = (payload.charge_debtor_name || '').trim();
  if (!debtorName) return errorResponse_('Nome do devedor é obrigatório.');

  const totalValue = Number(payload.charge_total_value);
  if (!totalValue || totalValue <= 0) return errorResponse_('O valor total da dívida deve ser maior que zero.');

  const id = getNextId_('next_charge_id');
  appendRow_('CHARGE', {
    charge_id: id,
    charge_description: description,
    charge_debtor_name: debtorName,
    charge_debtor_contact: payload.charge_debtor_contact || '',
    charge_total_value: totalValue,
    charge_due_date: payload.charge_due_date || '',
    charge_created_date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    charge_notes: payload.charge_notes || '',
    charge_color: payload.charge_color || '#ef4444',
    charge_icon: payload.charge_icon || 'invoice',
    charge_deleted: false
  });

  return successResponse_({ charge_id: id }, 'Cobrança criada com sucesso.');
}

function updateCharge_(payload) {
  if (!payload.charge_id) return errorResponse_('ID da cobrança é obrigatório.');

  const updates = {};
  if (payload.charge_description !== undefined) {
    const description = String(payload.charge_description).trim();
    if (!description) return errorResponse_('Descrição não pode ficar vazia.');
    updates.charge_description = description;
  }
  if (payload.charge_debtor_name !== undefined) {
    const debtorName = String(payload.charge_debtor_name).trim();
    if (!debtorName) return errorResponse_('Nome do devedor não pode ficar vazio.');
    updates.charge_debtor_name = debtorName;
  }
  if (payload.charge_debtor_contact !== undefined) updates.charge_debtor_contact = payload.charge_debtor_contact;
  if (payload.charge_total_value !== undefined) {
    const totalValue = Number(payload.charge_total_value);
    if (!totalValue || totalValue <= 0) return errorResponse_('O valor total da dívida deve ser maior que zero.');
    updates.charge_total_value = totalValue;
  }
  if (payload.charge_due_date !== undefined) updates.charge_due_date = payload.charge_due_date;
  if (payload.charge_notes !== undefined) updates.charge_notes = payload.charge_notes;
  if (payload.charge_color !== undefined) updates.charge_color = payload.charge_color;
  if (payload.charge_icon !== undefined) updates.charge_icon = payload.charge_icon;

  const ok = updateRowByField_('CHARGE', 'charge_id', payload.charge_id, updates);
  if (!ok) return errorResponse_('Cobrança não encontrada.');

  return successResponse_(null, 'Cobrança atualizada com sucesso.');
}

function deleteCharge_(payload) {
  if (!payload.charge_id) return errorResponse_('ID da cobrança é obrigatório.');

  const ok = updateRowByField_('CHARGE', 'charge_id', payload.charge_id, { charge_deleted: true });
  if (!ok) return errorResponse_('Cobrança não encontrada.');

  // Os pagamentos já registrados NÃO são apagados — ficam preservados
  // como histórico, mesmo com a cobrança "arquivada" (exclusão lógica).
  return successResponse_(null, 'Cobrança excluída com sucesso.');
}

function createChargePayment_(payload) {
  if (!payload.charge_id) return errorResponse_('ID da cobrança é obrigatório.');

  const charge = findById_('CHARGE', 'charge_id', payload.charge_id);
  if (!charge || charge.charge_deleted === true) return errorResponse_('Cobrança inválida ou não encontrada.');

  const value = Number(payload.charge_payment_value);
  if (!value || value <= 0) return errorResponse_('O valor do pagamento deve ser maior que zero.');

  const date = payload.charge_payment_date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (!isValidIsoDate_(date)) return errorResponse_('Data inválida.');

  const id = getNextId_('next_charge_payment_id');
  appendRow_('CHARGE_PAYMENT', {
    charge_payment_id: id,
    charge_id: payload.charge_id,
    charge_payment_value: value,
    charge_payment_date: date,
    charge_payment_deleted: false
  });

  return successResponse_({ charge_payment_id: id }, 'Pagamento registrado com sucesso.');
}

function updateChargePayment_(payload) {
  if (!payload.charge_payment_id) return errorResponse_('ID do pagamento é obrigatório.');

  const updates = {};
  if (payload.charge_payment_value !== undefined) {
    const value = Number(payload.charge_payment_value);
    if (!value || value <= 0) return errorResponse_('O valor do pagamento deve ser maior que zero.');
    updates.charge_payment_value = value;
  }
  if (payload.charge_payment_date !== undefined) {
    if (!isValidIsoDate_(payload.charge_payment_date)) return errorResponse_('Data inválida.');
    updates.charge_payment_date = payload.charge_payment_date;
  }

  const ok = updateRowByField_('CHARGE_PAYMENT', 'charge_payment_id', payload.charge_payment_id, updates);
  if (!ok) return errorResponse_('Pagamento não encontrado.');

  return successResponse_(null, 'Pagamento atualizado com sucesso.');
}

function deleteChargePayment_(payload) {
  if (!payload.charge_payment_id) return errorResponse_('ID do pagamento é obrigatório.');

  const ok = updateRowByField_('CHARGE_PAYMENT', 'charge_payment_id', payload.charge_payment_id, { charge_payment_deleted: true });
  if (!ok) return errorResponse_('Pagamento não encontrado.');

  return successResponse_(null, 'Pagamento excluído com sucesso.');
}
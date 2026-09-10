/**
 * Rai$e Family — FixedCharges.gs
 *
 * Contas fixas / assinaturas que geram uma transação automaticamente todo
 * mês, no dia configurado (ex: Netflix todo dia 5, aluguel todo dia 10).
 *
 * ARQUITETURA: a geração automática roda via um gatilho de tempo do Apps
 * Script (ScriptApp trigger) — não depende de ninguém abrir o app. A
 * função generateDueFixedCharges_() é chamada pelo Google uma vez por dia
 * e decide, para cada conta fixa ativa, se é hoje que ela deve gerar a
 * transação daquele mês.
 *
 * ATIVAÇÃO (rodar uma única vez, manualmente, no editor do Apps Script):
 *   installFixedChargesTrigger()
 *
 * As transações geradas nascem sempre como PENDENTES
 * (transaction_paid_off = false) — o usuário confirma o pagamento
 * normalmente pela interface, igual a qualquer outra transação.
 */

var FIXED_CHARGE_MIN_DAY = 1;
var FIXED_CHARGE_MAX_DAY = 28;

// ---------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------

function getFixedCharges_() {
  const rows = readAll_('FIXED_CHARGE').filter((f) => f.fixed_charge_deleted !== true);
  stripInternalFields_(rows);
  return successResponse_(rows);
}

function createFixedCharge_(payload) {
  const validation = validateFixedChargePayload_(payload);
  if (!validation.valid) return errorResponse_(validation.message);

  const id = getNextId_('next_fixed_charge_id');
  appendRow_('FIXED_CHARGE', {
    fixed_charge_id: id,
    fixed_charge_description: String(payload.fixed_charge_description).trim(),
    fixed_charge_value: Number(payload.fixed_charge_value),
    fixed_charge_type: payload.fixed_charge_type,
    fixed_charge_category: payload.fixed_charge_category,
    fixed_charge_pay_method: payload.fixed_charge_pay_method,
    fixed_charge_user: payload.fixed_charge_user,
    fixed_charge_day: parseInt(payload.fixed_charge_day, 10),
    fixed_charge_active: payload.fixed_charge_active !== false,
    fixed_charge_last_generated: '',
    fixed_charge_deleted: false
  });

  return successResponse_({ fixed_charge_id: id }, 'Conta fixa criada com sucesso.');
}

function updateFixedCharge_(payload) {
  if (!payload.fixed_charge_id) return errorResponse_('ID da conta fixa é obrigatório.');

  const current = findById_('FIXED_CHARGE', 'fixed_charge_id', payload.fixed_charge_id);
  if (!current) return errorResponse_('Conta fixa não encontrada.');

  const merged = Object.assign({}, current, payload);
  const validation = validateFixedChargePayload_(merged);
  if (!validation.valid) return errorResponse_(validation.message);

  const updates = {};
  ['fixed_charge_description', 'fixed_charge_value', 'fixed_charge_type', 'fixed_charge_category',
    'fixed_charge_pay_method', 'fixed_charge_user', 'fixed_charge_day', 'fixed_charge_active'
  ].forEach((field) => {
    if (payload[field] !== undefined) updates[field] = payload[field];
  });

  if (updates.fixed_charge_description !== undefined) updates.fixed_charge_description = String(updates.fixed_charge_description).trim();
  if (updates.fixed_charge_value !== undefined) updates.fixed_charge_value = Number(updates.fixed_charge_value);
  if (updates.fixed_charge_day !== undefined) updates.fixed_charge_day = parseInt(updates.fixed_charge_day, 10);

  const ok = updateRowByField_('FIXED_CHARGE', 'fixed_charge_id', payload.fixed_charge_id, updates);
  if (!ok) return errorResponse_('Conta fixa não encontrada.');

  return successResponse_(null, 'Conta fixa atualizada com sucesso.');
}

function deleteFixedCharge_(payload) {
  if (!payload.fixed_charge_id) return errorResponse_('ID da conta fixa é obrigatório.');

  const ok = updateRowByField_('FIXED_CHARGE', 'fixed_charge_id', payload.fixed_charge_id, { fixed_charge_deleted: true });
  if (!ok) return errorResponse_('Conta fixa não encontrada.');

  return successResponse_(null, 'Conta fixa excluída com sucesso.');
}

function validateFixedChargePayload_(payload) {
  if (!payload.fixed_charge_description || !String(payload.fixed_charge_description).trim()) {
    return { valid: false, message: 'Descrição não pode estar vazia.' };
  }

  const value = Number(payload.fixed_charge_value);
  if (!value || value <= 0) {
    return { valid: false, message: 'Valor deve ser maior que zero.' };
  }

  if (['Entrada', 'Saida'].indexOf(payload.fixed_charge_type) === -1) {
    return { valid: false, message: 'Tipo inválido.' };
  }

  const day = parseInt(payload.fixed_charge_day, 10);
  if (!day || day < FIXED_CHARGE_MIN_DAY || day > FIXED_CHARGE_MAX_DAY) {
    return { valid: false, message: 'O dia do mês deve estar entre ' + FIXED_CHARGE_MIN_DAY + ' e ' + FIXED_CHARGE_MAX_DAY + '.' };
  }

  const user = findById_('USER', 'user_id', payload.fixed_charge_user);
  if (!user || user.user_deleted === true) {
    return { valid: false, message: 'Usuário inválido ou não encontrado.' };
  }

  const category = findById_('CATEGORY', 'category_id', payload.fixed_charge_category);
  if (!category || category.category_deleted === true) {
    return { valid: false, message: 'Categoria inválida ou não encontrada.' };
  }
  if (category.category_type !== payload.fixed_charge_type) {
    return { valid: false, message: 'A categoria selecionada não é compatível com o tipo (' + payload.fixed_charge_type + ').' };
  }

  const payMethod = findById_('PAY_METHOD', 'pay_method_id', payload.fixed_charge_pay_method);
  if (!payMethod || payMethod.pay_method_deleted === true) {
    return { valid: false, message: 'Método de pagamento inválido ou não encontrado.' };
  }
  const expectsReceive = payload.fixed_charge_type === 'Entrada';
  if ((payMethod.pay_method_receive === true) !== expectsReceive) {
    return { valid: false, message: 'O método de pagamento selecionado não é compatível com o tipo.' };
  }

  return { valid: true };
}

// ---------------------------------------------------------------
// GERAÇÃO AUTOMÁTICA (chamada pelo gatilho de tempo)
// ---------------------------------------------------------------

/**
 * Roda uma vez por dia (instalada via installFixedChargesTrigger). Para
 * cada conta fixa ativa, verifica se o dia de hoje já alcançou o dia
 * configurado E se ainda não foi gerada uma transação para o mês atual —
 * usar "hoje >= dia configurado" (em vez de "hoje === dia configurado")
 * é proposital: se por algum motivo o gatilho não rodar exatamente no dia
 * certo (atraso do Google, script pausado etc.), ele ainda gera assim que
 * rodar de novo, ao invés de pular o mês inteiro.
 */
function generateDueFixedCharges_() {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const todayDay = Number(Utilities.formatDate(now, tz, 'd'));
  const currentYearMonth = Utilities.formatDate(now, tz, 'yyyy-MM');
  const todayIso = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  const fixedCharges = readAll_('FIXED_CHARGE').filter((f) =>
    f.fixed_charge_deleted !== true &&
    f.fixed_charge_active !== false &&
    f.fixed_charge_last_generated !== currentYearMonth &&
    todayDay >= Number(f.fixed_charge_day)
  );

  fixedCharges.forEach((charge) => {
    try {
      generateTransactionFromFixedCharge_(charge, todayIso);
      updateRowByField_('FIXED_CHARGE', 'fixed_charge_id', charge.fixed_charge_id, {
        fixed_charge_last_generated: currentYearMonth
      });
    } catch (err) {
      // Uma conta fixa com erro (ex: categoria excluída depois de criada)
      // não deve travar a geração das outras.
      Logger.log('Erro ao gerar conta fixa ' + charge.fixed_charge_id + ': ' + err.message);
    }
  });

  return fixedCharges.length;
}

function generateTransactionFromFixedCharge_(charge, dateIso) {
  const groupId = getNextId_('next_group_id');
  const id = getNextId_('next_transaction_id');

  appendRow_('TRANSACTION', {
    transaction_id: id,
    transaction_group_id: groupId,
    transaction_installment_number: 1,
    transaction_installment_total: 1,
    transaction_description: charge.fixed_charge_description,
    transaction_user: charge.fixed_charge_user,
    transaction_value: Number(charge.fixed_charge_value),
    transaction_date: dateIso,
    transaction_type: charge.fixed_charge_type,
    transaction_category: charge.fixed_charge_category,
    transaction_pay_method: charge.fixed_charge_pay_method,
    transaction_reserve: '',
    transaction_paid_off: false, // sempre nasce pendente — o usuário confirma o pagamento normalmente
    transaction_deleted: false
  });
}

/** Ação da API para testar a geração manualmente, sem esperar o gatilho rodar. */
function runFixedChargesNow_() {
  const count = generateDueFixedCharges_();
  return successResponse_({ generated: count }, count + ' conta(s) fixa(s) gerada(s) agora.');
}

// ---------------------------------------------------------------
// INSTALAÇÃO DO GATILHO (rodar manualmente, uma única vez)
// ---------------------------------------------------------------

/**
 * Instala o gatilho diário que chama generateDueFixedCharges_().
 * Seguro rodar mais de uma vez — não duplica o gatilho.
 *
 * COMO USAR: no editor do Apps Script, selecione esta função no seletor
 * ao lado de "Executar" e clique em Executar. Autorize se solicitado.
 */
function installFixedChargesTrigger() {
  const alreadyInstalled = ScriptApp.getProjectTriggers().some((t) =>
    t.getHandlerFunction() === 'generateDueFixedCharges_'
  );

  if (alreadyInstalled) {
    Logger.log('Gatilho já estava instalado — nada a fazer.');
    return;
  }

  ScriptApp.newTrigger('generateDueFixedCharges_')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  Logger.log('Gatilho instalado: generateDueFixedCharges_ vai rodar todo dia, entre 6h e 7h (fuso do script).');
}

/** Remove o gatilho, caso queira desativar a geração automática. */
function uninstallFixedChargesTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'generateDueFixedCharges_') {
      ScriptApp.deleteTrigger(t);
    }
  });
  Logger.log('Gatilho removido.');
}
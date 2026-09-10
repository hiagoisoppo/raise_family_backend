/**
 * Rai$e Family — Transactions.gs
 *
 * Regras principais implementadas aqui:
 * - Criação de transação simples ou parcelada (seções 15-19)
 * - transaction_group_id sempre existe, mesmo para transações não parceladas
 * - Datas internas em formato ISO (AAAA-MM-DD) para evitar bug de timezone
 * - Exclusão lógica (nunca física) — seção 11
 * - Edição/exclusão por parcela única ou grupo inteiro — seções 44-45
 * - Toda alteração que afeta uma reserva vinculada ajusta o saldo dela
 *   (ver explicação completa em Reserves.gs)
 */

function getTransactions_(payload) {
  var rows = readAll_('TRANSACTION').filter(function (r) {
    return r.transaction_deleted !== true;
  });

  if (payload && payload.month && payload.year) {
    var mm = ('0' + payload.month).slice(-2);
    var prefix = payload.year + '-' + mm;
    rows = rows.filter(function (r) {
      return String(r.transaction_date).indexOf(prefix) === 0;
    });
  } else if (payload && payload.year) {
    // Somente o ano informado (sem mês) — usado pela página Yearbook
    // para buscar o ano inteiro numa única chamada.
    var yearPrefix = String(payload.year);
    rows = rows.filter(function (r) {
      return String(r.transaction_date).indexOf(yearPrefix) === 0;
    });
  }

  stripInternalFields_(rows);
  return successResponse_(rows);
}

function findTransactionById_(id) {
  return findById_('TRANSACTION', 'transaction_id', id);
}

/**
 * Retorna todos os dados que o frontend precisa para montar a tela
 * principal em uma única chamada (seção 58 — evitar múltiplas requisições
 * pequenas). Se month/year forem informados, já vem com as transações
 * daquele mês inclusas.
 */
function getInitialData_(payload) {
  var users = readAll_('USER');
  var categories = readAll_('CATEGORY');
  var payMethods = readAll_('PAY_METHOD');
  var reserves = readAll_('RESERVE');
  var settingsRows = readAll_('SETTINGS');

  stripInternalFields_(users);
  stripInternalFields_(categories);
  stripInternalFields_(payMethods);
  stripInternalFields_(reserves);

  users = sanitizeUsersForClient_(users);

  var settings = {};
  settingsRows.forEach(function (r) {
    if (String(r.setting_key).indexOf('next_') !== 0) {
      settings[r.setting_key] = r.setting_value;
    }
  });

  var transactions = [];
  if (payload && payload.month && payload.year) {
    var txResponse = JSON.parse(getTransactions_(payload).getContent());
    transactions = txResponse.data;
  }

  return successResponse_({
    users: users,
    categories: categories,
    payMethods: payMethods,
    reserves: reserves,
    settings: settings,
    transactions: transactions
  });
}

function createTransaction_(payload) {
  var validation = validateTransactionPayload_(payload);
  if (!validation.valid) return errorResponse_(validation.message);

  var isInstallment = !!payload.transaction_is_installment && payload.transaction_type === 'Saida';

  if (isInstallment) {
    return createInstallmentTransactions_(payload);
  }

  var groupId = getNextId_('next_group_id');
  var id = getNextId_('next_transaction_id');

  var row = {
    transaction_id: id,
    transaction_group_id: groupId,
    transaction_installment_number: 1,
    transaction_installment_total: 1,
    transaction_description: String(payload.transaction_description).trim(),
    transaction_user: payload.transaction_user,
    transaction_value: Number(payload.transaction_value),
    transaction_date: payload.transaction_date,
    transaction_type: payload.transaction_type,
    transaction_category: payload.transaction_category,
    transaction_pay_method: payload.transaction_pay_method,
    transaction_reserve: payload.transaction_reserve || '',
    transaction_paid_off: payload.transaction_paid_off === true,
    transaction_deleted: false
  };

  appendRow_('TRANSACTION', row);

  if (row.transaction_reserve && row.transaction_paid_off) {
    applyReserveDelta_(row.transaction_reserve, reserveSignedValue_(row));
  }

  return successResponse_({ transaction_id: id, transaction_group_id: groupId }, 'Transação criada com sucesso.');
}

function buildInstallmentDate_(day, month, year, offset) {
  var m = month + offset;
  var y = year;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  var mm = ('0' + m).slice(-2);
  var dd = ('0' + day).slice(-2);
  return y + '-' + mm + '-' + dd;
}

function createInstallmentTransactions_(payload) {
  var installments = parseInt(payload.transaction_installment_total, 10);
  var day = parseInt(payload.installment_day, 10);
  var month = parseInt(payload.installment_month, 10);
  var year = parseInt(payload.installment_year, 10);

  var groupId = getNextId_('next_group_id');
  var createdIds = [];
  var baseDescription = String(payload.transaction_description).trim();

  for (var i = 0; i < installments; i++) {
    var id = getNextId_('next_transaction_id');
    var date = buildInstallmentDate_(day, month, year, i);
    var description = (i + 1) + '/' + installments + ' ' + baseDescription;

    var row = {
      transaction_id: id,
      transaction_group_id: groupId,
      transaction_installment_number: i + 1,
      transaction_installment_total: installments,
      transaction_description: description,
      transaction_user: payload.transaction_user,
      transaction_value: Number(payload.transaction_value),
      transaction_date: date,
      transaction_type: 'Saida',
      transaction_category: payload.transaction_category,
      transaction_pay_method: payload.transaction_pay_method,
      transaction_reserve: payload.transaction_reserve || '',
      // Todas as parcelas nascem como não pagas — mesmo a primeira, ainda
      // que a data coincida com hoje. O usuário confirma o pagamento
      // individualmente pelo checkbox no popup de saídas (seção 31/35).
      transaction_paid_off: false,
      transaction_deleted: false
    };

    appendRow_('TRANSACTION', row);
    createdIds.push(id);
  }

  return successResponse_(
    { transaction_group_id: groupId, transaction_ids: createdIds },
    installments + ' parcelas criadas com sucesso.'
  );
}

/**
 * Reverte o efeito de uma linha antiga na reserva e aplica o efeito da
 * linha nova, tratando corretamente os casos de troca de reserva.
 */
function applyTransactionUpdate_(oldRow, updates) {
  var oldReserve = oldRow.transaction_reserve;
  var oldDelta = (oldReserve && oldRow.transaction_paid_off === true) ? reserveSignedValue_(oldRow) : 0;

  var newRow = {};
  Object.keys(oldRow).forEach(function (k) { newRow[k] = oldRow[k]; });
  Object.keys(updates).forEach(function (k) { newRow[k] = updates[k]; });

  var newReserve = newRow.transaction_reserve;
  var newDelta = (newReserve && newRow.transaction_paid_off === true) ? reserveSignedValue_(newRow) : 0;

  updateRowByField_('TRANSACTION', 'transaction_id', oldRow.transaction_id, updates);

  if (String(oldReserve || '') !== String(newReserve || '')) {
    if (oldReserve && oldDelta !== 0) applyReserveDelta_(oldReserve, -oldDelta);
    if (newReserve && newDelta !== 0) applyReserveDelta_(newReserve, newDelta);
  } else if (newReserve) {
    var diff = newDelta - oldDelta;
    if (diff !== 0) applyReserveDelta_(newReserve, diff);
  }
}

/**
 * Monta o objeto de updates a partir do payload, ignorando campos que não
 * devem ser editáveis diretamente (transaction_id, transaction_deleted).
 */
function buildTransactionUpdates_(payload) {
  var editableFields = [
    'transaction_description', 'transaction_user', 'transaction_value',
    'transaction_date', 'transaction_type', 'transaction_category',
    'transaction_pay_method', 'transaction_reserve', 'transaction_paid_off'
  ];
  var updates = {};
  editableFields.forEach(function (field) {
    if (payload[field] !== undefined) updates[field] = payload[field];
  });
  if (updates.transaction_value !== undefined) updates.transaction_value = Number(updates.transaction_value);
  if (updates.transaction_reserve === '') updates.transaction_reserve = '';
  return updates;
}

function updateTransaction_(payload) {
  if (!payload.transaction_id) return errorResponse_('ID da transação é obrigatório.');

  var current = findTransactionById_(payload.transaction_id);
  if (!current) return errorResponse_('Transação não encontrada.');

  // Reaproveita a validação de criação, mas mesclando com os dados atuais
  // para os campos que não vieram no payload de edição.
  var mergedForValidation = {};
  Object.keys(current).forEach(function (k) { mergedForValidation[k] = current[k]; });
  Object.keys(payload).forEach(function (k) { mergedForValidation[k] = payload[k]; });
  mergedForValidation.transaction_is_installment = false; // edição não recria parcelamento

  var validation = validateTransactionPayload_(mergedForValidation);
  if (!validation.valid) return errorResponse_(validation.message);

  var scope = payload.scope === 'group' ? 'group' : 'this';
  var updates = buildTransactionUpdates_(payload);

  if (scope === 'this') {
    applyTransactionUpdate_(current, updates);
  } else {
    var groupRows = readAll_('TRANSACTION').filter(function (r) {
      return String(r.transaction_group_id) === String(current.transaction_group_id) && r.transaction_deleted !== true;
    });

    groupRows.forEach(function (row) {
      var rowUpdates = {};
      Object.keys(updates).forEach(function (k) { rowUpdates[k] = updates[k]; });

      // Data e status de pagamento são sempre individuais por parcela,
      // mesmo em uma edição de "todo o grupo" — nunca sincronizamos isso
      // em massa, para não sobrescrever pagamentos já confirmados nem
      // datas de vencimento distintas de cada parcela.
      delete rowUpdates.transaction_date;
      delete rowUpdates.transaction_paid_off;

      if (rowUpdates.transaction_description !== undefined) {
        rowUpdates.transaction_description =
          row.transaction_installment_number + '/' + row.transaction_installment_total + ' ' + updates.transaction_description;
      }

      applyTransactionUpdate_(row, rowUpdates);
    });
  }

  return successResponse_(null, 'Transação atualizada com sucesso.');
}

function deleteTransaction_(payload) {
  if (!payload.transaction_id) return errorResponse_('ID da transação é obrigatório.');

  var row = findTransactionById_(payload.transaction_id);
  if (!row) return errorResponse_('Transação não encontrada.');

  updateRowByField_('TRANSACTION', 'transaction_id', row.transaction_id, { transaction_deleted: true });

  if (row.transaction_reserve && row.transaction_paid_off === true) {
    applyReserveDelta_(row.transaction_reserve, -reserveSignedValue_(row));
  }

  return successResponse_(null, 'Transação excluída com sucesso.');
}

function deleteTransactionGroup_(payload) {
  if (!payload.transaction_group_id) return errorResponse_('ID do grupo de parcelas é obrigatório.');

  var rows = readAll_('TRANSACTION').filter(function (r) {
    return String(r.transaction_group_id) === String(payload.transaction_group_id) && r.transaction_deleted !== true;
  });

  if (!rows.length) return errorResponse_('Nenhuma transação ativa encontrada para este grupo.');

  rows.forEach(function (row) {
    updateRowByField_('TRANSACTION', 'transaction_id', row.transaction_id, { transaction_deleted: true });
    if (row.transaction_reserve && row.transaction_paid_off === true) {
      applyReserveDelta_(row.transaction_reserve, -reserveSignedValue_(row));
    }
  });

  return successResponse_(null, rows.length + ' parcela(s) excluída(s) com sucesso.');
}

/**
 * Estende um grupo de parcelas já existente com N parcelas novas ao
 * final — corrige o caso de o usuário ter cadastrado uma quantidade
 * errada de parcelas (ex: criou 6 quando deveria ser 12).
 *
 * Renumera transaction_installment_total em TODAS as parcelas do grupo
 * (existentes + novas) e ajusta a descrição delas para refletir o novo
 * total (ex: "3/6 Notebook" vira "3/12 Notebook"). As parcelas novas
 * continuam a sequência de datas a partir da última parcela existente,
 * preservando o dia do mês originalmente configurado. Nascem sempre como
 * pendentes, igual a qualquer parcela futura criada na criação original.
 */
function addInstallmentsToGroup_(payload) {
  if (!payload.transaction_group_id) return errorResponse_('ID do grupo de parcelas é obrigatório.');

  var additional = parseInt(payload.additional_installments, 10);
  if (!additional || additional < 1) return errorResponse_('Quantidade de parcelas a adicionar deve ser maior que zero.');

  var groupRows = readAll_('TRANSACTION').filter(function (r) {
    return String(r.transaction_group_id) === String(payload.transaction_group_id) && r.transaction_deleted !== true;
  });

  if (!groupRows.length) return errorResponse_('Grupo de parcelas não encontrado.');

  groupRows.sort(function (a, b) {
    return Number(a.transaction_installment_number) - Number(b.transaction_installment_number);
  });

  var lastRow = groupRows[groupRows.length - 1];
  var oldTotal = Number(lastRow.transaction_installment_total) || groupRows.length;
  var newTotal = oldTotal + additional;

  // Renumera todas as parcelas existentes para o novo total.
  groupRows.forEach(function (row) {
    var baseDescription = extractInstallmentBaseDescription_(row.transaction_description);
    var newDescription = row.transaction_installment_number + '/' + newTotal + ' ' + baseDescription;
    updateRowByField_('TRANSACTION', 'transaction_id', row.transaction_id, {
      transaction_installment_total: newTotal,
      transaction_description: newDescription
    });
  });

  // Gera as parcelas novas, continuando a data a partir da última parcela.
  var lastDateParts = String(lastRow.transaction_date).split('-');
  var day = Number(lastDateParts[2]);
  var month = Number(lastDateParts[1]);
  var year = Number(lastDateParts[0]);
  var baseDescription = extractInstallmentBaseDescription_(lastRow.transaction_description);

  var createdIds = [];
  for (var i = 1; i <= additional; i++) {
    var date = buildInstallmentDate_(day, month, year, i);
    var num = oldTotal + i;
    var id = getNextId_('next_transaction_id');

    appendRow_('TRANSACTION', {
      transaction_id: id,
      transaction_group_id: lastRow.transaction_group_id,
      transaction_installment_number: num,
      transaction_installment_total: newTotal,
      transaction_description: num + '/' + newTotal + ' ' + baseDescription,
      transaction_user: lastRow.transaction_user,
      transaction_value: lastRow.transaction_value,
      transaction_date: date,
      transaction_type: 'Saida',
      transaction_category: lastRow.transaction_category,
      transaction_pay_method: lastRow.transaction_pay_method,
      transaction_reserve: lastRow.transaction_reserve || '',
      transaction_paid_off: false,
      transaction_deleted: false
    });
    createdIds.push(id);
  }

  return successResponse_(
    { transaction_group_id: lastRow.transaction_group_id, added: additional, new_total: newTotal, transaction_ids: createdIds },
    additional + ' parcela(s) adicionada(s) ao grupo.'
  );
}

/**
 * Extrai a descrição "base" de uma parcela, removendo o prefixo "N/T "
 * (ex: "3/6 Notebook" -> "Notebook"). Se a descrição não seguir esse
 * padrão (ex: foi editada manualmente sem o prefixo), devolve o texto
 * como está, sem quebrar.
 */
function extractInstallmentBaseDescription_(description) {
  var match = String(description).match(/^\d+\/\d+\s(.*)$/);
  return match ? match[1] : String(description);
}

/**
 * Atualização em lote do status pago/recebido — usado pelos popups de
 * Entradas e Saídas (seções 31 e 35), que enviam só as alterações feitas
 * antes de fechar o popup.
 * payload.updates = [{ transaction_id, transaction_paid_off }, ...]
 */
function updateTransactionPaidOff_(payload) {
  var updates = payload.updates || [];
  if (!updates.length) return errorResponse_('Nenhuma atualização informada.');

  var all = readAll_('TRANSACTION');
  var byId = {};
  all.forEach(function (r) { byId[r.transaction_id] = r; });

  var appliedCount = 0;

  updates.forEach(function (u) {
    var row = byId[u.transaction_id];
    if (!row || row.transaction_deleted === true) return;

    var newPaid = u.transaction_paid_off === true;
    if (row.transaction_paid_off === newPaid) return; // sem mudança real

    updateRowByField_('TRANSACTION', 'transaction_id', row.transaction_id, { transaction_paid_off: newPaid });
    appliedCount++;

    if (row.transaction_reserve) {
      var signedValue = reserveSignedValue_(row);
      applyReserveDelta_(row.transaction_reserve, newPaid ? signedValue : -signedValue);
    }
  });

  return successResponse_({ updated: appliedCount }, 'Status de pagamento atualizado com sucesso.');
}
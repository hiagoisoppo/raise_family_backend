/**
 * Rai$e Family — Reserves.gs
 *
 * DECISÃO DE DESIGN (seção 71 — sinalizando explicitamente):
 * A especificação original tem uma tensão entre a seção 9 ("reserve_value
 * inicia em R$0,00") e a seção 51 (formulário de nova reserva com campo
 * "Valor inicial"). Resolvemos assim: reserve_value é um SALDO, com valor
 * inicial opcional (0 por padrão, mas o usuário pode informar um valor já
 * existente ao cadastrar — por exemplo, uma reserva que já tinha dinheiro
 * guardado antes de começar a usar o app). A partir da criação, esse saldo
 * é ajustado automaticamente (nunca recalculado do zero) sempre que uma
 * transação vinculada a ela é criada, editada, excluída ou tem seu status
 * de pagamento alterado. Isso preserva o valor inicial informado e mantém
 * o saldo sempre sincronizado com o histórico real de transações pagas.
 *
 * Entradas vinculadas a uma reserva AUMENTAM o saldo; Saídas vinculadas
 * DIMINUEM o saldo — e isso só acontece quando a transação está com
 * transaction_paid_off = true (dinheiro efetivamente movimentado).
 */

function createReserve_(payload) {
  var name = (payload.reserve_name || '').trim();
  if (!name) return errorResponse_('Nome da reserva é obrigatório.');

  var goal = Number(payload.reserve_goal) || 0;
  var initialValue = Number(payload.reserve_value) || 0;

  var id = getNextId_('next_reserve_id');
  appendRow_('RESERVE', {
    reserve_id: id,
    reserve_name: name,
    reserve_value: initialValue,
    reserve_goal: goal,
    reserve_color: payload.reserve_color || '#F39C12',
    reserve_icon: payload.reserve_icon || 'piggy-bank',
    reserve_deleted: false
  });

  return successResponse_({ reserve_id: id }, 'Reserva criada com sucesso.');
}

function updateReserve_(payload) {
  if (!payload.reserve_id) return errorResponse_('ID da reserva é obrigatório.');

  var updates = {};
  if (payload.reserve_name !== undefined) {
    var name = String(payload.reserve_name).trim();
    if (!name) return errorResponse_('Nome da reserva não pode ficar vazio.');
    updates.reserve_name = name;
  }
  if (payload.reserve_goal !== undefined) updates.reserve_goal = Number(payload.reserve_goal) || 0;
  if (payload.reserve_color !== undefined) updates.reserve_color = payload.reserve_color;
  if (payload.reserve_icon !== undefined) updates.reserve_icon = payload.reserve_icon;

  // reserve_value NÃO é editável diretamente por aqui — ele é derivado das
  // transações vinculadas (ver explicação no cabeçalho do arquivo). Uma
  // correção manual de saldo, se necessária, deve ser feita criando uma
  // transação de ajuste vinculada à reserva, não editando o campo direto —
  // isso preserva o histórico e a auditabilidade.

  var ok = updateRowByField_('RESERVE', 'reserve_id', payload.reserve_id, updates);
  if (!ok) return errorResponse_('Reserva não encontrada.');

  return successResponse_(null, 'Reserva atualizada com sucesso.');
}

function deleteReserve_(payload) {
  if (!payload.reserve_id) return errorResponse_('ID da reserva é obrigatório.');

  var ok = updateRowByField_('RESERVE', 'reserve_id', payload.reserve_id, { reserve_deleted: true });
  if (!ok) return errorResponse_('Reserva não encontrada.');

  return successResponse_(null, 'Reserva excluída com sucesso. O histórico de transações existentes será preservado.');
}

/**
 * Retorna as transações (do mês/ano informado, se houver filtro, ou de
 * todos os tempos) vinculadas a uma reserva específica. Usado no popup de
 * clique na reserva (seção 27) — somente leitura.
 */
function getReserveTransactions_(payload) {
  if (!payload.reserve_id) return errorResponse_('ID da reserva é obrigatório.');

  var rows = readAll_('TRANSACTION').filter(function (r) {
    return String(r.transaction_reserve) === String(payload.reserve_id) && r.transaction_deleted !== true;
  });

  stripInternalFields_(rows);
  return successResponse_(rows);
}

// ---------- Helpers de ajuste de saldo (usados também por Transactions.gs) ----------

/**
 * Valor com sinal que uma transação representa para o saldo da reserva:
 * positivo para Entrada (contribuição), negativo para Saida (retirada).
 */
function reserveSignedValue_(row) {
  var sign = row.transaction_type === 'Entrada' ? 1 : -1;
  return sign * Number(row.transaction_value);
}

/**
 * Aplica um delta (positivo ou negativo) ao saldo atual de uma reserva,
 * de forma segura sob concorrência (LockService).
 */
function applyReserveDelta_(reserveId, delta) {
  if (!reserveId || !delta) return;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_('RESERVE');
    var headers = SHEET_SCHEMA.RESERVE;
    var idCol = headers.indexOf('reserve_id') + 1;
    var valCol = headers.indexOf('reserve_value') + 1;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(reserveId)) {
        var rowNum = i + 2;
        var current = Number(sheet.getRange(rowNum, valCol).getValue()) || 0;
        sheet.getRange(rowNum, valCol).setValue(current + delta);
        return;
      }
    }
  } finally {
    lock.releaseLock();
  }
}
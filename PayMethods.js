/**
 * Rai$e Family — PayMethods.gs
 *
 * Assim como category_type, pay_method_receive NUNCA pode ser alterado
 * depois de criado, pelo mesmo motivo de integridade (seção 66).
 */

function createPayMethod_(payload) {
  var name = (payload.pay_method_name || '').trim();
  if (!name) return errorResponse_('Nome do método de pagamento é obrigatório.');

  var id = getNextId_('next_pay_method_id');
  appendRow_('PAY_METHOD', {
    pay_method_id: id,
    pay_method_receive: payload.pay_method_receive === true,
    pay_method_name: name,
    pay_method_color: payload.pay_method_color || '#8E44AD',
    pay_method_icon: payload.pay_method_icon || 'wallet',
    pay_method_deleted: false
  });

  return successResponse_({ pay_method_id: id }, 'Método de pagamento criado com sucesso.');
}

function updatePayMethod_(payload) {
  if (!payload.pay_method_id) return errorResponse_('ID do método de pagamento é obrigatório.');

  var updates = {};
  if (payload.pay_method_name !== undefined) {
    var name = String(payload.pay_method_name).trim();
    if (!name) return errorResponse_('Nome do método não pode ficar vazio.');
    updates.pay_method_name = name;
  }
  if (payload.pay_method_color !== undefined) updates.pay_method_color = payload.pay_method_color;
  if (payload.pay_method_icon !== undefined) updates.pay_method_icon = payload.pay_method_icon;

  if (payload.pay_method_receive !== undefined) {
    var current = findById_('PAY_METHOD', 'pay_method_id', payload.pay_method_id);
    if (current && (payload.pay_method_receive === true) !== (current.pay_method_receive === true)) {
      return errorResponse_('Não é possível alterar o tipo (recebimento/pagamento) de um método já existente, pois isso comprometeria as transações já vinculadas a ele. Crie um novo método em vez disso.');
    }
  }

  var ok = updateRowByField_('PAY_METHOD', 'pay_method_id', payload.pay_method_id, updates);
  if (!ok) return errorResponse_('Método de pagamento não encontrado.');

  return successResponse_(null, 'Método de pagamento atualizado com sucesso.');
}

function deletePayMethod_(payload) {
  if (!payload.pay_method_id) return errorResponse_('ID do método de pagamento é obrigatório.');

  var ok = updateRowByField_('PAY_METHOD', 'pay_method_id', payload.pay_method_id, { pay_method_deleted: true });
  if (!ok) return errorResponse_('Método de pagamento não encontrado.');

  return successResponse_(null, 'Método de pagamento excluído com sucesso. O histórico de transações existentes será preservado.');
}
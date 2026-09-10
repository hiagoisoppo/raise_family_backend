/**
 * Rai$e Family — Validation.gs
 *
 * Todas as regras de integridade descritas nas seções 65 e 66 da
 * especificação. O frontend também valida, mas por segurança (seção 59) o
 * backend NUNCA confia apenas nisso — toda gravação passa por aqui de novo.
 */

function validateTransactionPayload_(payload) {
  if (!payload.transaction_description || !String(payload.transaction_description).trim()) {
    return { valid: false, message: 'Descrição não pode estar vazia.' };
  }

  if (!payload.transaction_user) {
    return { valid: false, message: 'Usuário é obrigatório.' };
  }
  var user = findById_('USER', 'user_id', payload.transaction_user);
  if (!user || user.user_deleted === true) {
    return { valid: false, message: 'Usuário inválido ou não encontrado.' };
  }

  var value = Number(payload.transaction_value);
  if (!value || value <= 0) {
    return { valid: false, message: 'Valor deve ser maior que zero.' };
  }

  if (['Entrada', 'Saida'].indexOf(payload.transaction_type) === -1) {
    return { valid: false, message: 'Tipo de transação inválido.' };
  }

  var category = findById_('CATEGORY', 'category_id', payload.transaction_category);
  if (!category || category.category_deleted === true) {
    return { valid: false, message: 'Categoria inválida ou não encontrada.' };
  }
  if (category.category_type !== payload.transaction_type) {
    return {
      valid: false,
      message: 'A categoria "' + category.category_name + '" é do tipo ' + category.category_type +
        ' e não pode ser usada em uma transação de ' + payload.transaction_type + '.'
    };
  }

  var payMethod = findById_('PAY_METHOD', 'pay_method_id', payload.transaction_pay_method);
  if (!payMethod || payMethod.pay_method_deleted === true) {
    return { valid: false, message: 'Método de pagamento inválido ou não encontrado.' };
  }
  var expectsReceive = payload.transaction_type === 'Entrada';
  var methodIsReceive = payMethod.pay_method_receive === true;
  if (methodIsReceive !== expectsReceive) {
    return {
      valid: false,
      message: 'O método "' + payMethod.pay_method_name + '" não é compatível com transações de ' + payload.transaction_type + '.'
    };
  }

  if (payload.transaction_reserve) {
    var reserve = findById_('RESERVE', 'reserve_id', payload.transaction_reserve);
    if (!reserve || reserve.reserve_deleted === true) {
      return { valid: false, message: 'Reserva inválida ou não encontrada.' };
    }
  }

  if (!payload.transaction_is_installment) {
    if (!payload.transaction_date || !isValidIsoDate_(payload.transaction_date)) {
      return { valid: false, message: 'Data inválida.' };
    }
  } else {
    var installments = parseInt(payload.transaction_installment_total, 10);
    var day = parseInt(payload.installment_day, 10);
    var month = parseInt(payload.installment_month, 10);
    var year = parseInt(payload.installment_year, 10);

    if (!installments || installments < 1) {
      return { valid: false, message: 'Quantidade de parcelas inválida.' };
    }
    if (!day || day < 1 || day > 28) {
      return { valid: false, message: 'Dia da parcela deve estar entre 01 e 28.' };
    }
    if (!month || month < 1 || month > 12) {
      return { valid: false, message: 'Mês da primeira parcela inválido.' };
    }
    if (!year || year < 2000 || year > 2100) {
      return { valid: false, message: 'Ano da primeira parcela inválido.' };
    }
  }

  return { valid: true };
}

function isValidIsoDate_(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str);
}
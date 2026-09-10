/**
 * Rai$e Family — Categories.gs
 *
 * IMPORTANTE: category_type NUNCA pode ser alterado depois de criado.
 * Motivo: se uma categoria "Supermercado" (Saida) fosse trocada para
 * "Entrada" depois de já ter 300 transações de Saida vinculadas, essas
 * transações antigas ficariam com uma referência inconsistente (seção 66 —
 * nunca permitir Entrada+categoria Saida ou vice-versa). Por isso, para
 * mudar o tipo, o usuário deve excluir a categoria e criar uma nova.
 */

function createCategory_(payload) {
  var type = payload.category_type;
  if (['Entrada', 'Saida'].indexOf(type) === -1) {
    return errorResponse_('Tipo de categoria inválido. Use "Entrada" ou "Saida".');
  }

  var name = (payload.category_name || '').trim();
  if (!name) return errorResponse_('Nome da categoria é obrigatório.');

  var id = getNextId_('next_category_id');
  appendRow_('CATEGORY', {
    category_id: id,
    category_type: type,
    category_name: name,
    category_color: payload.category_color || '#3498DB',
    category_icon: payload.category_icon || 'tag',
    category_budget: payload.category_budget ? Number(payload.category_budget) : '',
    category_deleted: false
  });

  return successResponse_({ category_id: id }, 'Categoria criada com sucesso.');
}

function updateCategory_(payload) {
  if (!payload.category_id) return errorResponse_('ID da categoria é obrigatório.');

  var updates = {};
  if (payload.category_name !== undefined) {
    var name = String(payload.category_name).trim();
    if (!name) return errorResponse_('Nome da categoria não pode ficar vazio.');
    updates.category_name = name;
  }
  if (payload.category_color !== undefined) updates.category_color = payload.category_color;
  if (payload.category_icon !== undefined) updates.category_icon = payload.category_icon;
  if (payload.category_budget !== undefined) {
    updates.category_budget = payload.category_budget ? Number(payload.category_budget) : '';
  }

  // category_type é intencionalmente ignorado aqui mesmo se enviado —
  // ver explicação no cabeçalho do arquivo.
  if (payload.category_type !== undefined) {
    var current = findById_('CATEGORY', 'category_id', payload.category_id);
    if (current && payload.category_type !== current.category_type) {
      return errorResponse_('Não é possível alterar o tipo de uma categoria existente, pois isso comprometeria as transações já vinculadas a ela. Crie uma nova categoria em vez disso.');
    }
  }

  var ok = updateRowByField_('CATEGORY', 'category_id', payload.category_id, updates);
  if (!ok) return errorResponse_('Categoria não encontrada.');

  return successResponse_(null, 'Categoria atualizada com sucesso.');
}

function deleteCategory_(payload) {
  if (!payload.category_id) return errorResponse_('ID da categoria é obrigatório.');

  var ok = updateRowByField_('CATEGORY', 'category_id', payload.category_id, { category_deleted: true });
  if (!ok) return errorResponse_('Categoria não encontrada.');

  return successResponse_(null, 'Categoria excluída com sucesso. O histórico de transações existentes será preservado.');
}
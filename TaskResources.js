/**
 * Rai$e Family — TaskResources.gs
 *
 * CRUD dos quatro tipos de recurso vinculados a uma Task: MATERIAL,
 * TOOL, VIDEO e ARTICLE. Todos seguem o mesmo padrão simples (recurso
 * pertence a exatamente uma task via task_id, exclusão lógica de sempre).
 * Separado de Tasks.gs só por organização — nenhum destes é referenciado
 * fora do setor Task.
 */

// =================================================================
// MATERIAL
// =================================================================
function createMaterial_(payload) {
  if (!payload.task_id) return errorResponse_('ID da tarefa é obrigatório.');
  const task = findById_('TASK', 'task_id', payload.task_id);
  if (!task || task.task_deleted === true) return errorResponse_('Tarefa inválida ou não encontrada.');

  const name = (payload.material_name || '').trim();
  if (!name) return errorResponse_('Nome do material é obrigatório.');

  const unitsNeeded = Number(payload.material_units_needed);
  if (!unitsNeeded || unitsNeeded <= 0) return errorResponse_('A quantidade necessária deve ser maior que zero.');

  const unitPrice = Number(payload.material_unit_price) || 0;
  if (unitPrice < 0) return errorResponse_('O preço unitário não pode ser negativo.');

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const id = getNextId_('next_material_id');

  appendRow_('MATERIAL', {
    material_id: id,
    task_id: payload.task_id,
    material_name: name,
    material_description: payload.material_description || '',
    material_link: payload.material_link || '',
    material_units_needed: unitsNeeded,
    material_unit_price: unitPrice,
    material_purchased: !!payload.material_purchased,
    material_deleted: false,
    material_created_at: now,
    material_updated_at: now
  });

  return successResponse_({ material_id: id }, 'Material adicionado com sucesso.');
}

function updateMaterial_(payload) {
  if (!payload.material_id) return errorResponse_('ID do material é obrigatório.');

  const updates = {};
  if (payload.material_name !== undefined) {
    const name = String(payload.material_name).trim();
    if (!name) return errorResponse_('Nome do material não pode ficar vazio.');
    updates.material_name = name;
  }
  if (payload.material_description !== undefined) updates.material_description = payload.material_description;
  if (payload.material_link !== undefined) updates.material_link = payload.material_link;
  if (payload.material_units_needed !== undefined) {
    const unitsNeeded = Number(payload.material_units_needed);
    if (!unitsNeeded || unitsNeeded <= 0) return errorResponse_('A quantidade necessária deve ser maior que zero.');
    updates.material_units_needed = unitsNeeded;
  }
  if (payload.material_unit_price !== undefined) {
    const unitPrice = Number(payload.material_unit_price) || 0;
    if (unitPrice < 0) return errorResponse_('O preço unitário não pode ser negativo.');
    updates.material_unit_price = unitPrice;
  }
  if (payload.material_purchased !== undefined) updates.material_purchased = !!payload.material_purchased;

  updates.material_updated_at = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const ok = updateRowByField_('MATERIAL', 'material_id', payload.material_id, updates);
  if (!ok) return errorResponse_('Material não encontrado.');

  return successResponse_(null, 'Material atualizado com sucesso.');
}

function deleteMaterial_(payload) {
  if (!payload.material_id) return errorResponse_('ID do material é obrigatório.');
  const ok = updateRowByField_('MATERIAL', 'material_id', payload.material_id, { material_deleted: true });
  if (!ok) return errorResponse_('Material não encontrado.');
  return successResponse_(null, 'Material excluído com sucesso.');
}

// =================================================================
// TOOL
// =================================================================
function createTool_(payload) {
  if (!payload.task_id) return errorResponse_('ID da tarefa é obrigatório.');
  const task = findById_('TASK', 'task_id', payload.task_id);
  if (!task || task.task_deleted === true) return errorResponse_('Tarefa inválida ou não encontrada.');

  const name = (payload.tool_name || '').trim();
  if (!name) return errorResponse_('Nome da ferramenta é obrigatório.');

  const price = Number(payload.tool_price) || 0;
  if (price < 0) return errorResponse_('O preço não pode ser negativo.');

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const id = getNextId_('next_tool_id');

  appendRow_('TOOL', {
    tool_id: id,
    task_id: payload.task_id,
    tool_name: name,
    tool_description: payload.tool_description || '',
    tool_link: payload.tool_link || '',
    tool_price: price,
    tool_purchased: !!payload.tool_purchased,
    tool_deleted: false,
    tool_created_at: now,
    tool_updated_at: now
  });

  return successResponse_({ tool_id: id }, 'Ferramenta adicionada com sucesso.');
}

function updateTool_(payload) {
  if (!payload.tool_id) return errorResponse_('ID da ferramenta é obrigatório.');

  const updates = {};
  if (payload.tool_name !== undefined) {
    const name = String(payload.tool_name).trim();
    if (!name) return errorResponse_('Nome da ferramenta não pode ficar vazio.');
    updates.tool_name = name;
  }
  if (payload.tool_description !== undefined) updates.tool_description = payload.tool_description;
  if (payload.tool_link !== undefined) updates.tool_link = payload.tool_link;
  if (payload.tool_price !== undefined) {
    const price = Number(payload.tool_price) || 0;
    if (price < 0) return errorResponse_('O preço não pode ser negativo.');
    updates.tool_price = price;
  }
  if (payload.tool_purchased !== undefined) updates.tool_purchased = !!payload.tool_purchased;

  updates.tool_updated_at = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const ok = updateRowByField_('TOOL', 'tool_id', payload.tool_id, updates);
  if (!ok) return errorResponse_('Ferramenta não encontrada.');

  return successResponse_(null, 'Ferramenta atualizada com sucesso.');
}

function deleteTool_(payload) {
  if (!payload.tool_id) return errorResponse_('ID da ferramenta é obrigatório.');
  const ok = updateRowByField_('TOOL', 'tool_id', payload.tool_id, { tool_deleted: true });
  if (!ok) return errorResponse_('Ferramenta não encontrada.');
  return successResponse_(null, 'Ferramenta excluída com sucesso.');
}

// =================================================================
// VIDEO
// =================================================================
function createVideo_(payload) {
  if (!payload.task_id) return errorResponse_('ID da tarefa é obrigatório.');
  const task = findById_('TASK', 'task_id', payload.task_id);
  if (!task || task.task_deleted === true) return errorResponse_('Tarefa inválida ou não encontrada.');

  const title = (payload.video_title || '').trim();
  if (!title) return errorResponse_('Título do vídeo é obrigatório.');

  const link = (payload.video_link || '').trim();
  if (!link) return errorResponse_('Link do vídeo é obrigatório.');

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const id = getNextId_('next_video_id');

  appendRow_('VIDEO', {
    video_id: id,
    task_id: payload.task_id,
    video_title: title,
    video_description: payload.video_description || '',
    video_link: link,
    video_deleted: false,
    video_created_at: now,
    video_updated_at: now
  });

  return successResponse_({ video_id: id }, 'Vídeo adicionado com sucesso.');
}

function updateVideo_(payload) {
  if (!payload.video_id) return errorResponse_('ID do vídeo é obrigatório.');

  const updates = {};
  if (payload.video_title !== undefined) {
    const title = String(payload.video_title).trim();
    if (!title) return errorResponse_('Título do vídeo não pode ficar vazio.');
    updates.video_title = title;
  }
  if (payload.video_description !== undefined) updates.video_description = payload.video_description;
  if (payload.video_link !== undefined) {
    const link = String(payload.video_link).trim();
    if (!link) return errorResponse_('Link do vídeo não pode ficar vazio.');
    updates.video_link = link;
  }

  updates.video_updated_at = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const ok = updateRowByField_('VIDEO', 'video_id', payload.video_id, updates);
  if (!ok) return errorResponse_('Vídeo não encontrado.');

  return successResponse_(null, 'Vídeo atualizado com sucesso.');
}

function deleteVideo_(payload) {
  if (!payload.video_id) return errorResponse_('ID do vídeo é obrigatório.');
  const ok = updateRowByField_('VIDEO', 'video_id', payload.video_id, { video_deleted: true });
  if (!ok) return errorResponse_('Vídeo não encontrado.');
  return successResponse_(null, 'Vídeo excluído com sucesso.');
}

// =================================================================
// ARTICLE
// =================================================================
function createArticle_(payload) {
  if (!payload.task_id) return errorResponse_('ID da tarefa é obrigatório.');
  const task = findById_('TASK', 'task_id', payload.task_id);
  if (!task || task.task_deleted === true) return errorResponse_('Tarefa inválida ou não encontrada.');

  const title = (payload.article_title || '').trim();
  if (!title) return errorResponse_('Título do artigo é obrigatório.');

  const link = (payload.article_link || '').trim();
  if (!link) return errorResponse_('Link do artigo é obrigatório.');

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const id = getNextId_('next_article_id');

  appendRow_('ARTICLE', {
    article_id: id,
    task_id: payload.task_id,
    article_title: title,
    article_description: payload.article_description || '',
    article_link: link,
    article_deleted: false,
    article_created_at: now,
    article_updated_at: now
  });

  return successResponse_({ article_id: id }, 'Artigo adicionado com sucesso.');
}

function updateArticle_(payload) {
  if (!payload.article_id) return errorResponse_('ID do artigo é obrigatório.');

  const updates = {};
  if (payload.article_title !== undefined) {
    const title = String(payload.article_title).trim();
    if (!title) return errorResponse_('Título do artigo não pode ficar vazio.');
    updates.article_title = title;
  }
  if (payload.article_description !== undefined) updates.article_description = payload.article_description;
  if (payload.article_link !== undefined) {
    const link = String(payload.article_link).trim();
    if (!link) return errorResponse_('Link do artigo não pode ficar vazio.');
    updates.article_link = link;
  }

  updates.article_updated_at = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const ok = updateRowByField_('ARTICLE', 'article_id', payload.article_id, updates);
  if (!ok) return errorResponse_('Artigo não encontrado.');

  return successResponse_(null, 'Artigo atualizado com sucesso.');
}

function deleteArticle_(payload) {
  if (!payload.article_id) return errorResponse_('ID do artigo é obrigatório.');
  const ok = updateRowByField_('ARTICLE', 'article_id', payload.article_id, { article_deleted: true });
  if (!ok) return errorResponse_('Artigo não encontrado.');
  return successResponse_(null, 'Artigo excluído com sucesso.');
}

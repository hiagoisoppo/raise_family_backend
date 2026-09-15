/**
 * Rai$e Family — Stages.gs
 *
 * Etapas do setor Task (ex: "Planejamento", "Compra de Materiais",
 * "Execução", "Concluído"). Cada etapa carrega uma % de progresso e uma
 * cor — usadas para colorir o anel de progresso do card de cada Task,
 * reaproveitando exatamente o mesmo componente visual .progress-card já
 * usado em Reservas/Cobranças (seção "COMPONENTES" do frontend).
 *
 * stage_active permite "pausar" uma etapa (deixar de aparecer no seletor
 * de novas tasks) sem apagá-la — diferente de stage_deleted, que é a
 * exclusão lógica padrão do sistema (a etapa nunca mais aparece, mas
 * tasks antigas continuam referenciando o registro para preservar
 * histórico).
 */

function getStages_() {
  const rows = readAll_('STAGE').filter((s) => s.stage_deleted !== true);
  stripInternalFields_(rows);
  return successResponse_(rows);
}

function createStage_(payload) {
  const name = (payload.stage_name || '').trim();
  if (!name) return errorResponse_('Nome da etapa é obrigatório.');

  const percentage = Number(payload.stage_percentage);
  if (isNaN(percentage) || percentage < 0 || percentage > 100) {
    return errorResponse_('A porcentagem da etapa deve estar entre 0 e 100.');
  }

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const id = getNextId_('next_stage_id');

  appendRow_('STAGE', {
    stage_id: id,
    stage_name: name,
    stage_description: payload.stage_description || '',
    stage_percentage: percentage,
    stage_color: payload.stage_color || '#eab308',
    stage_icon: payload.stage_icon || 'flag',
    stage_active: payload.stage_active !== undefined ? !!payload.stage_active : true,
    stage_deleted: false,
    stage_created_at: now,
    stage_updated_at: now
  });

  return successResponse_({ stage_id: id }, 'Etapa criada com sucesso.');
}

function updateStage_(payload) {
  if (!payload.stage_id) return errorResponse_('ID da etapa é obrigatório.');

  const updates = {};
  if (payload.stage_name !== undefined) {
    const name = String(payload.stage_name).trim();
    if (!name) return errorResponse_('Nome da etapa não pode ficar vazio.');
    updates.stage_name = name;
  }
  if (payload.stage_description !== undefined) updates.stage_description = payload.stage_description;
  if (payload.stage_percentage !== undefined) {
    const percentage = Number(payload.stage_percentage);
    if (isNaN(percentage) || percentage < 0 || percentage > 100) {
      return errorResponse_('A porcentagem da etapa deve estar entre 0 e 100.');
    }
    updates.stage_percentage = percentage;
  }
  if (payload.stage_color !== undefined) updates.stage_color = payload.stage_color;
  if (payload.stage_icon !== undefined) updates.stage_icon = payload.stage_icon;
  if (payload.stage_active !== undefined) updates.stage_active = !!payload.stage_active;

  updates.stage_updated_at = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const ok = updateRowByField_('STAGE', 'stage_id', payload.stage_id, updates);
  if (!ok) return errorResponse_('Etapa não encontrada.');

  return successResponse_(null, 'Etapa atualizada com sucesso.');
}

function deleteStage_(payload) {
  if (!payload.stage_id) return errorResponse_('ID da etapa é obrigatório.');

  const inUse = readAll_('TASK').some((t) => t.task_deleted !== true && String(t.stage_id) === String(payload.stage_id));
  if (inUse) {
    return errorResponse_('Esta etapa está em uso por uma ou mais tarefas ativas. Mova as tarefas para outra etapa antes de excluí-la.');
  }

  const ok = updateRowByField_('STAGE', 'stage_id', payload.stage_id, { stage_deleted: true });
  if (!ok) return errorResponse_('Etapa não encontrada.');

  return successResponse_(null, 'Etapa excluída com sucesso.');
}

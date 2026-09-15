/**
 * Rai$e Family — Tasks.gs
 *
 * Núcleo do setor Task. Cada TASK é um "projeto" doméstico: tem
 * orçamento (task_budget), responsável (task_user, reaproveitando USER
 * do restante do sistema) e uma etapa atual (stage_id, ver Stages.gs).
 *
 * DECISÃO DE DESIGN (mesma filosofia de Reservas/Cobranças): o custo
 * total/já gasto de uma task NUNCA é um campo editável diretamente — é
 * sempre derivado, em tempo real, da soma de MATERIAL (units_needed *
 * unit_price) e TOOL (price) vinculados a ela. Isso evita número solto
 * dessincronizado da lista real de materiais/ferramentas.
 *
 * Isolamento: TASK/STAGE/MATERIAL/TOOL/VIDEO/ARTICLE não referenciam nem
 * são referenciados por TRANSACTION, RESERVE, CATEGORY ou qualquer outra
 * entidade do setor Finance — só USER é compartilhado.
 */

// ---------------------------------------------------------------
// Carregamento inicial da página (equivalente ao getInitialData do
// Finance, mas só com o que o setor Task precisa).
// ---------------------------------------------------------------
function getTaskInitialData_() {
  const settingsRows = readAll_('SETTINGS');
  const settings = {};
  settingsRows.forEach((row) => {
    if (String(row.setting_key).indexOf('next_') !== 0) {
      settings[row.setting_key] = row.setting_value;
    }
  });

  const users = readAll_('USER');
  stripInternalFields_(users);

  const stages = readAll_('STAGE').filter((s) => s.stage_deleted !== true);
  stripInternalFields_(stages);

  const tasksResult = buildTaskList_();

  return successResponse_({
    settings,
    users: sanitizeUsersForClient_(users),
    stages,
    tasks: tasksResult
  });
}

// ---------------------------------------------------------------
// Lista de tasks (card principal), já com custo agregado
// ---------------------------------------------------------------
function getTasks_() {
  return successResponse_(buildTaskList_());
}

function buildTaskList_() {
  const tasks = readAll_('TASK').filter((t) => t.task_deleted !== true);
  const materials = readAll_('MATERIAL').filter((m) => m.material_deleted !== true);
  const tools = readAll_('TOOL').filter((t) => t.tool_deleted !== true);

  const enriched = tasks.map((task) => {
    const costs = computeTaskCosts_(task.task_id, materials, tools);
    return Object.assign({}, task, costs);
  });

  stripInternalFields_(enriched);
  return enriched;
}

/**
 * Retorna { task_estimated_cost, task_spent_cost } para uma task:
 * - estimated: soma de TODOS os materiais (unidades * preço unit.) e
 *   ferramentas vinculados, comprados ou não.
 * - spent: soma apenas dos itens já marcados como comprados
 *   (material_purchased / tool_purchased).
 */
function computeTaskCosts_(taskId, allMaterials, allTools) {
  const taskMaterials = allMaterials.filter((m) => String(m.task_id) === String(taskId));
  const taskTools = allTools.filter((t) => String(t.task_id) === String(taskId));

  let estimated = 0;
  let spent = 0;

  taskMaterials.forEach((m) => {
    const lineTotal = (Number(m.material_units_needed) || 0) * (Number(m.material_unit_price) || 0);
    estimated += lineTotal;
    if (m.material_purchased === true) spent += lineTotal;
  });

  taskTools.forEach((t) => {
    const price = Number(t.tool_price) || 0;
    estimated += price;
    if (t.tool_purchased === true) spent += price;
  });

  return { task_estimated_cost: estimated, task_spent_cost: spent };
}

// ---------------------------------------------------------------
// Detalhe de uma task (popup) — task + materiais + ferramentas +
// vídeos + artigos, tudo numa única chamada.
// ---------------------------------------------------------------
function getTaskDetail_(payload) {
  if (!payload.task_id) return errorResponse_('ID da tarefa é obrigatório.');

  const task = findById_('TASK', 'task_id', payload.task_id);
  if (!task || task.task_deleted === true) return errorResponse_('Tarefa não encontrada.');

  const materials = readAll_('MATERIAL').filter((m) => m.material_deleted !== true && String(m.task_id) === String(payload.task_id));
  const tools = readAll_('TOOL').filter((t) => t.tool_deleted !== true && String(t.task_id) === String(payload.task_id));
  const videos = readAll_('VIDEO').filter((v) => v.video_deleted !== true && String(v.task_id) === String(payload.task_id));
  const articles = readAll_('ARTICLE').filter((a) => a.article_deleted !== true && String(a.task_id) === String(payload.task_id));

  const costs = computeTaskCosts_(payload.task_id, materials, tools);

  stripInternalFields_(materials);
  stripInternalFields_(tools);
  stripInternalFields_(videos);
  stripInternalFields_(articles);
  delete task.__row;

  return successResponse_(Object.assign({}, task, costs, { materials, tools, videos, articles }));
}

// ---------------------------------------------------------------
// CRUD de Task
// ---------------------------------------------------------------
function createTask_(payload) {
  const name = (payload.task_name || '').trim();
  if (!name) return errorResponse_('Nome da tarefa é obrigatório.');

  if (!payload.stage_id) return errorResponse_('Etapa é obrigatória.');
  const stage = findById_('STAGE', 'stage_id', payload.stage_id);
  if (!stage || stage.stage_deleted === true) return errorResponse_('Etapa inválida ou não encontrada.');

  if (payload.task_user) {
    const user = findById_('USER', 'user_id', payload.task_user);
    if (!user || user.user_deleted === true) return errorResponse_('Usuário inválido ou não encontrado.');
  }

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const id = getNextId_('next_task_id');

  appendRow_('TASK', {
    task_id: id,
    task_name: name,
    task_description: payload.task_description || '',
    task_budget: payload.task_budget ? Number(payload.task_budget) : '',
    task_observation: payload.task_observation || '',
    task_user: payload.task_user || '',
    stage_id: payload.stage_id,
    task_deleted: false,
    task_created_at: now,
    task_updated_at: now
  });

  return successResponse_({ task_id: id }, 'Tarefa criada com sucesso.');
}

function updateTask_(payload) {
  if (!payload.task_id) return errorResponse_('ID da tarefa é obrigatório.');

  const updates = {};
  if (payload.task_name !== undefined) {
    const name = String(payload.task_name).trim();
    if (!name) return errorResponse_('Nome da tarefa não pode ficar vazio.');
    updates.task_name = name;
  }
  if (payload.task_description !== undefined) updates.task_description = payload.task_description;
  if (payload.task_budget !== undefined) updates.task_budget = payload.task_budget ? Number(payload.task_budget) : '';
  if (payload.task_observation !== undefined) updates.task_observation = payload.task_observation;

  if (payload.task_user !== undefined) {
    if (payload.task_user) {
      const user = findById_('USER', 'user_id', payload.task_user);
      if (!user || user.user_deleted === true) return errorResponse_('Usuário inválido ou não encontrado.');
    }
    updates.task_user = payload.task_user;
  }

  if (payload.stage_id !== undefined) {
    const stage = findById_('STAGE', 'stage_id', payload.stage_id);
    if (!stage || stage.stage_deleted === true) return errorResponse_('Etapa inválida ou não encontrada.');
    updates.stage_id = payload.stage_id;
  }

  updates.task_updated_at = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const ok = updateRowByField_('TASK', 'task_id', payload.task_id, updates);
  if (!ok) return errorResponse_('Tarefa não encontrada.');

  return successResponse_(null, 'Tarefa atualizada com sucesso.');
}

function deleteTask_(payload) {
  if (!payload.task_id) return errorResponse_('ID da tarefa é obrigatório.');

  const ok = updateRowByField_('TASK', 'task_id', payload.task_id, { task_deleted: true });
  if (!ok) return errorResponse_('Tarefa não encontrada.');

  // Materiais/ferramentas/vídeos/artigos vinculados NÃO são apagados —
  // ficam preservados como histórico, igual ao padrão de Cobranças.
  return successResponse_(null, 'Tarefa excluída com sucesso.');
}

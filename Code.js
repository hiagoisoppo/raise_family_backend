/**
 * Rai$e Family — Code.gs
 *
 * Ponto de entrada da API. Todo request do frontend (GET ou POST) passa por
 * aqui e é roteado para a função correspondente com base em "action".
 *
 * Formato de request esperado (POST, contentType: text/plain para evitar
 * preflight CORS):
 * {
 *   "action": "createTransaction",
 *   "payload": { ... }
 * }
 *
 * Formato de resposta (sempre):
 * { "success": true|false, "data": {...}|null, "message": "..." }
 */

/**
 * Rai$e Family — Code.gs
 *
 * Ponto de entrada da API. Todo request do frontend (GET ou POST) passa por
 * aqui e é roteado para a função correspondente com base em "action".
 *
 * Formato de request esperado (POST, contentType: text/plain para evitar
 * preflight CORS):
 * {
 *   "action": "createTransaction",
 *   "payload": { ... },
 *   "token": "..."   // ausente apenas na ação "login"
 * }
 *
 * Formato de resposta (sempre):
 * { "success": true|false, "data": {...}|null, "message": "..." }
 *
 * SEGURANÇA: toda ação, exceto "login", passa primeiro por requireAuth_()
 * (definido em Auth.gs). Se o token for inválido/ausente/expirado, a
 * requisição é rejeitada antes mesmo de chegar na lógica de negócio.
 */

var PUBLIC_ACTIONS = ['login', 'checkSetupStatus', 'getPreviewData', 'getPreviewDataForMonth', 'getTransactionsSince'];

function doPost(e) {
  return handleRequest_(e);
}

function doGet(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  try {
    var action, payload, token;

    if (e.postData && e.postData.contents) {
      var body = JSON.parse(e.postData.contents);
      action = body.action;
      payload = body.payload || {};
      token = body.token || '';
    } else {
      action = e.parameter.action;
      payload = e.parameter.payload ? JSON.parse(e.parameter.payload) : {};
      token = e.parameter.token || '';
    }

    if (!action) {
      return errorResponse_('Nenhuma ação (action) informada.');
    }

    if (PUBLIC_ACTIONS.indexOf(action) === -1) {
      var bypassForBootstrap = (action === 'createUser' && isNoActiveUsers_());
      if (!bypassForBootstrap) {
        var auth = requireAuth_(token);
        if (!auth.authorized) return auth.response;
        payload.__authenticatedUserId = auth.userId;
      }
    }

    return routeAction_(action, payload);
  } catch (err) {
    return errorResponse_('Erro no servidor: ' + err.message);
  }
}

function routeAction_(action, payload) {
  switch (action) {
    case 'login': return login_(payload);
    case 'checkSetupStatus': return checkSetupStatus_();
    case 'getPreviewData': return getPreviewData_();
    case 'getPreviewDataForMonth': return getPreviewDataForMonth_(payload);
    case 'getTransactionsSince': return getTransactionsSince_(payload);

    case 'getInitialData': return getInitialData_(payload);
    case 'getTransactions': return getTransactions_(payload);
    case 'createTransaction': return createTransaction_(payload);
    case 'updateTransaction': return updateTransaction_(payload);
    case 'deleteTransaction': return deleteTransaction_(payload);
    case 'deleteTransactionGroup': return deleteTransactionGroup_(payload);
    case 'addInstallmentsToGroup': return addInstallmentsToGroup_(payload);
    case 'updateTransactionPaidOff': return updateTransactionPaidOff_(payload);

    case 'createUser': return createUser_(payload);
    case 'updateUser': return updateUser_(payload);
    case 'deleteUser': return deleteUser_(payload);

    case 'createCategory': return createCategory_(payload);
    case 'updateCategory': return updateCategory_(payload);
    case 'deleteCategory': return deleteCategory_(payload);

    case 'createPayMethod': return createPayMethod_(payload);
    case 'updatePayMethod': return updatePayMethod_(payload);
    case 'deletePayMethod': return deletePayMethod_(payload);

    case 'createReserve': return createReserve_(payload);
    case 'updateReserve': return updateReserve_(payload);
    case 'deleteReserve': return deleteReserve_(payload);
    case 'getReserveTransactions': return getReserveTransactions_(payload);

    case 'saveSettings': return saveSettings_(payload);

    case 'getCharges': return getCharges_();
    case 'getChargePayments': return getChargePayments_(payload);
    case 'createCharge': return createCharge_(payload);
    case 'updateCharge': return updateCharge_(payload);
    case 'deleteCharge': return deleteCharge_(payload);
    case 'createChargePayment': return createChargePayment_(payload);
    case 'updateChargePayment': return updateChargePayment_(payload);
    case 'deleteChargePayment': return deleteChargePayment_(payload);

    case 'getFixedCharges': return getFixedCharges_();
    case 'createFixedCharge': return createFixedCharge_(payload);
    case 'updateFixedCharge': return updateFixedCharge_(payload);
    case 'deleteFixedCharge': return deleteFixedCharge_(payload);
    case 'runFixedChargesNow': return runFixedChargesNow_();

    // ---------- Setor TASK ----------
    case 'getTaskInitialData': return getTaskInitialData_();
    case 'getTasks': return getTasks_();
    case 'getTaskDetail': return getTaskDetail_(payload);
    case 'createTask': return createTask_(payload);
    case 'updateTask': return updateTask_(payload);
    case 'deleteTask': return deleteTask_(payload);

    case 'getStages': return getStages_();
    case 'createStage': return createStage_(payload);
    case 'updateStage': return updateStage_(payload);
    case 'deleteStage': return deleteStage_(payload);

    case 'createMaterial': return createMaterial_(payload);
    case 'updateMaterial': return updateMaterial_(payload);
    case 'deleteMaterial': return deleteMaterial_(payload);

    case 'createTool': return createTool_(payload);
    case 'updateTool': return updateTool_(payload);
    case 'deleteTool': return deleteTool_(payload);

    case 'createVideo': return createVideo_(payload);
    case 'updateVideo': return updateVideo_(payload);
    case 'deleteVideo': return deleteVideo_(payload);

    case 'createArticle': return createArticle_(payload);
    case 'updateArticle': return updateArticle_(payload);
    case 'deleteArticle': return deleteArticle_(payload);

    default: return errorResponse_('Ação desconhecida: ' + action);
  }
}

// ---------- Helpers de resposta padronizada (seção 61 da especificação) ----------

function successResponse_(data, message) {
  return jsonOutput_({
    success: true,
    data: data !== undefined ? data : null,
    message: message || 'Operação realizada com sucesso.'
  });
}

function errorResponse_(message, data) {
  return jsonOutput_({
    success: false,
    data: data !== undefined ? data : null,
    message: message || 'Não foi possível realizar a operação.'
  });
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

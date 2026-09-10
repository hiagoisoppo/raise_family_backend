/**
 * Rai$e Family — Android.gs
 *
 * Ações usadas SOMENTE pelo app/widget Android — nunca pelo site. Manter
 * isolado aqui garante que qualquer mudança futura para o app nunca
 * arrisca afetar preview.html ou o app principal: Preview.gs continua
 * com ZERO linhas alteradas, e Code.gs só recebe duas ADIÇÕES (uma nova
 * entrada em PUBLIC_ACTIONS, um novo `case` no roteador) — nunca uma
 * linha existente é tocada.
 *
 * getPreviewDataForMonth_ é o equivalente de getPreviewData_
 * (Preview.gs), mas parametrizado por mês/ano em vez de sempre usar o
 * mês atual do servidor — é o que permite o widget Android navegar
 * entre meses (1 anterior + atual + 3 futuros).
 *
 * IMPORTANTE — isto é uma CÓPIA da lógica de agregação de Preview.gs,
 * não uma refatoração dele. É proposital: garante que o site continue
 * usando exatamente o código de sempre, sem NENHUMA dependência deste
 * arquivo. Se a lógica de cálculo em Preview.gs mudar no futuro (nova
 * regra de negócio, novo campo, etc.), replique a mudança aqui também.
 *
 * Segurança: assim como getPreviewData, esta ação é PÚBLICA (sem token
 * — ver PUBLIC_ACTIONS em Code.gs) e retorna SOMENTE os totais
 * agregados do mês pedido — nunca transações individuais, categorias,
 * nomes de usuário, métodos de pagamento ou qualquer dado que não seja
 * seguro expor publicamente. Mesma garantia de privacidade de sempre.
 */

function getPreviewDataForMonth_(payload) {
  var now = new Date();
  var month = Number(payload && payload.month) || (now.getMonth() + 1);
  var year = Number(payload && payload.year) || now.getFullYear();

  if (!(month >= 1 && month <= 12)) {
    return errorResponse_('Mês inválido: ' + month);
  }
  if (!(year >= 2000 && year <= 2100)) {
    return errorResponse_('Ano inválido: ' + year);
  }

  return successResponse_(calculateMonthSummary_(month, year));
}

/**
 * Mesmo cálculo de getPreviewData_ (Preview.gs), parametrizado por
 * mês/ano. Não inclui o detalhamento por categoria — o widget Android
 * não precisa dele (mesma decisão já tomada para o preview público).
 */
function calculateMonthSummary_(month, year) {
  var mm = ('0' + month).slice(-2);
  var prefix = year + '-' + mm;

  var rows = readAll_('TRANSACTION').filter(function (r) {
    return r.transaction_deleted !== true &&
      String(r.transaction_date).indexOf(prefix) === 0 &&
      !r.transaction_reserve; // transações de reserva não entram no resumo (mesma regra de Preview.gs)
  });

  var income = 0, expense = 0, paidValue = 0, totalValue = 0, openExpense = 0;
  rows.forEach(function (t) {
    var value = Number(t.transaction_value) || 0;
    if (t.transaction_type === 'Entrada') {
      income += value;
    } else {
      expense += value;
      if (t.transaction_paid_off !== true) openExpense += value;
    }
    totalValue += value;
    if (t.transaction_paid_off === true) paidValue += value;
  });

  var result = income - expense;
  var progress = totalValue > 0 ? clamp01_(paidValue / totalValue) : 0;

  return {
    month: month,
    year: year,
    income: income,
    expense: expense,
    result: result,
    openExpense: openExpense,
    progress: progress
  };
}

/**
 * getTransactionsSince_ — devolve transações novas desde o último ID
 * visto pelo app Android, para a notificação de "últimas transações".
 *
 * Diferente de getPreviewData/getPreviewDataForMonth, esta ação expõe
 * dados por transação (descrição, valor, método de pagamento, usuário)
 * — por isso NÃO é aberta como as outras: exige um token fixo
 * (ANDROID_TOKEN), configurado como Script Property do projeto
 * (Configurações do projeto → Propriedades do script), que precisa
 * bater exatamente com o valor enviado no payload. Sem o token certo,
 * nenhum dado é devolvido.
 *
 * transaction_user e transaction_pay_method na tabela TRANSACTION são
 * IDs — aqui cruzamos com USER/PAY_METHOD pra devolver o nome (nunca
 * o ID cru), e da tabela USER só user_name sai: nunca
 * user_password_hash, user_password_salt, user_failed_attempts ou
 * user_locked_until.
 */

function getAndroidToken_() {
  return PropertiesService.getScriptProperties().getProperty('ANDROID_TOKEN');
}

function getTransactionsSince_(payload) {
  var expectedToken = getAndroidToken_();
  if (!expectedToken) {
    return errorResponse_('ANDROID_TOKEN não configurado no servidor (Configurações do projeto → Propriedades do script).');
  }

  var providedToken = payload && payload.token;
  if (!providedToken || providedToken !== expectedToken) {
    return errorResponse_('Token inválido.');
  }

  var lastId = Number(payload.lastTransactionId) || 0;

  var rows = readAll_('TRANSACTION').filter(function (r) {
    return r.transaction_deleted !== true && Number(r.transaction_id) > lastId;
  });

  rows.sort(function (a, b) {
    return Number(a.transaction_id) - Number(b.transaction_id);
  });

  // O ID mais alto de verdade entre TODAS as novas (mesmo as que forem
  // descartadas pelo truncamento abaixo) — sempre avança até aqui, pra
  // nunca ficar "preso" reprocessando um backlog antigo ciclo após ciclo.
  var trueLastId = rows.length ? rows[rows.length - 1].transaction_id : lastId;

  // Limita a quantidade devolvida numa única chamada — protege contra
  // um histórico gigante caso o app nunca tenha sincronizado antes.
  // Quando há mais que o limite, mantém as MAIS RECENTES (maior ID),
  // não as mais antigas do lote — senão a notificação fica mostrando
  // um backlog antigo (ex: parcelas futuras criadas de uma vez, que
  // ganham vários IDs sequenciais na hora da criação) em vez das
  // transações realmente mais novas.
  var MAX_RESULTS = 20;
  var truncated = rows.length > MAX_RESULTS;
  if (truncated) rows = rows.slice(rows.length - MAX_RESULTS);

  var usersById = {};
  readAll_('USER').forEach(function (u) { usersById[u.user_id] = u.user_name; });

  var payMethodsById = {};
  readAll_('PAY_METHOD').forEach(function (p) { payMethodsById[p.pay_method_id] = p.pay_method_name; });

  var transactions = rows.map(function (t) {
    return {
      id: t.transaction_id,
      value: Number(t.transaction_value) || 0,
      type: t.transaction_type, // "Entrada" ou "Saida"
      description: t.transaction_description,
      payMethod: payMethodsById[t.transaction_pay_method] || '',
      user: usersById[t.transaction_user] || ''
    };
  });

  var lastIdReturned = trueLastId;

  return successResponse_({
    transactions: transactions,
    lastId: lastIdReturned,
    truncated: truncated
  });
}

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
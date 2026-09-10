/**
 * Rai$e Family — Preview.gs
 *
 * Endpoint PÚBLICO (sem exigir login) que alimenta a página /preview.html.
 * Mostra apenas o resumo financeiro do mês atual e a distribuição por
 * categoria de Saída — nunca dados individuais de transação (sem
 * descrição, sem usuário, sem método de pagamento). Isso permite um
 * "cartão de visita" público do app sem expor o histórico detalhado da
 * família a quem só tem o link.
 *
 * Sempre usa o mês/ano atuais do servidor — não aceita parâmetro de mês,
 * de propósito (a página de preview não navega entre meses).
 */

function getPreviewData_() {
  var now = new Date();
  var month = now.getMonth() + 1;
  var year = now.getFullYear();
  var mm = ('0' + month).slice(-2);
  var prefix = year + '-' + mm;

  var rows = readAll_('TRANSACTION').filter(function (r) {
    return r.transaction_deleted !== true &&
      String(r.transaction_date).indexOf(prefix) === 0 &&
      !r.transaction_reserve; // transações de reserva não entram no resumo público (mesma regra do app principal)
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

  // ---- Categorias (somente Saída, seção 36 da especificação original) ----
  var saidaRows = rows.filter(function (t) { return t.transaction_type === 'Saida'; });
  var totalSaida = saidaRows.reduce(function (sum, t) { return sum + Number(t.transaction_value); }, 0);

  var groups = {};
  saidaRows.forEach(function (t) {
    var key = String(t.transaction_category);
    if (!groups[key]) groups[key] = { total: 0, paid: 0 };
    groups[key].total += Number(t.transaction_value);
    if (t.transaction_paid_off === true) groups[key].paid += Number(t.transaction_value);
  });

  var allCategories = readAll_('CATEGORY');

  var categoryCards = Object.keys(groups).map(function (categoryId) {
    var g = groups[categoryId];
    var cat = allCategories.find(function (c) { return String(c.category_id) === categoryId; });
    return {
      category_name: cat ? cat.category_name : '—',
      category_icon: cat ? cat.category_icon : 'tag',
      category_color: cat ? cat.category_color : '#64748b',
      category_budget: cat && cat.category_budget ? Number(cat.category_budget) : 0,
      total: g.total,
      percentOfTotal: totalSaida > 0 ? g.total / totalSaida : 0,
      progress: g.total > 0 ? clamp01_(g.paid / g.total) : 0
    };
  });

  categoryCards.sort(function (a, b) { return b.total - a.total; });

  return successResponse_({
    month: month,
    year: year,
    income: income,
    expense: expense,
    result: result,
    openExpense: openExpense,
    progress: progress,
    categories: categoryCards
  });
}

function clamp01_(value) {
  if (isNaN(value) || value === null || value === undefined) return 0;
  return Math.max(0, Math.min(1, value));
}
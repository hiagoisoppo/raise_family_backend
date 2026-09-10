/**
 * Rai$e Family — Setup.gs
 *
 * Este arquivo é responsável por criar toda a estrutura de abas do banco
 * (Google Sheets) automaticamente, com os cabeçalhos corretos e os valores
 * iniciais de configuração/contadores.
 *
 * COMO USAR:
 * 1. Crie uma planilha nova no Google Sheets e renomeie para "RaiseFamily_DB".
 * 2. Menu Extensões > Apps Script.
 * 3. Cole este arquivo como "Setup.gs" (novo arquivo de script).
 * 4. Na barra superior do editor, selecione a função "setupDatabase" e clique em Executar.
 * 5. Na primeira execução, o Google vai pedir autorização — aceite (é a sua própria planilha).
 * 6. Ao terminar, confira se as 6 abas foram criadas corretamente.
 *
 * Esta função é segura para rodar mais de uma vez: ela NUNCA apaga dados
 * existentes. Se uma aba já existir, ela só garante que o cabeçalho está
 * correto e não mexe nas linhas de dados já cadastradas.
 */

// Definição central da estrutura de cada aba.
// Isso também será reaproveitado pelo Code.gs (Etapa 2) para validações.
const SHEET_SCHEMA = {
  SETTINGS: ['setting_key', 'setting_value'],
  USER: ['user_id', 'user_name', 'user_color', 'user_icon', 'user_deleted',
         'user_password_hash', 'user_password_salt', 'user_failed_attempts', 'user_locked_until'],
  CATEGORY: ['category_id', 'category_type', 'category_name', 'category_color', 'category_icon', 'category_deleted'],
  PAY_METHOD: ['pay_method_id', 'pay_method_receive', 'pay_method_name', 'pay_method_color', 'pay_method_icon', 'pay_method_deleted'],
  RESERVE: ['reserve_id', 'reserve_name', 'reserve_value', 'reserve_goal', 'reserve_color', 'reserve_icon', 'reserve_deleted'],
  CHARGE: [
    'charge_id',
    'charge_description',
    'charge_debtor_name',
    'charge_debtor_contact',
    'charge_total_value',
    'charge_due_date',
    'charge_created_date',
    'charge_notes',
    'charge_color',
    'charge_icon',
    'charge_deleted'
  ],
  CHARGE_PAYMENT: [
    'charge_payment_id',
    'charge_id',
    'charge_payment_value',
    'charge_payment_date',
    'charge_payment_deleted'
  ],
  FIXED_CHARGE: [
    'fixed_charge_id',
    'fixed_charge_description',
    'fixed_charge_value',
    'fixed_charge_type',
    'fixed_charge_category',
    'fixed_charge_pay_method',
    'fixed_charge_user',
    'fixed_charge_day',
    'fixed_charge_active',
    'fixed_charge_last_generated',
    'fixed_charge_deleted'
  ],
  TRANSACTION: [
    'transaction_id',
    'transaction_group_id',
    'transaction_installment_number',
    'transaction_installment_total',
    'transaction_description',
    'transaction_user',
    'transaction_value',
    'transaction_date',
    'transaction_type',
    'transaction_category',
    'transaction_pay_method',
    'transaction_reserve',
    'transaction_paid_off',
    'transaction_deleted'
  ]
};

// Ordem de criação: SETTINGS primeiro, pois as outras abas dependem dela
// para gerar IDs com segurança. CHARGE_PAYMENT depende de CHARGE existir
// (não tecnicamente, mas mantém a leitura do código organizada).
const SHEET_CREATION_ORDER = ['SETTINGS', 'USER', 'CATEGORY', 'PAY_METHOD', 'RESERVE', 'TRANSACTION', 'CHARGE', 'CHARGE_PAYMENT', 'FIXED_CHARGE'];

// Linhas iniciais obrigatórias da aba SETTINGS (preferências + contadores de ID).
const DEFAULT_SETTINGS_ROWS = [
  ['theme', 'system'],
  ['language', 'pt-BR'],
  ['next_transaction_id', 1],
  ['next_group_id', 1],
  ['next_user_id', 1],
  ['next_category_id', 1],
  ['next_pay_method_id', 1],
  ['next_reserve_id', 1],
  ['next_charge_id', 1],
  ['next_charge_payment_id', 1],
  ['next_fixed_charge_id', 1]
];

/**
 * Função principal — execute esta função no editor do Apps Script.
 */
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const createdSheets = [];
  const skippedSheets = [];

  SHEET_CREATION_ORDER.forEach(function (sheetName) {
    const result = ensureSheet_(ss, sheetName, SHEET_SCHEMA[sheetName]);
    if (result === 'created') {
      createdSheets.push(sheetName);
    } else {
      skippedSheets.push(sheetName);
    }
  });

  ensureDefaultSettings_(ss);
  ensureAuthSecret_();
  ensureDateColumnAsPlainText_(ss);
  removeDefaultBlankSheet_(ss);

  const summary =
    'Setup concluído.\n' +
    'Abas criadas agora: ' + (createdSheets.length ? createdSheets.join(', ') : 'nenhuma (já existiam)') + '\n' +
    'Abas que já existiam (cabeçalho verificado): ' + (skippedSheets.length ? skippedSheets.join(', ') : 'nenhuma');

  Logger.log(summary);

  // Mostra um alerta amigável se estiver rodando manualmente pelo editor.
  try {
    SpreadsheetApp.getUi().alert(summary);
  } catch (e) {
    // getUi() falha se não houver interface (ex: execução via trigger). Ignorar.
  }
}

/**
 * Garante que a aba exista com o cabeçalho correto.
 * - Se a aba não existir, cria com o cabeçalho.
 * - Se já existir, valida/corrige apenas a linha de cabeçalho (linha 1),
 *   sem tocar nos dados existentes a partir da linha 2.
 */
function ensureSheet_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  let wasCreated = false;

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    wasCreated = true;
  }

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  const currentHeaders = headerRange.getValues()[0];

  const headersMatch = headers.every(function (h, i) {
    return currentHeaders[i] === h;
  });

  if (!headersMatch) {
    headerRange.setValues([headers]);
  }

  sheet.setFrozenRows(1);

  return wasCreated ? 'created' : 'existing';
}

/**
 * Garante que as linhas padrão de configuração/contadores existam na aba
 * SETTINGS, sem duplicar chaves já cadastradas.
 */
function ensureDefaultSettings_(ss) {
  const sheet = ss.getSheetByName('SETTINGS');
  const lastRow = sheet.getLastRow();

  const existingKeys = {};
  if (lastRow > 1) {
    const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    data.forEach(function (row) {
      if (row[0]) existingKeys[row[0]] = true;
    });
  }

  const rowsToAdd = DEFAULT_SETTINGS_ROWS.filter(function (row) {
    return !existingKeys[row[0]];
  });

  if (rowsToAdd.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, 2).setValues(rowsToAdd);
  }
}

/**
 * Garante que exista um segredo de assinatura para os tokens de sessão de
 * login, gerado automaticamente e guardado nas Propriedades do Script
 * (nunca na planilha, nunca visível ao frontend). Se você quiser invalidar
 * todas as sessões ativas de uma vez (ex: suspeita de vazamento), basta
 * apagar a propriedade "AUTH_SECRET" em Configurações do Projeto → 
 * Propriedades do Script, e rodar setupDatabase() de novo para gerar uma
 * nova.
 */
function ensureAuthSecret_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('AUTH_SECRET')) {
    const secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('AUTH_SECRET', secret);
  }
}

/**
 * Trava colunas de data como "Texto simples" (formato '@') em todas as
 * abas que têm esse tipo de campo.
 *
 * Sem isso, o Google Sheets converte silenciosamente uma string como
 * "2026-08-21" (escrita pelo appendRow_) num objeto Data real, assim que
 * ela é gravada — porque colunas novas nascem com formato "Automático".
 * Isso quebra qualquer filtro/comparação que dependa da string ISO exata
 * (ex: filtro de transações por mês). Forçando o formato de texto simples
 * nessas colunas, o Sheets para de "adivinhar" o tipo do valor e guarda
 * exatamente a string que foi escrita.
 *
 * Seguro rodar quantas vezes quiser.
 */
function ensureDateColumnAsPlainText_(ss) {
  var dateColumns = {
    TRANSACTION: ['transaction_date'],
    CHARGE: ['charge_due_date', 'charge_created_date'],
    CHARGE_PAYMENT: ['charge_payment_date'],
    FIXED_CHARGE: ['fixed_charge_last_generated']
  };

  Object.keys(dateColumns).forEach(function (sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    dateColumns[sheetName].forEach(function (fieldName) {
      var colIndex = SHEET_SCHEMA[sheetName].indexOf(fieldName) + 1;
      if (colIndex < 1) return;

      var numRows = Math.max(sheet.getMaxRows() - 1, 1);
      sheet.getRange(2, colIndex, numRows, 1).setNumberFormat('@');
    });
  });
}

/**
 * Remove a aba padrão "Página1" / "Sheet1" SOMENTE se ela estiver
 * completamente vazia (nunca apaga uma aba com dados, mesmo que tenha
 * esse nome).
 */
function removeDefaultBlankSheet_(ss) {
  const candidates = ['Página1', 'Page1', 'Sheet1', 'Planilha1'];
  candidates.forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (sheet && ss.getSheets().length > 1) {
      const isEmpty = sheet.getLastRow() === 0 && sheet.getLastColumn() === 0;
      if (isEmpty) {
        ss.deleteSheet(sheet);
      }
    }
  });
}
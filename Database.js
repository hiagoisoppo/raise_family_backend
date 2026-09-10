/**
 * Rai$e Family — Database.gs
 *
 * Camada genérica de leitura/escrita nas abas do Google Sheets, reutilizando
 * o SHEET_SCHEMA definido em Setup.gs. Centralizar essa lógica aqui evita
 * repetir código de leitura/escrita em cada arquivo de entidade.
 */

function getSheet_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw new Error('Aba "' + name + '" não encontrada. Rode setupDatabase() primeiro.');
  }
  return sheet;
}

/**
 * Lê todas as linhas de uma aba e retorna como array de objetos, usando os
 * nomes de coluna definidos em SHEET_SCHEMA. Cada objeto ganha uma
 * propriedade interna __row com o número da linha real na planilha (útil
 * para updates diretos, embora normalmente usemos updateRowByField_).
 */
function readAll_(sheetName) {
  var sheet = getSheet_(sheetName);
  var headers = SHEET_SCHEMA[sheetName];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var tz = Session.getScriptTimeZone();

  return values
    .map(function (row, idx) {
      var obj = {};
      headers.forEach(function (h, i) {
        var cell = row[i];
        // O Google Sheets converte silenciosamente strings no formato
        // "AAAA-MM-DD" para um objeto Data real quando a coluna está com
        // formato "Automático" (padrão). Isso quebra qualquer comparação
        // de texto (ex: filtro por mês). Normalizamos de volta para a
        // string ISO aqui, na leitura — não importa como o valor está
        // fisicamente guardado na célula, o restante do sistema sempre
        // recebe "AAAA-MM-DD" como string.
        if (cell instanceof Date) {
          cell = Utilities.formatDate(cell, tz, 'yyyy-MM-dd');
        }
        obj[h] = cell;
      });
      obj.__row = idx + 2;
      return obj;
    })
    // Linhas completamente vazias (ex: espaço em branco no final) são ignoradas
    .filter(function (obj) {
      return obj[headers[0]] !== '' && obj[headers[0]] !== null;
    });
}

function appendRow_(sheetName, obj) {
  var sheet = getSheet_(sheetName);
  var headers = SHEET_SCHEMA[sheetName];
  var row = headers.map(function (h) {
    return obj[h] !== undefined ? obj[h] : '';
  });
  sheet.appendRow(row);
}

/**
 * Atualiza campos específicos de uma linha localizada pelo valor de um campo
 * identificador (ex: idField='transaction_id', idValue=42).
 * Faz uma única leitura/escrita da linha inteira, em vez de célula por
 * célula, para reduzir chamadas à API do Sheets.
 */
function updateRowByField_(sheetName, idField, idValue, updates) {
  var sheet = getSheet_(sheetName);
  var headers = SHEET_SCHEMA[sheetName];
  var idColIndex = headers.indexOf(idField);
  if (idColIndex === -1) throw new Error('Campo "' + idField + '" não existe em ' + sheetName);

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var ids = sheet.getRange(2, idColIndex + 1, lastRow - 1, 1).getValues();

  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(idValue)) {
      var rowNum = i + 2;
      var rowRange = sheet.getRange(rowNum, 1, 1, headers.length);
      var currentValues = rowRange.getValues()[0];

      headers.forEach(function (h, colIdx) {
        if (updates.hasOwnProperty(h)) {
          currentValues[colIdx] = updates[h];
        }
      });

      rowRange.setValues([currentValues]);
      return true;
    }
  }
  return false;
}

function findById_(sheetName, idField, idValue) {
  var rows = readAll_(sheetName);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][idField]) === String(idValue)) return rows[i];
  }
  return null;
}

function stripInternalFields_(rows) {
  rows.forEach(function (r) {
    delete r.__row;
  });
  return rows;
}

/**
 * Geração segura de IDs sequenciais usando LockService.
 *
 * Por que não usar "última linha + 1"? Porque duas requisições simultâneas
 * (ex: dois membros da família salvando ao mesmo tempo) poderiam calcular o
 * mesmo próximo ID e gerar duplicidade. Usando um contador dedicado na aba
 * SETTINGS, protegido por um lock exclusivo do script, garantimos que cada
 * chamada recebe um número único mesmo sob concorrência.
 *
 * @param {string} counterKey - ex: 'next_transaction_id', 'next_user_id'
 * @return {number} o ID a ser usado nesta operação
 */
function getNextId_(counterKey) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_('SETTINGS');
    var lastRow = sheet.getLastRow();
    var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();

    for (var i = 0; i < data.length; i++) {
      if (data[i][0] === counterKey) {
        var current = Number(data[i][1]) || 1;
        var next = current + 1;
        sheet.getRange(i + 2, 2).setValue(next);
        return current;
      }
    }

    // Contador não existia (planilha criada manualmente sem rodar o setup) —
    // cria agora começando em 1, e já reserva o próximo como 2.
    sheet.appendRow([counterKey, 2]);
    return 1;
  } finally {
    lock.releaseLock();
  }
}
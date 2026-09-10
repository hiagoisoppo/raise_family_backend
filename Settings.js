/**
 * Rai$e Family — Settings.gs
 *
 * Preferências de UI persistentes (tema e idioma — seção 69). Os contadores
 * internos (next_transaction_id etc.) NUNCA são expostos ou editáveis por
 * esta rota — são de uso exclusivo do getNextId_() em Database.gs.
 */

var ALLOWED_SETTINGS_KEYS = ['theme', 'language'];
var ALLOWED_THEME_VALUES = ['light', 'dark', 'system'];
var ALLOWED_LANGUAGE_VALUES = ['pt-BR', 'en-US'];

function saveSettings_(payload) {
  if (payload.theme !== undefined && ALLOWED_THEME_VALUES.indexOf(payload.theme) === -1) {
    return errorResponse_('Valor de tema inválido.');
  }
  if (payload.language !== undefined && ALLOWED_LANGUAGE_VALUES.indexOf(payload.language) === -1) {
    return errorResponse_('Valor de idioma inválido.');
  }

  ALLOWED_SETTINGS_KEYS.forEach(function (key) {
    if (payload[key] !== undefined) {
      updateSettingValue_(key, payload[key]);
    }
  });

  return successResponse_(null, 'Configurações salvas com sucesso.');
}

function updateSettingValue_(key, value) {
  var sheet = getSheet_('SETTINGS');
  var lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] === key) {
        sheet.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }

  sheet.appendRow([key, value]);
}
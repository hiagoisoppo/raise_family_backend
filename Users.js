/**
 * Rai$e Family — Users.gs
 *
 * A senha é obrigatória na criação (o app é público, então todo usuário
 * precisa de credenciais desde o início) e opcional na edição — se o campo
 * vier vazio na edição, a senha atual é preservada. O hash/sal nunca é
 * devolvido ao frontend (ver sanitizeUsersForClient_ em Auth.gs).
 */

var MIN_PASSWORD_LENGTH = 6;

function createUser_(payload) {
  var name = (payload.user_name || '').trim();
  if (!name) return errorResponse_('Nome do usuário é obrigatório.');

  var password = payload.user_password || '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return errorResponse_('A senha deve ter pelo menos ' + MIN_PASSWORD_LENGTH + ' caracteres.');
  }

  var existing = readAll_('USER').find(function (u) {
    return u.user_deleted !== true && String(u.user_name).toLowerCase() === name.toLowerCase();
  });
  if (existing) return errorResponse_('Já existe um usuário ativo com esse nome.');

  var salt = generateSalt_();
  var hash = hashPassword_(password, salt);

  var id = getNextId_('next_user_id');
  appendRow_('USER', {
    user_id: id,
    user_name: name,
    user_color: payload.user_color || '#2ECC71',
    user_icon: payload.user_icon || 'person',
    user_deleted: false,
    user_password_hash: hash,
    user_password_salt: salt,
    user_failed_attempts: 0,
    user_locked_until: ''
  });

  return successResponse_({ user_id: id }, 'Usuário criado com sucesso.');
}

function updateUser_(payload) {
  if (!payload.user_id) return errorResponse_('ID do usuário é obrigatório.');

  var updates = {};
  if (payload.user_name !== undefined) {
    var name = String(payload.user_name).trim();
    if (!name) return errorResponse_('Nome do usuário não pode ficar vazio.');
    updates.user_name = name;
  }
  if (payload.user_color !== undefined) updates.user_color = payload.user_color;
  if (payload.user_icon !== undefined) updates.user_icon = payload.user_icon;

  // Senha só é alterada se o campo vier preenchido (seção de UX: "deixe em
  // branco para manter a senha atual").
  if (payload.user_password) {
    if (payload.user_password.length < MIN_PASSWORD_LENGTH) {
      return errorResponse_('A senha deve ter pelo menos ' + MIN_PASSWORD_LENGTH + ' caracteres.');
    }
    var salt = generateSalt_();
    updates.user_password_hash = hashPassword_(payload.user_password, salt);
    updates.user_password_salt = salt;
    // Trocar a senha também destrava a conta e zera tentativas falhas.
    updates.user_failed_attempts = 0;
    updates.user_locked_until = '';
  }

  var ok = updateRowByField_('USER', 'user_id', payload.user_id, updates);
  if (!ok) return errorResponse_('Usuário não encontrado.');

  return successResponse_(null, 'Usuário atualizado com sucesso.');
}

function deleteUser_(payload) {
  if (!payload.user_id) return errorResponse_('ID do usuário é obrigatório.');

  var ok = updateRowByField_('USER', 'user_id', payload.user_id, { user_deleted: true });
  if (!ok) return errorResponse_('Usuário não encontrado.');

  return successResponse_(null, 'Usuário excluído com sucesso. O histórico de transações existentes será preservado.');
}
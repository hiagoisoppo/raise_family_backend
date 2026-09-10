/**
 * Rai$e Family — Auth.gs
 *
 * Sistema de login por usuário. Decisões de segurança tomadas aqui,
 * deixadas explícitas para quem for revisar o código no futuro:
 *
 * 1. Senhas NUNCA são armazenadas em texto puro. Cada usuário tem um sal
 *    (salt) aleatório próprio e a senha é guardada como
 *    SHA-256(senha + sal). O Apps Script não oferece bcrypt/scrypt (hash
 *    lento, ideal para senhas), então isso é uma proteção básica — boa o
 *    suficiente para um app familiar privado, mas cada pessoa deve usar
 *    uma senha única (não reaproveitar senha de outro serviço).
 *
 * 2. Sessão baseada em token assinado (HMAC-SHA256), sem estado no
 *    servidor (não guardamos tokens ativos em nenhuma aba). O token
 *    carrega o ID do usuário e uma data de expiração; qualquer alteração
 *    no conteúdo invalida a assinatura. O segredo de assinatura
 *    (AUTH_SECRET) fica nas Propriedades do Script, nunca na planilha.
 *
 * 3. Proteção simples contra força bruta: após 5 tentativas erradas
 *    seguidas, a conta fica bloqueada por 15 minutos.
 *
 * 4. TODA ação da API (exceto "login") exige um token válido — ver o
 *    middleware requireAuth_() usado em Code.gs.
 */

var TOKEN_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
var MAX_FAILED_ATTEMPTS = 5;
var LOCKOUT_MS = 15 * 60 * 1000; // 15 minutos

// ---------------------------------------------------------------
// Hash de senha
// ---------------------------------------------------------------

function generateSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function hashPassword_(password, salt) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + ':' + salt);
  return digest.map(function (byte) {
    var v = (byte < 0 ? byte + 256 : byte).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

// ---------------------------------------------------------------
// Token de sessão (stateless, assinado)
// ---------------------------------------------------------------

function getAuthSecret_() {
  var secret = PropertiesService.getScriptProperties().getProperty('AUTH_SECRET');
  if (!secret) throw new Error('AUTH_SECRET não configurado. Rode setupDatabase() novamente.');
  return secret;
}

function signPayload_(payload) {
  var raw = Utilities.computeHmacSha256Signature(payload, getAuthSecret_());
  return Utilities.base64EncodeWebSafe(raw);
}

function createToken_(userId) {
  var expiresAt = Date.now() + TOKEN_VALIDITY_MS;
  var payload = userId + '|' + expiresAt;
  var payloadEncoded = Utilities.base64EncodeWebSafe(payload);
  var signature = signPayload_(payload);
  return payloadEncoded + '.' + signature;
}

/**
 * Verifica um token. Retorna o user_id se válido, ou null caso contrário
 * (assinatura inválida, formato errado, ou expirado).
 */
function verifyToken_(token) {
  if (!token || token.indexOf('.') === -1) return null;

  var parts = token.split('.');
  if (parts.length !== 2) return null;

  var payloadEncoded = parts[0];
  var signature = parts[1];

  var payload;
  try {
    payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(payloadEncoded)).getDataAsString();
  } catch (e) {
    return null;
  }

  var expectedSignature = signPayload_(payload);
  if (signature !== expectedSignature) return null;

  var pieces = payload.split('|');
  if (pieces.length !== 2) return null;

  var userId = pieces[0];
  var expiresAt = Number(pieces[1]);
  if (!expiresAt || Date.now() > expiresAt) return null;

  return userId;
}

/**
 * Middleware chamado por Code.gs antes de qualquer ação que não seja
 * "login". Lança uma resposta de erro padronizada se o token for
 * inválido/ausente/expirado.
 */
function requireAuth_(token) {
  var userId = verifyToken_(token);
  if (!userId) {
    return { authorized: false, response: errorResponse_('Sessão expirada ou inválida. Faça login novamente.', { authError: true }) };
  }

  var user = findById_('USER', 'user_id', userId);
  if (!user || user.user_deleted === true) {
    return { authorized: false, response: errorResponse_('Usuário não encontrado ou desativado.', { authError: true }) };
  }

  return { authorized: true, userId: userId };
}

/**
 * Verifica se ainda não existe nenhum usuário ativo cadastrado — usado
 * para liberar a criação do primeiro usuário sem exigir login (ver
 * PUBLIC_ACTIONS / lógica de bootstrap em Code.gs). Assim que o primeiro
 * usuário é criado, esse "modo aberto" se fecha automaticamente.
 */
function isNoActiveUsers_() {
  var users = readAll_('USER');
  return !users.some(function (u) { return u.user_deleted !== true; });
}

function checkSetupStatus_() {
  return successResponse_({ hasUsers: !isNoActiveUsers_() });
}

// ---------------------------------------------------------------
// Login
// ---------------------------------------------------------------

function login_(payload) {
  var name = (payload.user_name || '').trim();
  var password = payload.password || '';

  if (!name || !password) {
    return errorResponse_('Usuário e senha são obrigatórios.');
  }

  var users = readAll_('USER');
  var user = users.find(function (u) {
    return u.user_deleted !== true && String(u.user_name).toLowerCase() === name.toLowerCase();
  });

  // Mensagem genérica proposital: não revelar se foi o usuário ou a senha
  // que estava errada, para dificultar enumeração de usuários existentes.
  var invalidMsg = 'Usuário ou senha inválidos.';

  if (!user || !user.user_password_hash) {
    return errorResponse_(invalidMsg);
  }

  var lockedUntil = Number(user.user_locked_until) || 0;
  if (lockedUntil > Date.now()) {
    var minutesLeft = Math.ceil((lockedUntil - Date.now()) / 60000);
    return errorResponse_('Conta temporariamente bloqueada por tentativas incorretas. Tente novamente em ' + minutesLeft + ' minuto(s).');
  }

  var computedHash = hashPassword_(password, user.user_password_salt);

  if (computedHash !== user.user_password_hash) {
    registerFailedAttempt_(user);
    return errorResponse_(invalidMsg);
  }

  // Login correto: zera tentativas e bloqueio
  updateRowByField_('USER', 'user_id', user.user_id, { user_failed_attempts: 0, user_locked_until: '' });

  var token = createToken_(user.user_id);

  return successResponse_({
    token: token,
    user: {
      user_id: user.user_id,
      user_name: user.user_name,
      user_color: user.user_color,
      user_icon: user.user_icon
    }
  }, 'Login realizado com sucesso.');
}

function registerFailedAttempt_(user) {
  var attempts = (Number(user.user_failed_attempts) || 0) + 1;
  var updates = { user_failed_attempts: attempts };

  if (attempts >= MAX_FAILED_ATTEMPTS) {
    updates.user_locked_until = Date.now() + LOCKOUT_MS;
    updates.user_failed_attempts = 0;
  }

  updateRowByField_('USER', 'user_id', user.user_id, updates);
}

// ---------------------------------------------------------------
// Sanitização — nunca deixar hash/sal/tentativas vazar para o frontend
// ---------------------------------------------------------------

function sanitizeUsersForClient_(users) {
  return users.map(function (u) {
    return {
      user_id: u.user_id,
      user_name: u.user_name,
      user_color: u.user_color,
      user_icon: u.user_icon,
      user_deleted: u.user_deleted
    };
  });
}
const test = require('node:test');
const assert = require('node:assert');
const { startTestServer, stopTestServer, resetServerState, mockPrisma } = require('../helpers/testServer');
const {
  createTestClient,
  createRejectedClient,
  disconnectClient,
  disconnectAllClients,
  sleep,
} = require('../helpers/socketClient');
const {
  getApprovedUserToken,
  getUnapprovedUserToken,
  generateToken,
} = require('../helpers/authHelper');

test.describe('Tier 2: Unapproved User Connection & Action Rejection', () => {
  let serverInfo;

  test.before(async () => {
    serverInfo = await startTestServer();
  });

  test.after(async () => {
    disconnectAllClients();
    await stopTestServer();
  });

  test.beforeEach(async () => {
    disconnectAllClients();
    await sleep(50);
    resetServerState();
  });

  test('rejects socket connection for user with PENDING approval status', async () => {
    const tokenPending = getUnapprovedUserToken('user_pending', 'PendingUser');
    const { error } = await createRejectedClient(serverInfo.url, tokenPending);

    assert.ok(error, 'Should produce a connect_error');
    assert.match(
      error.message,
      /Conta pendente de aprovação ou não autorizada/i,
      'Should specifically reject with approval error message'
    );
  });

  test('rejects socket connection for user with REJECTED approval status', async () => {
    const tokenRejected = generateToken({
      userId: 'user_rejected',
      username: 'RejectedUser',
    });
    const { error } = await createRejectedClient(serverInfo.url, tokenRejected);

    assert.ok(error, 'Should produce a connect_error');
    assert.match(
      error.message,
      /Conta pendente de aprovação ou não autorizada/i,
      'Should reject rejected users'
    );
  });

  test('rejects socket connection when user does not exist in database', async () => {
    const tokenGhost = generateToken({
      userId: 'user_non_existent_9999',
      username: 'GhostUser',
    });
    const { error } = await createRejectedClient(serverInfo.url, tokenGhost);

    assert.ok(error, 'Should produce a connect_error');
    assert.match(
      error.message,
      /Conta pendente de aprovação ou não autorizada/i,
      'Non-existent user must be denied connection'
    );
  });

  test('dynamically allows connection once unapproved user is approved in database', async () => {
    const userId = 'user_dynamic_approval';
    mockPrisma.registerUser({
      id: userId,
      username: 'DynamicUser',
      isApproved: false,
      approvalStatus: 'PENDING',
    });

    const token = generateToken({ userId, username: 'DynamicUser' });

    // 1. Initial attempt fails
    const { error } = await createRejectedClient(serverInfo.url, token);
    assert.match(error.message, /Conta pendente de aprovação ou não autorizada/i);

    // 2. Admin approves user in database
    const userInDb = mockPrisma.users.get(userId);
    userInDb.isApproved = true;
    userInDb.approvalStatus = 'APPROVED';

    // 3. Second attempt now succeeds
    const client = await createTestClient(serverInfo.url, token);
    assert.strictEqual(client.connected, true, 'User should connect successfully after approval');

    disconnectClient(client);
  });
});
